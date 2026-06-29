import { httpGetJson } from './http.js';
import { createLogger } from '../logger.js';

const log = createLogger('platform:kick');

function slugFromInput(input) {
  const value = String(input).trim();
  const m = value.match(/kick\.com\/([A-Za-z0-9_-]+)/i);
  return (m ? m[1] : value.replace(/^@/, '')).toLowerCase();
}

async function fetchChannel(slug) {
  // Public Kick v2 endpoint. May be rate-limited / Cloudflare-protected.
  return httpGetJson(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
    headers: { Accept: 'application/json' },
  });
}

export async function resolve(input) {
  const slug = slugFromInput(input);
  let display_name = slug;
  let avatar_url = null;
  try {
    const data = await fetchChannel(slug);
    display_name = data?.user?.username || slug;
    avatar_url = data?.user?.profile_pic || null;
  } catch (err) {
    log.warn('Kick resolve failed, storing slug only', { slug, err: err.message });
  }
  return {
    identifier: slug,
    display_name,
    avatar_url,
    input_url: `https://kick.com/${slug}`,
  };
}

export async function check(account) {
  const events = [];
  const state = { is_live: account.is_live, live_id: account.live_id };

  let data;
  try {
    data = await fetchChannel(account.identifier);
  } catch (err) {
    return { events, state, error: err.message };
  }

  const livestream = data?.livestream;
  const wasLive = Boolean(account.is_live);
  const nowLive = Boolean(livestream && livestream.is_live);

  if (nowLive && !wasLive) {
    state.is_live = 1;
    state.live_id = String(livestream.id);
    events.push({
      event_type: 'kick_live_start',
      external_id: `${livestream.id}:start`,
      title: livestream.session_title || '',
      url: `https://kick.com/${account.identifier}`,
      thumbnail_url: livestream.thumbnail?.url || '',
      published_at: livestream.created_at || new Date().toISOString(),
      duration: '',
      viewer_count: String(livestream.viewer_count ?? ''),
      category: livestream.categories?.[0]?.name || '',
    });
  } else if (!nowLive && wasLive) {
    state.is_live = 0;
    events.push({
      event_type: 'kick_live_end',
      external_id: `${account.live_id || 'session'}:end`,
      title: '',
      url: `https://kick.com/${account.identifier}`,
      thumbnail_url: '',
      published_at: new Date().toISOString(),
      duration: '',
      viewer_count: '',
      category: '',
    });
    state.live_id = null;
  } else if (nowLive) {
    state.live_id = String(livestream.id);
  }

  return { events, state, error: null };
}
