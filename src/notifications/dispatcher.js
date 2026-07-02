import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getClient, isReady } from '../bot/runtime.js';
import { checkChannelPermissions } from '../bot/permissions.js';
import { renderTemplate } from './templates.js';
import {
  NotificationSettings,
  Events,
  Profiles,
  Guilds,
  TempNotifications,
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
  // A raw, expiring direct-media link (e.g. Instagram Stories) — shown as a
  // short clickable field inside the embed (Discord renders [text](url) here,
  // unlike plain message content) instead of a huge raw URL that would also
  // trigger Discord's own duplicate auto-embed if placed in message text.
  if (event.raw_media_url) lines.push(`**Plik:** [Otwórz bezpośredni link](${event.raw_media_url})`);
  if (lines.length) embed.setDescription(lines.join('\n'));

  if (event.thumbnail_url) embed.setImage(event.thumbnail_url);
  return embed;
}

function colorFor(platform) {
  return (
    {
      youtube: 0xff0000,
      tiktok: 0x00f2ea,
      twitch: 0x9146ff,
      kick: 0x53fc18,
      instagram: 0xe1306c,
    }[platform] || 0x5865f2
  );
}

/**
 * Best-effort: react to a just-sent/edited notification message with the
 * configured emoji. Never throws — a bad/invalid emoji or missing permission
 * must not fail the notification itself.
 */
async function addReactionIfConfigured(message, setting) {
  if (!setting.reaction_emoji || !message) return;
  try {
    await message.react(setting.reaction_emoji);
    log.info('Added reaction to notification', {
      setting_id: setting.id, message_id: message.id, emoji: setting.reaction_emoji,
    });
  } catch (err) {
    log.warn('Could not add reaction to notification', {
      setting_id: setting.id, message_id: message.id, emoji: setting.reaction_emoji, err: err.message,
    });
  }
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
  const embed = buildEmbed(event, context, profile, account);
  const allowedMentions = buildAllowedMentions(setting.role_ping_id);

  try {
    // Plain "panel": a single rolling message that is DELETED and re-sent on
    // each event (not edited), so the role ping actually fires a Discord
    // notification — editing a message never re-notifies. The previous one is
    // removed so the channel keeps only the latest.
    if (mode === 'panel') {
      const payload = { embeds: [embed], allowedMentions };
      if (content) payload.content = isTest ? `🧪 (TEST) ${content}` : content;
      await repostNotification({ channel, setting, event, profile, account, payload });
      return { status: EVENT_STATUS.SENT, detail: 'Wysłano nowe powiadomienie, usunięto poprzednie' };
    }

    // Hybrid pinned panel: a persistent pinned status embed edited in place,
    // PLUS a separate lightweight pinging message (deleted+resent). The ping
    // message carries no embed, so it no longer visually duplicates the panel.
    if (mode === 'pinned_panel') {
      return await sendHybridPinnedPanel({
        channel, setting, event, profile, account, embed, content, context, allowedMentions, perm, isTest,
      });
    }

    // embed / message modes.
    const payload = { allowedMentions };
    if (mode === 'embed') {
      payload.embeds = [embed];
      if (content) payload.content = isTest ? `🧪 (TEST) ${content}` : content;
    } else {
      const body = content || `${context.creator_name} — ${event.url || ''}`.trim();
      payload.content = (isTest ? '🧪 (TEST) ' : '') + body;
    }
    const sent = await channel.send(payload);
    await addReactionIfConfigured(sent, setting);
    return { status: EVENT_STATUS.SENT, detail: null };
  } catch (err) {
    if (err.code === 50013) {
      return { status: EVENT_STATUS.NO_PERMISSION, detail: err.message };
    }
    return { status: EVENT_STATUS.SEND_FAILED, detail: err.message };
  }
}

/** Limit pings to exactly the configured role (or @everyone/@here, or none). */
function buildAllowedMentions(role_ping_id) {
  if (!role_ping_id) return { parse: [] };
  if (role_ping_id === 'everyone' || role_ping_id === 'here') return { parse: ['everyone'] };
  return { parse: [], roles: [role_ping_id] };
}

/**
 * Send a fresh notification message, record it, and delete the bot's own
 * PREVIOUS message of the same (guild, channel, profile, platform, event_type).
 * A brand-new message (unlike an edit) fires the role ping; deleting the prior
 * one keeps the channel to a single rolling notification. Single deletes only —
 * never bulk, never user messages, never the pinned panel.
 */
async function repostNotification({ channel, setting, event, profile, account, payload }) {
  const sent = await channel.send(payload);
  await addReactionIfConfigured(sent, setting);

  const key = {
    guild_id: setting.guild_id,
    channel_id: channel.id,
    profile_id: profile.id,
    platform: account?.platform || event.platform || null,
    event_type: event.event_type,
  };
  const newId = TempNotifications.record({ ...key, message_id: sent.id });
  log.info('Notification sent + recorded', { event: event.event_type, message_id: sent.id });

  for (const prev of TempNotifications.findActivePrevious({ ...key, excludeId: newId })) {
    try {
      await channel.messages.delete(prev.message_id);
      TempNotifications.markDeleted(prev.id);
      log.info('Deleted previous notification', { message_id: prev.message_id });
    } catch (err) {
      // Own messages can normally be deleted without Manage Messages; treat any
      // failure (already gone / missing permission) as non-fatal.
      TempNotifications.markDeleted(prev.id);
      const reason = err.code === 10008 ? 'wiadomość już nie istnieje'
        : err.code === 50013 ? 'brak uprawnień (Manage Messages)'
        : err.message;
      log.warn('Could not delete previous notification', { message_id: prev.message_id, reason });
    }
  }
  return sent;
}

/**
 * Hybrid "przypięty panel" (pinned panel):
 *  1. maintain the persistent, pinned status embed — edited in place, never
 *     deleted, and carrying no content/mentions so it never pings;
 *  2. send a separate, lightweight pinging message via repostNotification —
 *     content only (link auto-embed suppressed) so it does NOT visually
 *     duplicate the panel sitting right above it.
 */
async function sendHybridPinnedPanel({
  channel, setting, event, profile, account, embed, content, context, allowedMentions, perm, isTest,
}) {
  // --- 1. persistent pinned panel (rich embed, no ping) ---
  const panelPayload = { embeds: [embed] };
  let panelMsg = null;
  if (setting.panel_message_id && setting.panel_channel_id === channel.id) {
    try {
      panelMsg = await channel.messages.fetch(setting.panel_message_id);
      await panelMsg.edit(panelPayload);
      log.info('Pinned panel updated', { setting_id: setting.id, channel: channel.id });
    } catch {
      panelMsg = null;
      log.warn('Pinned panel missing, recreating', { setting_id: setting.id });
    }
  }
  if (!panelMsg) {
    panelMsg = await channel.send(panelPayload);
    NotificationSettings.setPanelMessage(setting.id, panelMsg.id, channel.id);
    log.info('Pinned panel created', { setting_id: setting.id, message_id: panelMsg.id });
    if (perm.permissions.ManageMessages) {
      try {
        await panelMsg.pin();
      } catch (err) {
        log.warn('Could not pin panel', { err: err.message });
      }
    }
  }

  // --- 2. lightweight pinging notification (no duplicate embed) ---
  const line = content || `${context.creator_name} — ${event.url || ''}`.trim();
  await repostNotification({
    channel, setting, event, profile, account,
    payload: {
      content: (isTest ? '🧪 (TEST) ' : '') + line,
      allowedMentions,
      flags: MessageFlags.SuppressEmbeds,
    },
  });

  return { status: EVENT_STATUS.PANEL_EDITED, detail: 'Panel zaktualizowany + wysłano powiadomienie' };
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
