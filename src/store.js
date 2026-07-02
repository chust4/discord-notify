import { getDb } from './db/index.js';
import {
  EVENT_TYPES,
  DEFAULT_TEMPLATES,
  eventTypesForPlatform,
} from './constants.js';

export function slugify(name) {
  const base = String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'profil';
}

function nowIso() {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ settings */

export const Settings = {
  get(key, fallback = null) {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  },
  set(key, value) {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value == null ? null : String(value));
  },
  getJson(key, fallback = null) {
    const v = Settings.get(key);
    if (v == null) return fallback;
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  setJson(key, value) {
    Settings.set(key, JSON.stringify(value));
  },
};

/* -------------------------------------------------------------------- guilds */

export const Guilds = {
  upsertFromDiscord({ guild_id, name, icon_url, member_count }) {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guild_id);
    if (existing) {
      db.prepare(
        `UPDATE guilds SET name = ?, icon_url = ?, member_count = ?, updated_at = ?
         WHERE guild_id = ?`
      ).run(name, icon_url, member_count, nowIso(), guild_id);
      return db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guild_id);
    }
    db.prepare(
      `INSERT INTO guilds (guild_id, name, icon_url, member_count, joined_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(guild_id, name, icon_url, member_count, nowIso());
    return db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guild_id);
  },
  all() {
    return getDb().prepare('SELECT * FROM guilds ORDER BY name COLLATE NOCASE').all();
  },
  byGuildId(guild_id) {
    return getDb().prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guild_id);
  },
  setAuthorized(guild_id, authorized) {
    getDb()
      .prepare('UPDATE guilds SET authorized = ?, updated_at = ? WHERE guild_id = ?')
      .run(authorized ? 1 : 0, nowIso(), guild_id);
  },
  isAuthorized(guild_id) {
    const g = Guilds.byGuildId(guild_id);
    return Boolean(g && g.authorized);
  },
  remove(guild_id) {
    getDb().prepare('DELETE FROM guilds WHERE guild_id = ?').run(guild_id);
  },
};

/* ------------------------------------------------------------------ profiles */

export const Profiles = {
  create({ name, avatar_url = null, notes = null, enabled = 1 }) {
    const db = getDb();
    let slug = slugify(name);
    let n = 1;
    while (db.prepare('SELECT 1 FROM profiles WHERE slug = ?').get(slug)) {
      slug = `${slugify(name)}-${++n}`;
    }
    const info = db
      .prepare(
        `INSERT INTO profiles (name, slug, avatar_url, notes, enabled)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(name, slug, avatar_url, notes, enabled ? 1 : 0);
    return Profiles.byId(info.lastInsertRowid);
  },
  update(id, fields) {
    const allowed = ['name', 'avatar_url', 'notes', 'enabled'];
    const sets = [];
    const vals = [];
    for (const key of allowed) {
      if (key in fields) {
        sets.push(`${key} = ?`);
        vals.push(key === 'enabled' ? (fields[key] ? 1 : 0) : fields[key]);
      }
    }
    if (sets.length) {
      sets.push('updated_at = ?');
      vals.push(nowIso(), id);
      getDb().prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    return Profiles.byId(id);
  },
  byId(id) {
    return getDb().prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  },
  all() {
    return getDb().prepare('SELECT * FROM profiles ORDER BY name COLLATE NOCASE').all();
  },
  remove(id) {
    getDb().prepare('DELETE FROM profiles WHERE id = ?').run(id);
  },
  setLastEvent(id, event_type) {
    getDb()
      .prepare('UPDATE profiles SET last_event_type = ?, last_event_at = ? WHERE id = ?')
      .run(event_type, nowIso(), id);
  },
  setLastError(id, error) {
    getDb()
      .prepare('UPDATE profiles SET last_error = ?, last_error_at = ? WHERE id = ?')
      .run(error, error ? nowIso() : null, id);
  },
};

/* ------------------------------------------------------------------ accounts */

export const Accounts = {
  forProfile(profile_id) {
    return getDb()
      .prepare('SELECT * FROM accounts WHERE profile_id = ? ORDER BY platform')
      .all(profile_id);
  },
  byId(id) {
    return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  },
  all() {
    return getDb().prepare('SELECT * FROM accounts WHERE enabled = 1').all();
  },
  upsert(profile_id, platform, resolved) {
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM accounts WHERE profile_id = ? AND platform = ?')
      .get(profile_id, platform);
    if (existing) {
      db.prepare(
        `UPDATE accounts SET identifier = ?, input_url = ?, display_name = ?,
         avatar_url = ?, updated_at = ? WHERE id = ?`
      ).run(
        resolved.identifier,
        resolved.input_url,
        resolved.display_name,
        resolved.avatar_url,
        nowIso(),
        existing.id
      );
      return Accounts.byId(existing.id);
    }
    const info = db
      .prepare(
        `INSERT INTO accounts (profile_id, platform, identifier, input_url, display_name, avatar_url)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        profile_id,
        platform,
        resolved.identifier,
        resolved.input_url,
        resolved.display_name,
        resolved.avatar_url
      );
    return Accounts.byId(info.lastInsertRowid);
  },
  updateState(id, state) {
    const db = getDb();
    const sets = ['last_checked_at = ?'];
    const vals = [nowIso()];
    if ('last_video_id' in state && state.last_video_id !== undefined) {
      sets.push('last_video_id = ?');
      vals.push(state.last_video_id);
    }
    if ('is_live' in state && state.is_live !== undefined) {
      sets.push('is_live = ?');
      vals.push(state.is_live ? 1 : 0);
    }
    if ('live_id' in state) {
      sets.push('live_id = ?');
      vals.push(state.live_id ?? null);
    }
    vals.push(id);
    db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  },
  setError(id, error) {
    getDb()
      .prepare('UPDATE accounts SET last_error = ?, last_checked_at = ? WHERE id = ?')
      .run(error, nowIso(), id);
  },
  setAvatar(id, url) {
    getDb()
      .prepare('UPDATE accounts SET avatar_url = ?, updated_at = ? WHERE id = ?')
      .run(url, nowIso(), id);
  },
  remove(id) {
    getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
  },
  setEnabled(id, enabled) {
    getDb()
      .prepare('UPDATE accounts SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, nowIso(), id);
  },
};

/* ------------------------------------------------------ notification settings */

export const NotificationSettings = {
  /**
   * Return notification settings for a profile + guild, creating defaults for
   * every relevant event type (based on the platforms the profile actually has).
   */
  ensureForProfileGuild(profile_id, guild_id) {
    const db = getDb();
    const platforms = new Set(
      Accounts.forProfile(profile_id).map((a) => a.platform)
    );
    const relevant = EVENT_TYPES.filter((e) => platforms.has(e.platform));
    const insert = db.prepare(
      `INSERT OR IGNORE INTO notification_settings
       (profile_id, guild_id, event_type, enabled, mode, template)
       VALUES (?, ?, ?, 0, 'embed', ?)`
    );
    const tx = db.transaction(() => {
      for (const e of relevant) {
        insert.run(profile_id, guild_id, e.key, DEFAULT_TEMPLATES[e.key] || '');
      }
    });
    tx();
    return NotificationSettings.forProfileGuild(profile_id, guild_id);
  },
  forProfileGuild(profile_id, guild_id) {
    return getDb()
      .prepare(
        'SELECT * FROM notification_settings WHERE profile_id = ? AND guild_id = ? ORDER BY event_type'
      )
      .all(profile_id, guild_id);
  },
  forProfile(profile_id) {
    return getDb()
      .prepare('SELECT * FROM notification_settings WHERE profile_id = ?')
      .all(profile_id);
  },
  byId(id) {
    return getDb().prepare('SELECT * FROM notification_settings WHERE id = ?').get(id);
  },
  /** Active settings matching an event type for a profile (across guilds). */
  activeForEvent(profile_id, event_type) {
    return getDb()
      .prepare(
        `SELECT * FROM notification_settings
         WHERE profile_id = ? AND event_type = ? AND enabled = 1 AND channel_id IS NOT NULL`
      )
      .all(profile_id, event_type);
  },
  update(id, fields) {
    const allowed = [
      'enabled',
      'channel_id',
      'mode',
      'template',
      'role_ping_id',
      'panel_message_id',
      'panel_channel_id',
      'reaction_emoji',
    ];
    const sets = [];
    const vals = [];
    for (const key of allowed) {
      if (key in fields) {
        sets.push(`${key} = ?`);
        vals.push(key === 'enabled' ? (fields[key] ? 1 : 0) : fields[key]);
      }
    }
    if (sets.length) {
      sets.push('updated_at = ?');
      vals.push(nowIso(), id);
      getDb()
        .prepare(`UPDATE notification_settings SET ${sets.join(', ')} WHERE id = ?`)
        .run(...vals);
    }
    return NotificationSettings.byId(id);
  },
  setPanelMessage(id, message_id, channel_id) {
    getDb()
      .prepare(
        'UPDATE notification_settings SET panel_message_id = ?, panel_channel_id = ?, updated_at = ? WHERE id = ?'
      )
      .run(message_id, channel_id, nowIso(), id);
  },
};

/* -------------------------------------------------------------------- events */

export const Events = {
  log({
    profile_id = null,
    account_id = null,
    platform = null,
    event_type = null,
    external_id = null,
    title = null,
    url = null,
    status,
    detail = null,
    guild_id = null,
    channel_id = null,
  }) {
    getDb()
      .prepare(
        `INSERT INTO events
         (profile_id, account_id, platform, event_type, external_id, title, url, status, detail, guild_id, channel_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        profile_id,
        account_id,
        platform,
        event_type,
        external_id,
        title,
        url,
        status,
        detail,
        guild_id,
        channel_id
      );
  },
  recent({ limit = 100, profile_id = null, status = null } = {}) {
    let sql = 'SELECT * FROM events';
    const where = [];
    const vals = [];
    if (profile_id) {
      where.push('profile_id = ?');
      vals.push(profile_id);
    }
    if (status) {
      where.push('status = ?');
      vals.push(status);
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY id DESC LIMIT ?';
    vals.push(limit);
    return getDb().prepare(sql).all(...vals);
  },
  recentErrors(limit = 20) {
    return getDb()
      .prepare(
        `SELECT * FROM events
         WHERE status IN ('api_error','no_permission','send_failed')
         ORDER BY id DESC LIMIT ?`
      )
      .all(limit);
  },
  /**
   * At-a-glance stats for a profile: notifications delivered per platform,
   * total delivered, detected events and failures. Test sends (detail prefixed
   * "TEST:") are excluded, and counting starts after the last manual reset.
   */
  statsForProfile(profile_id) {
    const db = getDb();
    // Reset baseline stored in the same datetime() format as events.created_at
    // so string comparison is correct.
    const resetAt = Settings.get(`stats_reset.${profile_id}`) || '1970-01-01 00:00:00';
    const NOT_TEST = `(detail IS NULL OR detail NOT LIKE 'TEST:%')`;

    const sentRows = db
      .prepare(
        `SELECT platform, COUNT(*) AS c FROM events
         WHERE profile_id = @pid AND status IN ('sent','panel_edited')
           AND created_at > @resetAt AND ${NOT_TEST}
         GROUP BY platform`
      )
      .all({ pid: profile_id, resetAt });
    const sentByPlatform = {};
    let totalSent = 0;
    for (const r of sentRows) {
      if (r.platform) sentByPlatform[r.platform] = r.c;
      totalSent += r.c;
    }
    const detected = db
      .prepare(
        `SELECT COUNT(*) AS c FROM events
         WHERE profile_id = @pid AND status = 'detected'
           AND created_at > @resetAt AND ${NOT_TEST}`
      )
      .get({ pid: profile_id, resetAt }).c;
    const failed = db
      .prepare(
        `SELECT COUNT(*) AS c FROM events
         WHERE profile_id = @pid AND status IN ('api_error','no_permission','send_failed')
           AND created_at > @resetAt AND ${NOT_TEST}`
      )
      .get({ pid: profile_id, resetAt }).c;
    return { sentByPlatform, totalSent, detected, failed };
  },
  /** Reset a profile's notification counters (keeps history rows). */
  resetStats(profile_id) {
    const t = getDb().prepare("SELECT datetime('now') AS t").get().t;
    Settings.set(`stats_reset.${profile_id}`, t);
    return t;
  },
  /** Delete history rows older than the retention window. */
  purgeOlderThan(days) {
    return getDb()
      .prepare(`DELETE FROM events WHERE created_at < datetime('now', ?)`)
      .run(`-${days} days`).changes;
  },
};

/* ----------------------------------------------------------------- seen items */

export const Seen = {
  has(account_id, event_type, external_id) {
    return Boolean(
      getDb()
        .prepare(
          'SELECT 1 FROM seen_items WHERE account_id = ? AND event_type = ? AND external_id = ?'
        )
        .get(account_id, event_type, external_id)
    );
  },
  /** Returns true if it was newly inserted (i.e. not a duplicate). */
  mark(account_id, event_type, external_id) {
    const info = getDb()
      .prepare(
        'INSERT OR IGNORE INTO seen_items (account_id, event_type, external_id) VALUES (?, ?, ?)'
      )
      .run(account_id, event_type, external_id);
    return info.changes > 0;
  },
  purgeOlderThan(days) {
    return getDb()
      .prepare(`DELETE FROM seen_items WHERE created_at < datetime('now', ?)`)
      .run(`-${days} days`).changes;
  },
};

/* ------------------------------------------------------ temp notifications */

export const TempNotifications = {
  record({ guild_id, channel_id, profile_id = null, platform = null, event_type, message_id }) {
    return getDb()
      .prepare(
        `INSERT INTO temp_notifications
         (guild_id, channel_id, profile_id, platform, event_type, message_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(guild_id, channel_id, profile_id, platform, event_type, message_id).lastInsertRowid;
  },
  /** Active (not-yet-deleted) temp notifications for the same target, newest-first. */
  findActivePrevious({ guild_id, channel_id, profile_id, platform, event_type, excludeId = -1 }) {
    return getDb()
      .prepare(
        `SELECT * FROM temp_notifications
         WHERE guild_id = ? AND channel_id = ?
           AND IFNULL(profile_id, -1) = IFNULL(?, -1)
           AND IFNULL(platform, '') = IFNULL(?, '')
           AND event_type = ?
           AND is_deleted = 0
           AND id <> ?
         ORDER BY id DESC`
      )
      .all(guild_id, channel_id, profile_id, platform, event_type, excludeId);
  },
  markDeleted(id) {
    getDb()
      .prepare(
        `UPDATE temp_notifications SET is_deleted = 1, deleted_at = datetime('now') WHERE id = ?`
      )
      .run(id);
  },
  purgeOlderThan(days) {
    return getDb()
      .prepare(`DELETE FROM temp_notifications WHERE created_at < datetime('now', ?)`)
      .run(`-${days} days`).changes;
  },
};

export { eventTypesForPlatform };
