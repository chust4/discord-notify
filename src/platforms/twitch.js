import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('platform:twitch');

let token = null;
let tokenExpiry = 0;

function hasCreds() {
  return Boolean(config.twitch.clientId && config.twitch.clientSecret);
}

async function getAppToken() {
  if (!hasCreds()) throw new Error('Brak TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET');
  if (token && Date.now() < tokenExpiry - 60000) return token;

  const params = new URLSearchParams({
    client_id: config.twitch.clientId,
    client_secret: config.twitch.clientSecret,
    grant_type: 'client_credentials',
  });
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: params,
  });
  if (!res.ok) throw new Error(`Twitch token HTTP ${res.status}`);
  const data = await res.json();
  token = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return token;
}

async function helix(path) {
  const t = await getAppToken();
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
    headers: { 'Client-ID': config.twitch.clientId, Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(`Twitch Helix HTTP ${res.status} for ${path}`);
  return res.json();
}

function loginFromInput(input) {
  const value = String(input).trim();
  const m = value.match(/twitch\.tv\/([A-Za-z0-9_]+)/i);
  return (m ? m[1] : value.replace(/^@/, '')).toLowerCase();
}

export async function resolve(input) {
  const login = loginFromInput(input);
  let display_name = login;
  let avatar_url = null;
  try {
    const data = await helix(`users?login=${encodeURIComponent(login)}`);
    const user = data.data?.[0];
    if (!user) throw new Error(`Nie znaleziono kanału Twitch: ${login}`);
    display_name = user.display_name || login;
    avatar_url = user.profile_image_url || null;
  } catch (err) {
    log.warn('Twitch resolve failed, storing login only', { login, err: err.message });
  }
  return {
    identifier: login,
    display_name,
    avatar_url,
    input_url: `https://twitch.tv/${login}`,
  };
}

/**
 * Detect live start / end via the streams endpoint.
 */
export async function check(account) {
  const events = [];
  const state = { is_live: account.is_live, live_id: account.live_id };

  if (!hasCreds()) {
    return { events, state, error: 'Twitch API nie skonfigurowane (brak credentials)' };
  }

  let stream;
  try {
    const data = await helix(`streams?user_login=${encodeURIComponent(account.identifier)}`);
    stream = data.data?.[0] || null;
  } catch (err) {
    return { events, state, error: err.message };
  }

  const wasLive = Boolean(account.is_live);
  const nowLive = Boolean(stream);

  if (nowLive && !wasLive) {
    state.is_live = 1;
    state.live_id = stream.id;
    events.push({
      event_type: 'twitch_live_start',
      external_id: `${stream.id}:start`,
      title: stream.title,
      url: `https://twitch.tv/${account.identifier}`,
      thumbnail_url: (stream.thumbnail_url || '')
        .replace('{width}', '1280')
        .replace('{height}', '720'),
      published_at: stream.started_at,
      duration: '',
      viewer_count: String(stream.viewer_count ?? ''),
      category: stream.game_name || '',
    });
  } else if (!nowLive && wasLive) {
    state.is_live = 0;
    events.push({
      event_type: 'twitch_live_end',
      external_id: `${account.live_id || 'session'}:end`,
      title: '',
      url: `https://twitch.tv/${account.identifier}`,
      thumbnail_url: '',
      published_at: new Date().toISOString(),
      duration: '',
      viewer_count: '',
      category: '',
    });
    state.live_id = null;
  } else if (nowLive) {
    // Still live - keep latest id.
    state.live_id = stream.id;
  }

  return { events, state, error: null };
}
