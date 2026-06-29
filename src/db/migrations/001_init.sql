-- Core schema for Discord Notify.

-- Key/value store for app diagnostics & runtime metadata.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Discord servers (guilds) the bot is in. Notifications are only sent to
-- guilds where authorized = 1 (authorized by the app owner in the panel).
CREATE TABLE IF NOT EXISTS guilds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT UNIQUE NOT NULL,
  name        TEXT,
  icon_url    TEXT,
  authorized  INTEGER NOT NULL DEFAULT 0,
  member_count INTEGER,
  joined_at   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Creator profiles. A profile groups one or more platform accounts.
CREATE TABLE IF NOT EXISTS profiles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  avatar_url      TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  last_event_type TEXT,
  last_event_at   TEXT,
  last_error      TEXT,
  last_error_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Platform accounts linked to a profile (youtube|tiktok|twitch|kick).
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id    INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
  identifier    TEXT NOT NULL,   -- canonical id/handle/slug used by the poller
  input_url     TEXT,            -- original value the user entered
  display_name  TEXT,
  avatar_url    TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_video_id TEXT,
  is_live       INTEGER NOT NULL DEFAULT 0,
  live_id       TEXT,
  last_checked_at TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(profile_id, platform)
);

-- Per profile + guild + event-type notification configuration.
CREATE TABLE IF NOT EXISTS notification_settings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id       INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  guild_id         TEXT NOT NULL,
  event_type       TEXT NOT NULL,   -- youtube_video, youtube_short, ...
  enabled          INTEGER NOT NULL DEFAULT 0,
  channel_id       TEXT,
  mode             TEXT NOT NULL DEFAULT 'embed', -- message|embed|panel|pinned_panel
  template         TEXT,
  role_ping_id     TEXT,
  panel_message_id TEXT,
  panel_channel_id TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(profile_id, guild_id, event_type)
);

-- Event history / audit log.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  platform    TEXT,
  event_type  TEXT,
  external_id TEXT,
  title       TEXT,
  url         TEXT,
  -- detected | sent | skipped_duplicate | api_error | no_permission |
  -- panel_edited | send_failed
  status      TEXT NOT NULL,
  detail      TEXT,
  guild_id    TEXT,
  channel_id  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_profile ON events(profile_id);

-- Anti-duplicate ledger. A row here means "we have already handled this item",
-- so a container restart will not re-send the same video/live.
CREATE TABLE IF NOT EXISTS seen_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, event_type, external_id)
);
