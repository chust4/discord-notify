import { config } from './config.js';
import { Settings } from './store.js';
import { invalidateToken } from './platforms/twitch.js';
import { createLogger } from './logger.js';

const log = createLogger('config:runtime');

// API credentials / tunables that can be set from the web panel. Values are
// stored in the settings table under `cfg.<key>` and override the env defaults.
export const MANAGED_FIELDS = [
  {
    key: 'youtube_api_key', label: 'YouTube Data API Key', type: 'secret',
    requirement: 'optional',
    help: 'Opcjonalny. Bez niego nowe filmy YouTube i tak działają (RSS). Klucz dodaje avatary oraz rozróżnianie Shorts vs film i wykrywanie YouTube live.',
  },
  {
    key: 'twitch_client_id', label: 'Twitch Client ID', type: 'text',
    requirement: 'required-twitch',
    help: 'Wymagany, jeśli śledzisz Twitch — bez niego wykrywanie live na Twitch nie działa.',
  },
  {
    key: 'twitch_client_secret', label: 'Twitch Client Secret', type: 'secret',
    requirement: 'required-twitch',
    help: 'Wymagany, jeśli śledzisz Twitch — razem z Client ID. Bez niego brak wykrywania Twitch live.',
  },
  {
    key: 'sign_api_key', label: 'TikTok SIGN_API_KEY (EulerStream)', type: 'secret',
    requirement: 'optional',
    help: 'Opcjonalny. TikTok live i nowe filmy (yt-dlp) działają bez niego — klucz tylko zwiększa limity zapytań TikTok live.',
  },
  {
    key: 'youtube_short_max_seconds', label: 'YouTube Shorts: maks. długość (s)', type: 'number',
    requirement: 'setting',
    help: 'To ustawienie, nie klucz API. Film krótszy niż ta wartość = Short, równy/dłuższy = zwykły film.',
  },
  {
    key: 'instagram_session_id', label: 'Instagram Session (cookies)', type: 'secret',
    requirement: 'required-instagram',
    help: 'Wymagany dla Instagrama (posty/Reels/Stories) — Instagram nie ma publicznego API. Najłatwiej ustawić przez wtyczkę przeglądarki (browser-extension/ w repo) — robi to automatycznie. Ręcznie: JSON {"sessionid":"...","csrftoken":"...","ds_user_id":"..."} — samo sessionid NIE wystarczy. ⚠️ Użyj DEDYKOWANEGO/zapasowego konta, nie głównego — automatyzacja sesji łamie regulamin Instagrama i grozi ograniczeniem konta.',
  },
];

const skey = (k) => `cfg.${k}`;

function applyOne(key, value) {
  switch (key) {
    case 'youtube_api_key':
      config.youtube.apiKey = value;
      process.env.YOUTUBE_API_KEY = value;
      break;
    case 'twitch_client_id':
      config.twitch.clientId = value;
      break;
    case 'twitch_client_secret':
      config.twitch.clientSecret = value;
      break;
    case 'sign_api_key':
      config.tiktok.signApiKey = value;
      process.env.SIGN_API_KEY = value; // read directly by tiktok-live-connector
      break;
    case 'youtube_short_max_seconds': {
      const n = parseInt(value, 10);
      if (Number.isFinite(n) && n > 0) config.youtubeShortMaxSeconds = n;
      break;
    }
    case 'instagram_session_id':
      config.instagram.sessionId = value;
      break;
  }
}

function effective(key) {
  switch (key) {
    case 'youtube_api_key': return config.youtube.apiKey;
    case 'twitch_client_id': return config.twitch.clientId;
    case 'twitch_client_secret': return config.twitch.clientSecret;
    case 'sign_api_key': return config.tiktok.signApiKey;
    case 'youtube_short_max_seconds': return String(config.youtubeShortMaxSeconds);
    case 'instagram_session_id': return config.instagram.sessionId;
    default: return '';
  }
}

function mask(v) {
  if (!v) return '';
  return v.length > 4 ? `••••${v.slice(-4)}` : '••••';
}

/** Load DB overrides onto the live config at startup. */
export function applyConfigOverrides() {
  let applied = 0;
  for (const f of MANAGED_FIELDS) {
    const v = Settings.get(skey(f.key));
    if (v == null || v === '') continue;
    applyOne(f.key, v);
    applied += 1;
  }
  if (applied) log.info('Loaded configuration overrides from database', { count: applied });
}

/** Persist + apply values from the panel. Empty value = leave unchanged. */
export function saveOverrides(values = {}) {
  let twitchChanged = false;
  for (const f of MANAGED_FIELDS) {
    if (!(f.key in values)) continue;
    const str = values[f.key] == null ? '' : String(values[f.key]).trim();
    if (str === '') continue; // keep existing value
    Settings.set(skey(f.key), str);
    applyOne(f.key, str);
    if (f.key.startsWith('twitch_')) twitchChanged = true;
  }
  if (twitchChanged) {
    try {
      invalidateToken();
    } catch {
      /* noop */
    }
  }
  log.info('Configuration overrides saved from panel', { keys: Object.keys(values) });
}

/** Masked view for the UI (never returns raw secrets). */
export function describeConfig() {
  return MANAGED_FIELDS.map((f) => {
    const dbVal = Settings.get(skey(f.key));
    const eff = effective(f.key);
    const base = {
      key: f.key,
      label: f.label,
      type: f.type,
      help: f.help,
      requirement: f.requirement || 'optional',
      source: dbVal != null && dbVal !== '' ? 'panel' : eff ? 'env' : 'none',
      set: Boolean(eff),
    };
    if (f.type === 'secret') return { ...base, hint: mask(eff) };
    return { ...base, value: eff || '' };
  });
}
