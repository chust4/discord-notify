import { EmbedBuilder } from 'discord.js';
import { getClient, isReady } from '../bot/runtime.js';
import { checkChannelPermissions } from '../bot/permissions.js';
import { renderTemplate } from './templates.js';
import {
  NotificationSettings,
  Events,
  Profiles,
  Guilds,
} from '../store.js';
import {
  EVENT_STATUS,
  EVENT_TYPE_MAP,
  PLATFORM_LABELS,
  DEFAULT_TEMPLATES,
} from '../constants.js';
import { createLogger } from '../logger.js';

const log = createLogger('dispatcher');

/**
 * Build the variable context for a template from an event + profile + guild.
 */
function buildContext(event, profile, account, guild, channel, setting) {
  let role_ping = '';
  if (setting.role_ping_id) {
    role_ping =
      setting.role_ping_id === 'everyone'
        ? '@everyone'
        : setting.role_ping_id === 'here'
        ? '@here'
        : `<@&${setting.role_ping_id}>`;
  }
  return {
    creator_name: account?.display_name || profile.name,
    platform: PLATFORM_LABELS[event.platform || account?.platform] || '',
    title: event.title || '',
    url: event.url || '',
    thumbnail_url: event.thumbnail_url || '',
    published_at: event.published_at
      ? new Date(event.published_at).toLocaleString('pl-PL')
      : '',
    duration: event.duration || '',
    viewer_count: event.viewer_count || '',
    category: event.category || '',
    guild_name: guild?.name || '',
    channel_name: channel?.name || '',
    role_ping,
  };
}

function buildEmbed(event, context, profile, account) {
  const meta = EVENT_TYPE_MAP[event.event_type];
  const embed = new EmbedBuilder()
    .setTitle(event.title || meta?.label || 'Powiadomienie')
    .setColor(colorFor(account?.platform || event.platform))
    .setTimestamp(event.published_at ? new Date(event.published_at) : new Date());

  if (event.url) embed.setURL(event.url);
  embed.setAuthor({
    name: context.creator_name,
    iconURL: account?.avatar_url || profile.avatar_url || undefined,
  });

  const lines = [];
  if (context.platform) lines.push(`**Platforma:** ${context.platform}`);
  if (context.category) lines.push(`**Kategoria:** ${context.category}`);
  if (context.viewer_count) lines.push(`**Widzowie:** ${context.viewer_count}`);
  if (context.duration) lines.push(`**Długość:** ${context.duration}`);
  if (lines.length) embed.setDescription(lines.join('\n'));

  if (event.thumbnail_url) embed.setImage(event.thumbnail_url);
  return embed;
}

function colorFor(platform) {
  return (
    { youtube: 0xff0000, tiktok: 0x00f2ea, twitch: 0x9146ff, kick: 0x53fc18 }[platform] ||
    0x5865f2
  );
}

/**
 * Send a single notification according to its configured mode. Returns a
 * status string for the events log.
 */
async function sendOne({ setting, event, profile, account, isTest = false }) {
  const client = getClient();
  if (!isReady() || !client) return { status: EVENT_STATUS.SEND_FAILED, detail: 'Bot offline' };

  if (!Guilds.isAuthorized(setting.guild_id)) {
    return { status: EVENT_STATUS.NO_PERMISSION, detail: 'Serwer nieautoryzowany' };
  }

  let channel;
  try {
    channel = await client.channels.fetch(setting.channel_id);
  } catch (err) {
    return { status: EVENT_STATUS.SEND_FAILED, detail: `Kanał niedostępny: ${err.message}` };
  }
  if (!channel || !channel.isTextBased?.()) {
    return { status: EVENT_STATUS.SEND_FAILED, detail: 'Kanał nie jest tekstowy' };
  }

  const perm = checkChannelPermissions(channel);
  if (!perm.ok) {
    return {
      status: EVENT_STATUS.NO_PERMISSION,
      detail: `Brak uprawnień: ${perm.missing.map((m) => m.label).join(', ')}`,
    };
  }

  const guild = channel.guild;
  const context = buildContext(event, profile, account, guild, channel, setting);
  const template = setting.template || DEFAULT_TEMPLATES[event.event_type] || '';
  const content = renderTemplate(template, context);

  const mode = setting.mode || 'embed';
  const payload = {};
  if (mode === 'embed' || mode === 'panel' || mode === 'pinned_panel') {
    payload.embeds = [buildEmbed(event, context, profile, account)];
    // Keep ping/text outside the embed so role mentions actually ping.
    if (content) payload.content = isTest ? `🧪 (TEST) ${content}` : content;
  } else {
    // Plain message: Discord rejects an empty body, so fall back to a minimal
    // line if the template rendered to nothing.
    const body = content || `${context.creator_name} — ${event.url || ''}`.trim();
    payload.content = (isTest ? '🧪 (TEST) ' : '') + body;
  }

  try {
    if (mode === 'panel' || mode === 'pinned_panel') {
      const result = await sendOrEditPanel({ client, channel, setting, payload, perm, mode });
      return result;
    }
    await channel.send(payload);
    return { status: EVENT_STATUS.SENT, detail: null };
  } catch (err) {
    if (err.code === 50013) {
      return { status: EVENT_STATUS.NO_PERMISSION, detail: err.message };
    }
    return { status: EVENT_STATUS.SEND_FAILED, detail: err.message };
  }
}

/**
 * Panel mode: edit the stored message if it still exists, otherwise create a
 * new one and persist its id. Pin when in pinned_panel mode and allowed.
 */
async function sendOrEditPanel({ client, channel, setting, payload, perm, mode }) {
  if (setting.panel_message_id && setting.panel_channel_id === channel.id) {
    try {
      const msg = await channel.messages.fetch(setting.panel_message_id);
      await msg.edit(payload);
      return { status: EVENT_STATUS.PANEL_EDITED, detail: 'Zaktualizowano panel' };
    } catch {
      // Message was deleted - fall through and recreate.
      log.warn('Panel message missing, recreating', { setting_id: setting.id });
    }
  }

  const msg = await channel.send(payload);
  NotificationSettings.setPanelMessage(setting.id, msg.id, channel.id);

  if (mode === 'pinned_panel' && perm.permissions.ManageMessages) {
    try {
      await msg.pin();
    } catch (err) {
      log.warn('Could not pin panel', { err: err.message });
    }
  }
  return { status: EVENT_STATUS.SENT, detail: 'Utworzono panel' };
}

/**
 * Public entry point: dispatch a detected event to every matching, enabled
 * notification setting for the profile. Records an events-log row per target.
 */
export async function dispatchEvent({ event, profile, account }) {
  const settings = NotificationSettings.activeForEvent(profile.id, event.event_type);
  if (settings.length === 0) {
    Events.log({
      profile_id: profile.id,
      account_id: account?.id,
      platform: account?.platform || event.platform,
      event_type: event.event_type,
      external_id: event.external_id,
      title: event.title,
      url: event.url,
      status: EVENT_STATUS.DETECTED,
      detail: 'Brak aktywnych powiadomień dla tego zdarzenia',
    });
    return;
  }

  for (const setting of settings) {
    const guild = Guilds.byGuildId(setting.guild_id);
    const { status, detail } = await sendOne({ setting, event, profile, account });
    Events.log({
      profile_id: profile.id,
      account_id: account?.id,
      platform: account?.platform || event.platform,
      event_type: event.event_type,
      external_id: event.external_id,
      title: event.title,
      url: event.url,
      status,
      detail,
      guild_id: setting.guild_id,
      channel_id: setting.channel_id,
    });
    if (status === EVENT_STATUS.SENT || status === EVENT_STATUS.PANEL_EDITED) {
      Profiles.setLastEvent(profile.id, event.event_type);
      log.info('Notification sent', {
        profile: profile.name,
        event: event.event_type,
        guild: guild?.name,
        status,
      });
    } else {
      Profiles.setLastError(profile.id, detail || status);
      log.warn('Notification not delivered', {
        profile: profile.name,
        event: event.event_type,
        status,
        detail,
      });
    }
  }
}

/**
 * Send a one-off test notification for a given notification setting.
 */
export async function sendTest(setting) {
  const profile = Profiles.byId(setting.profile_id);
  const account = null;
  const meta = EVENT_TYPE_MAP[setting.event_type];
  const event = {
    event_type: setting.event_type,
    platform: meta?.platform,
    external_id: `test-${Date.now()}`,
    title: `[TEST] ${meta?.label || 'Powiadomienie'}`,
    url: 'https://example.com',
    thumbnail_url: '',
    published_at: new Date().toISOString(),
    duration: '12:34',
    viewer_count: '1234',
    category: 'Test',
  };
  const { status, detail } = await sendOne({ setting, event, profile, account, isTest: true });
  Events.log({
    profile_id: profile?.id,
    platform: meta?.platform,
    event_type: setting.event_type,
    status,
    detail: `TEST: ${detail || 'OK'}`,
    guild_id: setting.guild_id,
    channel_id: setting.channel_id,
  });
  return { status, detail };
}
