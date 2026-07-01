-- Optional emoji reaction the bot adds to a notification message after
-- sending it. NULL/empty = no reaction (existing rows keep this default).
ALTER TABLE notification_settings ADD COLUMN reaction_emoji TEXT;
