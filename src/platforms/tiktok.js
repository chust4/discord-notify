import { httpGetText } from './http.js';
import { createLogger } from '../logger.js';
import { config } from '../config.js';

const log = createLogger('platform:tiktok');

// NOTE: TikTok does not offer a free public API for this use-case and actively
// fights scraping (Cloudflare, region locks, anti-bot JS). The logic below is
// best-effort: it parses the SIGI_STATE / universal data JSON embedded in the
// profile HTML. It may break without notice. New-video detection works more
// often than reliable live detection. Everything degrades gracefully: on
// failure we return an error string instead of throwing, so the rest of the
// poller keeps running.

function usernameFromInput(input) {
  const value = String(input).trim();
  const m = value.match(/tiktok\.com\/@?([A-Za-z0-9._]+)/i);
  return (m ? m[1] : value.replace(/^@/, '')).toLowerCase();
}

async function fetchProfileHtml(username) {
  return httpGetText(`https://www.tiktok.com/@${username}`, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
}

function extractUniversalData(html) {
  // Newer TikTok pages embed a __UNIVERSAL_DATA_FOR_REHYDRATION__ script.
  const m = html.match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch {
      /* ignore */
    }
  }
  // Fallback: legacy SIGI_STATE.
  const sigi = html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
  if (sigi) {
    try {
      return JSON.parse(sigi[1]);
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function resolve(input) {
  const username = usernameFromInput(input);
  let display_name = username;
  let avatar_url = null;
  try {
    const html = await fetchProfileHtml(username);
    const og = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (og) avatar_url = og[1];
    const data = extractUniversalData(html);
    const userInfo =
      data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user;
    if (userInfo) {
      display_name = userInfo.nickname || username;
      avatar_url = userInfo.avatarLarger || userInfo.avatarMedium || avatar_url;
    }
  } catch (err) {
    log.warn('TikTok resolve failed (best-effort), storing username only', {
      username,
      err: err.message,
    });
  }
  return {
    identifier: username,
    display_name,
    avatar_url,
    input_url: `https://www.tiktok.com/@${username}`,
  };
}

// Pull the newest-first list of video items from whichever embedded format
// this particular TikTok response happens to use.
function extractItems(data) {
  if (!data) return [];
  const detail = data.__DEFAULT_SCOPE__?.['webapp.user-detail'];
  if (Array.isArray(detail?.itemList) && detail.itemList.length) return detail.itemList;
  // Legacy SIGI_STATE: ItemModule is an object keyed by video id.
  if (data.ItemModule && typeof data.ItemModule === 'object') {
    return Object.values(data.ItemModule).sort(
      (a, b) => Number(b.createTime || 0) - Number(a.createTime || 0)
    );
  }
  const ids = data.ItemList?.['user-post']?.list;
  if (Array.isArray(ids) && ids.length) {
    return ids.map((id) => data.ItemModule?.[id] || id).filter(Boolean);
  }
  return [];
}

/**
 * Reliable TikTok LIVE detection via tiktok-live-connector (the Node port of
 * isaackogan/TikTokLive). `fetchIsLive()` is a single HTTP check — it does NOT
 * open the chat websocket, so it needs no EulerStream sign key. The connector
 * is lazy-imported so a problem with the package can never break app startup.
 * TikTok has no "live end" event type, so we only emit on the off->on edge.
 */
async function checkLive(account, state, events) {
  const { TikTokLiveConnection } = await import('tiktok-live-connector');
  const conn = new TikTokLiveConnection(account.identifier, {});
  const live = await conn.fetchIsLive();
  const wasLive = Boolean(account.is_live);

  if (live && !wasLive) {
    let info = {};
    try {
      info = await conn.fetchRoomInfo();
    } catch {
      /* room info is best-effort */
    }
    const roomId = String(info?.id || info?.roomId || Date.now());
    state.is_live = 1;
    state.live_id = roomId;
    events.push({
      event_type: 'tiktok_live',
      external_id: `${roomId}:start`,
      title: info?.title || `${account.display_name || account.identifier} jest LIVE na TikTok`,
      url: `https://www.tiktok.com/@${account.identifier}/live`,
      thumbnail_url: info?.cover?.url_list?.[0] || '',
      published_at: new Date().toISOString(),
      duration: '',
      viewer_count: String(info?.user_count ?? info?.stats?.total_user ?? ''),
      category: '',
    });
  } else {
    state.is_live = live ? 1 : 0;
    if (!live) state.live_id = null;
  }
}

/** Best-effort new-video detection by scraping the profile HTML. */
async function checkVideos(account, state, events) {
  const html = await fetchProfileHtml(account.identifier);
  const data = extractUniversalData(html);
  const items = extractItems(data);
  const latest = items[0];
  const latestId = typeof latest === 'string' ? latest : latest?.id;

  if (!latestId) {
    // TikTok renders the video list client-side via a signed API call, so the
    // server HTML often has no items (especially from a datacenter/NAS IP).
    throw new Error('lista filmów niedostępna ze strony (ograniczenie TikToka)');
  }

  if (!account.last_video_id) {
    state.last_video_id = latestId;
    return;
  }
  if (latestId !== account.last_video_id) {
    const item = typeof latest === 'object' ? latest : {};
    events.push({
      event_type: 'tiktok_video',
      external_id: latestId,
      title: item.desc || 'Nowy film na TikTok',
      url: `https://www.tiktok.com/@${account.identifier}/video/${latestId}`,
      thumbnail_url: item.video?.cover || '',
      published_at: item.createTime
        ? new Date(item.createTime * 1000).toISOString()
        : new Date().toISOString(),
      duration: item.video?.duration ? `${item.video.duration}s` : '',
      viewer_count: '',
      category: '',
    });
    state.last_video_id = latestId;
  }
}

export async function check(account) {
  const events = [];
  const state = {
    last_video_id: account.last_video_id,
    is_live: account.is_live,
    live_id: account.live_id,
  };

  let liveError = null;
  if (config.tiktok.liveEnabled) {
    try {
      await checkLive(account, state, events);
    } catch (err) {
      liveError = `live: ${err.message}`;
    }
  }

  let videoError = null;
  try {
    await checkVideos(account, state, events);
  } catch (err) {
    videoError = `video: ${err.message}`;
  }

  // When live detection is the active (reliable) path, keep flaky video-scrape
  // failures out of the surfaced error so they don't spam the panel/logs.
  const errors = [];
  if (liveError) errors.push(liveError);
  if (videoError && (!config.tiktok.liveEnabled || liveError)) errors.push(videoError);
  if (videoError && config.tiktok.liveEnabled && !liveError) {
    log.debug('TikTok video scrape failed (best-effort)', {
      account: account.identifier,
      err: videoError,
    });
  }

  return { events, state, error: errors.length ? `TikTok: ${errors.join(' | ')}` : null };
}
