import { PermissionsBitField } from 'discord.js';

// Permissions the bot needs to fully operate.
export const REQUIRED_PERMISSIONS = [
  { key: 'ViewChannel', flag: PermissionsBitField.Flags.ViewChannel, label: 'Wyświetlanie kanału' },
  { key: 'SendMessages', flag: PermissionsBitField.Flags.SendMessages, label: 'Wysyłanie wiadomości' },
  { key: 'EmbedLinks', flag: PermissionsBitField.Flags.EmbedLinks, label: 'Osadzanie linków (embed)' },
  { key: 'ManageMessages', flag: PermissionsBitField.Flags.ManageMessages, label: 'Zarządzanie wiadomościami (pin/edit panel)' },
  { key: 'ReadMessageHistory', flag: PermissionsBitField.Flags.ReadMessageHistory, label: 'Czytanie historii wiadomości' },
];

/**
 * Inspect the bot's permissions in a specific channel.
 * Returns { ok, missing: [{key,label}], permissions: {key: bool} }.
 */
export function checkChannelPermissions(channel) {
  const result = { ok: true, missing: [], permissions: {} };
  if (!channel || !channel.guild) {
    return { ok: false, missing: REQUIRED_PERMISSIONS.map((p) => ({ key: p.key, label: p.label })), permissions: {} };
  }
  const me = channel.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  for (const p of REQUIRED_PERMISSIONS) {
    const has = perms ? perms.has(p.flag) : false;
    result.permissions[p.key] = has;
    if (!has) {
      result.missing.push({ key: p.key, label: p.label });
      // Missing pin/manage is non-fatal for plain messages; mark not-ok only
      // for the essentials so the caller can decide.
      if (['SendMessages', 'ViewChannel'].includes(p.key)) result.ok = false;
    }
  }
  return result;
}

/** A coarse guild-level snapshot for the diagnostics panel. */
export function summarizeGuildPermissions(guild) {
  const me = guild.members.me;
  const perms = me ? me.permissions : null;
  const out = {};
  for (const p of REQUIRED_PERMISSIONS) {
    out[p.key] = perms ? perms.has(p.flag) : false;
  }
  return out;
}
