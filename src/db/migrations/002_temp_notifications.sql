-- Tracks the temporary, pinging notification messages the bot sends in the
-- hybrid "pinned panel" mode, so it can delete the previous one of the same
-- type after sending a new one (own messages only — never the panel, never
-- user messages, never bulk).
CREATE TABLE IF NOT EXISTS temp_notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  profile_id  INTEGER,
  platform    TEXT,
  event_type  TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT,
  is_deleted  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_temp_notif_lookup
  ON temp_notifications(guild_id, channel_id, profile_id, platform, event_type, is_deleted);
