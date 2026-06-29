import express from 'express';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import {
  Profiles,
  Accounts,
  Guilds,
  NotificationSettings,
  Events,
  Settings,
} from '../store.js';
import {
  PLATFORMS,
  PLATFORM_LABELS,
  EVENT_TYPES,
  EVENT_TYPE_MAP,
  NOTIFICATION_MODES,
  MODE_LABELS,
  TEMPLATE_VARIABLES,
  TEMPLATE_SAMPLE,
  DEFAULT_TEMPLATES,
} from '../constants.js';
import { validateTemplate, renderTemplate, previewTemplate } from '../notifications/templates.js';
import { getPlatform } from '../platforms/index.js';
import { sendTest } from '../notifications/dispatcher.js';
import { getStatus, getClient, isReady } from '../bot/runtime.js';
import { runOnce } from '../poller.js';
import { describeConfig, saveOverrides } from '../runtimeSettings.js';

const log = createLogger('api');
export const apiRouter = express.Router();

function wrap(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      log.error('API error', { path: req.path, err: err.message });
      res.status(err.status || 500).json({ error: err.message });
    });
  };
}

/* --------------------------------------------------------------------- meta */

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: config.version, uptime: process.uptime() });
});

apiRouter.get('/meta', (_req, res) => {
  res.json({
    app: { name: config.appName, version: config.version },
    platforms: PLATFORMS.map((p) => ({ key: p, label: PLATFORM_LABELS[p] })),
    eventTypes: EVENT_TYPES,
    modes: NOTIFICATION_MODES.map((m) => ({ key: m, label: MODE_LABELS[m] })),
    templateVariables: TEMPLATE_VARIABLES,
    templateSample: TEMPLATE_SAMPLE,
    defaultTemplates: DEFAULT_TEMPLATES,
    youtubeShortMaxSeconds: config.youtubeShortMaxSeconds,
  });
});

/* ------------------------------------------------------------- diagnostics */

apiRouter.get('/diagnostics', wrap(async (_req, res) => {
  const guilds = Guilds.all();
  const profiles = Profiles.all();
  const botStatus = getStatus();
  res.json({
    app: {
      name: config.appName,
      version: config.version,
      status: 'running',
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: config.startedAt.toISOString(),
      pollIntervalSeconds: config.pollIntervalSeconds,
      nodeVersion: process.version,
      logLevel: config.debug ? 'debug' : config.logLevel,
    },
    bot: {
      online: botStatus.ready,
      error: botStatus.error,
      since: botStatus.since,
    },
    counts: {
      guilds: guilds.length,
      authorizedGuilds: guilds.filter((g) => g.authorized).length,
      profiles: profiles.length,
      accounts: Accounts.all().length,
    },
    lastCheck: {
      at: Settings.get('last_check_at'),
      durationMs: Number(Settings.get('last_check_duration_ms') || 0),
    },
    recentErrors: Events.recentErrors(15),
  });
}));

/* ------------------------------------------------------------------ guilds */

apiRouter.get('/guilds', wrap(async (_req, res) => {
  res.json(Guilds.all());
}));

apiRouter.patch('/guilds/:guildId', wrap(async (req, res) => {
  const { authorized } = req.body;
  Guilds.setAuthorized(req.params.guildId, Boolean(authorized));
  res.json(Guilds.byGuildId(req.params.guildId));
}));

apiRouter.get('/guilds/:guildId/channels', wrap(async (req, res) => {
  if (!isReady()) return res.json([]);
  const guild = await getClient().guilds.fetch(req.params.guildId).catch(() => null);
  if (!guild) return res.json([]);
  const channels = await guild.channels.fetch();
  const text = [...channels.values()]
    .filter((c) => c && c.isTextBased?.() && !c.isThread?.())
    .map((c) => ({ id: c.id, name: c.name }));
  res.json(text);
}));

apiRouter.get('/guilds/:guildId/roles', wrap(async (req, res) => {
  if (!isReady()) return res.json([]);
  const guild = await getClient().guilds.fetch(req.params.guildId).catch(() => null);
  if (!guild) return res.json([]);
  const roles = await guild.roles.fetch();
  res.json(
    [...roles.values()]
      .filter((r) => r.name !== '@everyone')
      .map((r) => ({ id: r.id, name: r.name }))
  );
}));

/* ---------------------------------------------------------------- profiles */

function profileCard(p) {
  const accounts = Accounts.forProfile(p.id);
  return {
    ...p,
    accounts,
    integrations: accounts.map((a) => ({
      platform: a.platform,
      label: PLATFORM_LABELS[a.platform],
      display_name: a.display_name,
      input_url: a.input_url,
      enabled: Boolean(a.enabled),
      is_live: Boolean(a.is_live),
      last_error: a.last_error,
    })),
    stats: Events.statsForProfile(p.id),
  };
}

apiRouter.get('/profiles', wrap(async (_req, res) => {
  res.json(Profiles.all().map(profileCard));
}));

apiRouter.post('/profiles', wrap(async (req, res) => {
  const { name, notes, avatar_url } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nazwa jest wymagana' });
  const profile = Profiles.create({ name: name.trim(), notes, avatar_url });
  log.info('Profile created', { name: profile.name, id: profile.id });
  res.status(201).json(profileCard(profile));
}));

apiRouter.get('/profiles/:id', wrap(async (req, res) => {
  const profile = Profiles.byId(Number(req.params.id));
  if (!profile) return res.status(404).json({ error: 'Nie znaleziono profilu' });
  res.json(profileCard(profile));
}));

apiRouter.patch('/profiles/:id', wrap(async (req, res) => {
  const profile = Profiles.byId(Number(req.params.id));
  if (!profile) return res.status(404).json({ error: 'Nie znaleziono profilu' });
  const updated = Profiles.update(profile.id, req.body);
  res.json(profileCard(updated));
}));

apiRouter.delete('/profiles/:id', wrap(async (req, res) => {
  Profiles.remove(Number(req.params.id));
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- accounts */

apiRouter.post('/profiles/:id/accounts', wrap(async (req, res) => {
  const profile = Profiles.byId(Number(req.params.id));
  if (!profile) return res.status(404).json({ error: 'Nie znaleziono profilu' });
  const { platform, input } = req.body;
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Nieznana platforma' });
  if (!input || !input.trim()) return res.status(400).json({ error: 'Podaj link lub nazwę konta' });

  const mod = getPlatform(platform);
  let resolved;
  try {
    resolved = await mod.resolve(input.trim());
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }
  const account = Accounts.upsert(profile.id, platform, resolved);

  // Auto-set the profile avatar from the first account that has one.
  if (!profile.avatar_url && resolved.avatar_url) {
    Profiles.update(profile.id, { avatar_url: resolved.avatar_url });
  }
  log.info('Account linked', { profile: profile.name, platform, identifier: resolved.identifier });
  res.status(201).json(account);
}));

apiRouter.post('/accounts/:accountId/refresh', wrap(async (req, res) => {
  const account = Accounts.byId(Number(req.params.accountId));
  if (!account) return res.status(404).json({ error: 'Nie znaleziono konta' });
  const mod = getPlatform(account.platform);
  const resolved = await mod.resolve(account.input_url || account.identifier);
  const updated = Accounts.upsert(account.profile_id, account.platform, resolved);
  res.json(updated);
}));

apiRouter.patch('/accounts/:accountId', wrap(async (req, res) => {
  const account = Accounts.byId(Number(req.params.accountId));
  if (!account) return res.status(404).json({ error: 'Nie znaleziono konta' });
  if ('enabled' in req.body) Accounts.setEnabled(account.id, req.body.enabled);
  res.json(Accounts.byId(account.id));
}));

apiRouter.delete('/accounts/:accountId', wrap(async (req, res) => {
  Accounts.remove(Number(req.params.accountId));
  res.json({ ok: true });
}));

/* ----------------------------------------------------- notification settings */

apiRouter.get('/profiles/:id/settings', wrap(async (req, res) => {
  const profile = Profiles.byId(Number(req.params.id));
  if (!profile) return res.status(404).json({ error: 'Nie znaleziono profilu' });
  const guildId = req.query.guild_id;
  if (!guildId) {
    // Return per-guild grouping summary.
    return res.json({ guilds: Guilds.all(), settings: NotificationSettings.forProfile(profile.id) });
  }
  const settings = NotificationSettings.ensureForProfileGuild(profile.id, guildId);
  const order = EVENT_TYPES.map((e) => e.key);
  res.json({
    guild: Guilds.byGuildId(guildId),
    settings: settings
      .map((s) => ({ ...s, eventLabel: EVENT_TYPE_MAP[s.event_type]?.label }))
      .sort((a, b) => order.indexOf(a.event_type) - order.indexOf(b.event_type)),
  });
}));

apiRouter.patch('/settings/:settingId', wrap(async (req, res) => {
  const setting = NotificationSettings.byId(Number(req.params.settingId));
  if (!setting) return res.status(404).json({ error: 'Nie znaleziono ustawienia' });

  // Validate the template before saving so bad variables are rejected.
  if (typeof req.body.template === 'string') {
    const v = validateTemplate(req.body.template);
    if (!v.valid) return res.status(400).json({ error: v.error, unknown: v.unknown });
  }
  const updated = NotificationSettings.update(setting.id, req.body);
  res.json({ ...updated, eventLabel: EVENT_TYPE_MAP[updated.event_type]?.label });
}));

apiRouter.post('/settings/:settingId/test', wrap(async (req, res) => {
  const setting = NotificationSettings.byId(Number(req.params.settingId));
  if (!setting) return res.status(404).json({ error: 'Nie znaleziono ustawienia' });
  if (!setting.channel_id) return res.status(400).json({ error: 'Najpierw ustaw kanał Discord' });
  if (!isReady()) return res.status(503).json({ error: 'Bot Discord jest offline' });
  const result = await sendTest(setting);
  const ok = ['sent', 'panel_edited'].includes(result.status);
  // Always answer 200: a failed test is a diagnostic outcome, not an HTTP
  // error. The real reason is in `detail` so the panel can show it verbatim.
  res.json({ ok, status: result.status, detail: result.detail });
}));

/* ---------------------------------------------------------------- templates */

apiRouter.post('/templates/validate', wrap(async (req, res) => {
  res.json(validateTemplate(req.body.template || ''));
}));

apiRouter.post('/templates/preview', wrap(async (req, res) => {
  const { template, context } = req.body;
  const v = validateTemplate(template || '');
  res.json({
    valid: v.valid,
    error: v.error,
    unknown: v.unknown,
    preview: context ? renderTemplate(template || '', context) : previewTemplate(template || ''),
  });
}));

/* ------------------------------------------------------------------ events */

apiRouter.get('/events', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(
    Events.recent({
      limit,
      profile_id: req.query.profile_id ? Number(req.query.profile_id) : null,
      status: req.query.status || null,
    })
  );
}));

/* ----------------------------------------------------------- app settings */

apiRouter.get('/config', wrap(async (_req, res) => {
  res.json({ fields: describeConfig() });
}));

apiRouter.put('/config', wrap(async (req, res) => {
  saveOverrides(req.body || {});
  res.json({ ok: true, fields: describeConfig() });
}));

/* -------------------------------------------------------------- poll/manual */

apiRouter.post('/poll/run', wrap(async (_req, res) => {
  runOnce().catch((err) => log.error('Manual poll failed', { err: err.message }));
  res.json({ ok: true, message: 'Sprawdzanie uruchomione' });
}));
