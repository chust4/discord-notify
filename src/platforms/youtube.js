import { XMLParser } from 'fast-xml-parser';
import { httpGetText, httpGetJson } from './http.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('platform:youtube');
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

const FEED_URL = (channelId) =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

/**
 * Resolve any YouTube input (channel id, @handle, channel/user URL) into a
 * canonical channel id plus display name and avatar (avatar requires API key).
 */
export async function resolve(input) {
  const channelId = await extractChannelId(input);
  if (!channelId) {
    throw new Error(`Nie udało się rozpoznać kanału YouTube z: ${input}`);
  }

  let display_name = channelId;
  let avatar_url = null;

  // Pull name + avatar from the RSS feed first (no API key needed for name).
  try {
    const xml = await httpGetText(FEED_URL(channelId));
    const feed = parser.parse(xml);
    display_name = feed?.feed?.author?.name || feed?.feed?.title || display_name;
  } catch (err) {
    log.warn('Could not read YouTube feed for name', { input, err: err.message });
  }

  // Avatar requires the Data API.
  if (config.youtube.apiKey) {
    try {
      const data = await httpGetJson(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${config.youtube.apiKey}`
      );
      const snippet = data?.items?.[0]?.snippet;
      if (snippet) {
        display_name = snippet.title || display_name;
        avatar_url =
          snippet.thumbnails?.high?.url ||
          snippet.thumbnails?.medium?.url ||
          snippet.thumbnails?.default?.url ||
          null;
      }
    } catch (err) {
      log.warn('YouTube API channel lookup failed', { channelId, err: err.message });
    }
  }

  return {
    identifier: channelId,
    display_name,
    avatar_url,
    input_url: `https://www.youtube.com/channel/${channelId}`,
  };
}

async function extractChannelId(input) {
  const value = String(input).trim();

  // Already a channel id.
  if (/^UC[\w-]{20,}$/.test(value)) return value;

  // channel URL.
  const channelUrl = value.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
  if (channelUrl) return channelUrl[1];

  // Handle / custom / user URL -> scrape canonical channelId from the page.
  let pageUrl = value;
  if (!/^https?:\/\//i.test(value)) {
    const handle = value.startsWith('@') ? value : `@${value}`;
    pageUrl = `https://www.youtube.com/${handle}`;
  }
  try {
    const html = await httpGetText(pageUrl);
    const m =
      html.match(/"channelId":"(UC[\w-]+)"/) ||
      html.match(/channel\/(UC[\w-]+)/) ||
      html.match(/"externalId":"(UC[\w-]+)"/);
    if (m) return m[1];
  } catch (err) {
    log.warn('YouTube channel page scrape failed', { input, err: err.message });
  }
  return null;
}

/** Parse an ISO 8601 duration (PT#H#M#S) into seconds. */
function iso8601ToSeconds(iso) {
  const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const [, h, mn, s] = m;
  return (parseInt(h || 0, 10) * 3600) + (parseInt(mn || 0, 10) * 60) + parseInt(s || 0, 10);
}

function formatDuration(seconds) {
  if (seconds == null) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Look up durations + live status for a batch of video ids via the Data API.
 * Returns a Map(videoId -> { seconds, isLive }). Empty map when no API key.
 */
async function fetchVideoDetails(videoIds) {
  const out = new Map();
  if (!config.youtube.apiKey || videoIds.length === 0) return out;
  try {
    const data = await httpGetJson(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet,liveStreamingDetails&id=${videoIds.join(
        ','
      )}&key=${config.youtube.apiKey}`
    );
    for (const item of data.items || []) {
      const seconds = iso8601ToSeconds(item.contentDetails?.duration);
      const live = item.snippet?.liveBroadcastContent; // 'live' | 'none' | 'upcoming'
      out.set(item.id, { seconds, isLive: live === 'live' });
    }
  } catch (err) {
    log.warn('YouTube video details lookup failed', { err: err.message });
  }
  return out;
}

/**
 * Check a YouTube account for new uploads / shorts / live.
 * Returns { events, state, error }.
 */
export async function check(account) {
  const events = [];
  const state = {
    last_video_id: account.last_video_id,
    is_live: account.is_live,
    live_id: account.live_id,
  };

  let xml;
  try {
    xml = await httpGetText(FEED_URL(account.identifier));
  } catch (err) {
    return { events, state, error: `Feed error: ${err.message}` };
  }

  const feed = parser.parse(xml);
  let entries = feed?.feed?.entry || [];
  if (!Array.isArray(entries)) entries = [entries];
  if (entries.length === 0) return { events, state, error: null };

  // Entries are newest-first. On the very first check we only remember the
  // latest id (so we don't blast the whole back-catalogue).
  if (!account.last_video_id) {
    const newest = entries[0];
    state.last_video_id = videoIdOf(newest);
    log.info('Initialised YouTube baseline', {
      account: account.identifier,
      latest: state.last_video_id,
    });
    return { events, state, error: null };
  }

  const fresh = [];
  for (const entry of entries) {
    const vid = videoIdOf(entry);
    if (!vid || vid === account.last_video_id) break;
    fresh.push(entry);
  }
  if (fresh.length === 0) return { events, state, error: null };

  const details = await fetchVideoDetails(fresh.map(videoIdOf));

  // Oldest first so events are emitted in chronological order.
  for (const entry of fresh.reverse()) {
    const vid = videoIdOf(entry);
    const info = details.get(vid) || {};
    const seconds = info.seconds;
    const isShort = seconds != null && seconds < config.youtubeShortMaxSeconds;
    const isLive = info.isLive;

    let event_type = 'youtube_video';
    if (isLive) event_type = 'youtube_live';
    else if (isShort) event_type = 'youtube_short';

    events.push({
      event_type,
      external_id: vid,
      title: entry.title,
      url: `https://www.youtube.com/watch?v=${vid}`,
      thumbnail_url: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
      published_at: entry.published,
      duration: formatDuration(seconds),
      viewer_count: '',
      category: '',
    });
  }

  state.last_video_id = videoIdOf(entries[0]);
  return { events, state, error: null };
}

function videoIdOf(entry) {
  return entry?.['yt:videoId'] || entry?.id?.replace?.('yt:video:', '') || null;
}
