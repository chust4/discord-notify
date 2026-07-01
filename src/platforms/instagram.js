import { httpGetText } from './http.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { isAvailable, flatPlaylist } from './ytdlp.js';

const log = createLogger('platform:instagram');

// NOTE: Instagram has no free public API for this use case, and unlike
// TikTok/Kick, listing a profile's posts/reels (and anything about Stories)
// requires an AUTHENTICATED session — there is no anonymous path at all.
// Posts/reels/stories detection therefore only runs once a session cookie is
// configured (Ustawienia panel or INSTAGRAM_SESSION_ID). Without it we fail
// fast with a clear message instead of burning time on a call we know fails.
//
// Separately: at the time this was written, yt-dlp's own `instagram:user`
// extractor (used to list a profile's posts/reels) was flagged upstream as
// "CURRENTLY BROKEN" — a yt-dlp bug independent of the session cookie. The
// Dockerfile always installs yt-dlp's *latest* release at build time, so a
// fresh rebuild may already include the fix. If posts/reels detection logs
// "Unable to extract data" even with a valid session, that is very likely
// this upstream issue rather than a problem with the cookie — check for a
// newer yt-dlp release, or run `yt-dlp --list-extractors | grep instagram`
// inside the container to see current status. Stories use a different
// extractor (`instagram:story`) and are unaffected by this specific bug.

function usernameFromInput(input) {
  const value = String(input).trim();
  const m = value.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  return (m ? m[1] : value.replace(/^@/, '')).toLowerCase();
}

function hasSession() {
  return Boolean(config.instagram.sessionId);
}

function sessionCookies() {
  return { sessionid: config.instagram.sessionId };
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
      // "Name (@handle) • Instagram photos and videos" -> keep the name part.
      display_name = title[1].split('(@')[0].trim().replace(/&#0?64;/g, '@') || username;
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

function classify(entry) {
  const url = entry.url || entry.webpage_url || '';
  if (/\/reel\//.test(url)) return 'instagram_reel';
  return 'instagram_post';
}

const FALLBACK_URL = {
  instagram_post: (username, id) => `https://www.instagram.com/p/${id}/`,
  instagram_reel: (username, id) => `https://www.instagram.com/reel/${id}/`,
  instagram_story: (username, id) => `https://www.instagram.com/stories/${username}/${id}/`,
};

const DEFAULT_TITLE = {
  instagram_post: 'Nowy post',
  instagram_reel: 'Nowy Reel',
  instagram_story: 'Nowe Story',
};

function buildEvent(event_type, username, entry) {
  return {
    event_type,
    external_id: String(entry.id),
    title: entry.title || entry.description || DEFAULT_TITLE[event_type],
    url: entry.url || entry.webpage_url || FALLBACK_URL[event_type](username, entry.id),
    thumbnail_url: entry.thumbnails?.[entry.thumbnails.length - 1]?.url || '',
    published_at: entry.timestamp ? new Date(entry.timestamp * 1000).toISOString() : new Date().toISOString(),
    duration: entry.duration ? `${Math.round(entry.duration)}s` : '',
    viewer_count: '',
    category: '',
  };
}

/**
 * Posts + Reels: one combined listing of the profile, classified by URL shape.
 */
async function checkPostsAndReels(account, knownIds, freshEvents) {
  const entries = await flatPlaylist(`https://www.instagram.com/${account.identifier}/`, {
    limit: 12,
    cookies: sessionCookies(),
  });
  if (!entries.length) throw new Error('pusta lista postów (profil prywatny, brak treści lub sesja wygasła)');

  const ids = entries.map((e) => String(e.id));
  if (knownIds.size === 0) {
    for (const id of ids) knownIds.add(id);
    return; // baseline only, no back-catalogue blast
  }
  const fresh = entries.filter((e) => !knownIds.has(String(e.id))).reverse(); // oldest first
  for (const entry of fresh) {
    freshEvents.push(buildEvent(classify(entry), account.identifier, entry));
    knownIds.add(String(entry.id));
  }
}

/**
 * Stories: currently-active items only (Instagram has no story archive via
 * public means). Experimental — depends on yt-dlp's instagram:story
 * extractor, which is less battle-tested than the post/reel path.
 */
async function checkStories(account, knownIds, freshEvents) {
  let entries;
  try {
    entries = await flatPlaylist(`https://www.instagram.com/stories/${account.identifier}/`, {
      limit: 12,
      cookies: sessionCookies(),
    });
  } catch (err) {
    // No active stories is the common case, not a real error — yt-dlp usually
    // reports this as an extraction failure since there's nothing to list.
    log.debug('No active Instagram stories or story fetch failed', {
      account: account.identifier,
      err: err.message,
    });
    return;
  }
  for (const entry of entries) {
    const id = String(entry.id);
    if (knownIds.has(id)) continue;
    knownIds.add(id);
    freshEvents.push(buildEvent('instagram_story', account.identifier, entry));
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
    return { events, state, error: 'Instagram: yt-dlp niedostępne' };
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
