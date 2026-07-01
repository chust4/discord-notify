import { httpGetText } from './http.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { Settings } from '../store.js';
import { isAvailable, fetchPosts, fetchStories } from './instaloaderRunner.js';

const log = createLogger('platform:instagram');

// NOTE: Instagram has no free public API for this use case, and unlike
// TikTok/Kick, listing a profile's posts/Reels/Stories requires an
// AUTHENTICATED session — there is no anonymous path at all. Detection
// therefore only runs once a session cookie is configured (Ustawienia panel
// or INSTAGRAM_SESSION_ID / the browser extension). Without it we fail fast
// with a clear message instead of burning time on a call we know fails.
//
// Posts/Reels/Stories are fetched via Instaloader (a small Python subprocess,
// src/platforms/instaloader_fetch.py) rather than yt-dlp — Instagram is
// Instaloader's sole focus (vs. one of ~1800 yt-dlp extractors), and it has
// two independent fetch paths (web GraphQL + the iOS app's private API) that
// it falls back between internally. Still genuine scraping of a platform that
// actively fights it, so failures (403/429/session expiry) are possible and
// surfaced as clear per-account errors rather than silently ignored.

function usernameFromInput(input) {
  const value = String(input).trim();
  const m = value.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  return (m ? m[1] : value.replace(/^@/, '')).toLowerCase();
}

function hasSession() {
  return Boolean(config.instagram.sessionId);
}

export async function resolve(input) {
  const username = usernameFromInput(input);
  let display_name = username;
  let avatar_url = null;
  try {
    const html = await httpGetText(`https://www.instagram.com/${username}/`, {
      headers: { Accept: 'text/html' },
    });
    const og = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (og) avatar_url = og[1].replace(/&amp;/g, '&');
    const title = html.match(/<title>([^<]+)<\/title>/);
    if (title) {
      // Page title is "Name (&#064;handle) • Instagram photos and videos" —
      // the @ is HTML-entity-encoded, so it must be decoded BEFORE splitting
      // on "(@", otherwise the split never matches and the whole title (incl.
      // "• Instagram photos and videos") ends up as the display name.
      const decoded = title[1].replace(/&#0?64;/g, '@').replace(/&amp;/g, '&');
      display_name = decoded.split('(@')[0].trim() || username;
    }
  } catch (err) {
    log.warn('Instagram resolve failed (best-effort), storing username only', {
      username,
      err: err.message,
    });
  }
  return {
    identifier: username,
    display_name,
    avatar_url,
    input_url: `https://www.instagram.com/${username}/`,
  };
}

const DEFAULT_TITLE = {
  instagram_post: 'Nowy post',
  instagram_reel: 'Nowy Reel',
  instagram_story: 'Nowe Story',
};

/**
 * The `{url}` shown in message text must be short and stable. Posts/Reels get
 * a real canonical Instagram page link (built by instaloader_fetch.py itself,
 * item.url). Stories have no persistent public page — always point at the
 * profile's stories tray instead of a raw, expiring media URL.
 */
function displayUrl(event_type, username, item) {
  if (event_type === 'instagram_story') return `https://www.instagram.com/stories/${username}/${item.id}/`;
  return item.url;
}

function buildEvent(event_type, username, item) {
  return {
    event_type,
    external_id: String(item.id),
    title: item.title || DEFAULT_TITLE[event_type],
    url: displayUrl(event_type, username, item),
    // .thumbnail_url is always a still image (never a video file — Discord
    // embeds can't render one via `image`); .video_url (if any) is kept
    // separate below for an optional clickable link inside the embed.
    thumbnail_url: item.thumbnail_url || '',
    raw_media_url: item.video_url || null,
    published_at: item.timestamp ? new Date(item.timestamp * 1000).toISOString() : new Date().toISOString(),
    duration: item.duration ? `${item.duration}s` : '',
    viewer_count: '',
    category: '',
  };
}

/**
 * Posts + Reels: recent items from the profile feed. `is_reel` (product_type
 * == "clips") distinguishes Reels from ordinary posts.
 *
 * Baseline handling needs its own persisted flag rather than relying on the
 * shared knownIds being empty: Stories work independently and populate the
 * combined watermark first, so by the time posts start returning, knownIds is
 * already non-empty — without a dedicated flag the first successful fetch
 * would treat all ~12 recent posts as new and blast them. The flag is set
 * once the first post fetch succeeds and never fires notifications for the
 * back-catalogue.
 */
async function checkPostsAndReels(account, knownIds, freshEvents) {
  const baselineKey = `instagram.posts_baseline.${account.id}`;
  const items = await fetchPosts(account.identifier, { limit: 12 });
  if (!items.length) throw new Error('pusta lista postów (profil prywatny, brak treści lub sesja wygasła)');

  const ids = items.map((i) => String(i.id));
  if (!Settings.get(baselineKey)) {
    for (const id of ids) knownIds.add(id);
    Settings.set(baselineKey, '1');
    return; // baseline only, no back-catalogue blast
  }
  const fresh = items.filter((i) => !knownIds.has(String(i.id))).reverse(); // oldest first
  for (const item of fresh) {
    const event_type = item.is_reel ? 'instagram_reel' : 'instagram_post';
    freshEvents.push(buildEvent(event_type, account.identifier, item));
    knownIds.add(String(item.id));
  }
}

/**
 * Stories: currently-active items only (Instagram has no story archive via
 * public means).
 */
async function checkStories(account, knownIds, freshEvents) {
  let items;
  try {
    items = await fetchStories(account.identifier);
  } catch (err) {
    // No active stories is the common case, not a real error.
    log.debug('No active Instagram stories or story fetch failed', {
      account: account.identifier,
      err: err.message,
    });
    return;
  }
  for (const item of items) {
    const id = String(item.id);
    if (knownIds.has(id)) continue;
    knownIds.add(id);
    freshEvents.push(buildEvent('instagram_story', account.identifier, item));
  }
}

export async function check(account) {
  const events = [];
  const state = { last_video_id: account.last_video_id };

  if (!hasSession()) {
    return {
      events,
      state,
      error: 'Instagram: brak session cookie — ustaw go w panelu (Ustawienia) lub wtyczką przeglądarki',
    };
  }
  if (!(await isAvailable())) {
    return { events, state, error: 'Instagram: instaloader niedostępny w obrazie kontenera' };
  }

  // Single combined watermark (post/reel ids + story ids together — IDs never
  // collide across types, and Seen-ledger dedup is keyed by event_type anyway).
  const knownIds = new Set((account.last_video_id || '').split(',').filter(Boolean));

  const errors = [];
  try {
    await checkPostsAndReels(account, knownIds, events);
  } catch (err) {
    errors.push(`posty/reels: ${err.message}`);
  }
  try {
    await checkStories(account, knownIds, events);
  } catch (err) {
    errors.push(`stories: ${err.message}`);
  }

  state.last_video_id = [...knownIds].slice(-100).join(',');
  return { events, state, error: errors.length ? `Instagram: ${errors.join(' | ')}` : null };
}
