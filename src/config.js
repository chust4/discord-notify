import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env when present (local dev). In Docker the variables are injected by
// docker-compose, so a missing .env file is not an error.
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Version comes from package.json so it tracks the code automatically; an
// explicit APP_VERSION env still wins if set.
let pkgVersion = '1.0.0';
try {
  pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || pkgVersion;
} catch {
  /* keep fallback */
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const logDir = process.env.LOG_DIR || path.join(dataDir, 'logs');

export const config = {
  root,
  env: process.env.NODE_ENV || 'production',

  // Web server
  port: int(process.env.PORT, 8092),
  host: process.env.HOST || '0.0.0.0',
  appName: process.env.APP_NAME || 'Discord Notify',
  version: process.env.APP_VERSION || pkgVersion,

  // Storage
  dataDir,
  logDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, 'discord-notify.sqlite'),

  // Logging
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  debug: bool(process.env.DEBUG, false),
  logToFile: bool(process.env.LOG_TO_FILE, true),
  logRetentionDays: int(process.env.LOG_RETENTION_DAYS, 7),

  // Optional demo data on first start.
  seedDemo: bool(process.env.SEED_DEMO_DATA, false),

  // Polling
  pollIntervalSeconds: int(process.env.POLL_INTERVAL_SECONDS, 300),
  // YouTube videos shorter than this (seconds) are treated as Shorts.
  youtubeShortMaxSeconds: int(process.env.YOUTUBE_SHORT_MAX_SECONDS, 180),

  // Discord
  discord: {
    token: process.env.DISCORD_TOKEN || '',
    clientId: process.env.DISCORD_CLIENT_ID || '',
    // Optional: register slash commands only to this guild for fast iteration.
    devGuildId: process.env.DISCORD_DEV_GUILD_ID || '',
    // Guilds that are pre-authorized (in addition to ones authorized in the panel).
    authorizedGuildIds: list(process.env.DISCORD_AUTHORIZED_GUILD_IDS),
    // Discord user ids allowed to run privileged slash commands (/setup, etc.).
    ownerIds: list(process.env.DISCORD_OWNER_IDS),
  },

  // Platform API credentials (all optional, polling degrades gracefully).
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || '',
  },
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID || '',
    clientSecret: process.env.TWITCH_CLIENT_SECRET || '',
  },
  tiktok: {
    // Reliable TikTok LIVE detection via tiktok-live-connector. New-video
    // detection stays best-effort regardless of this flag.
    liveEnabled: bool(process.env.TIKTOK_LIVE_ENABLED, true),
    // Optional EulerStream sign key — read directly from env by the library;
    // only improves rate limits, not required for fetchIsLive().
    signApiKey: process.env.SIGN_API_KEY || '',
  },
  instagram: {
    // Instagram's post/reel/Stories listing requires an authenticated
    // session — there is no anonymous API. This is the `sessionid` cookie
    // value from a logged-in Instagram session. Strongly recommend a
    // dedicated/throwaway account: automating a session this way is against
    // Instagram's ToS and risks that account being restricted.
    sessionId: process.env.INSTAGRAM_SESSION_ID || '',
    // Posts/Reels/Stories are fetched via a small Instaloader (Python)
    // subprocess bundled in the image — see instaloader_fetch.py.
    enabled: bool(process.env.INSTAGRAM_ENABLED, true),
    pythonPath: process.env.INSTAGRAM_PYTHON_PATH || 'python3',
    timeoutMs: int(process.env.INSTAGRAM_TIMEOUT_MS, 30000),
  },

  // yt-dlp powers reliable TikTok new-video detection (and is reusable for
  // other platforms). Disable to fall back to HTML scraping.
  ytdlp: {
    enabled: bool(process.env.YTDLP_ENABLED, true),
    path: process.env.YTDLP_PATH || 'yt-dlp',
    timeoutMs: int(process.env.YTDLP_TIMEOUT_MS, 60000),
  },

  // Web panel basic auth (optional but recommended on a LAN).
  auth: {
    user: process.env.PANEL_USER || '',
    password: process.env.PANEL_PASSWORD || '',
  },

  startedAt: new Date(),
};

export function isAuthEnabled() {
  return Boolean(config.auth.user && config.auth.password);
}
