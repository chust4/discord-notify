import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import {
  Profiles,
  Accounts,
  Guilds,
  NotificationSettings,
  Settings,
} from '../store.js';
import { EVENT_TYPES, EVENT_TYPE_MAP, PLATFORM_LABELS } from '../constants.js';
import { sendTest } from '../notifications/dispatcher.js';
import { checkChannelPermissions, summarizeGuildPermissions } from './permissions.js';
import { getStatus } from './runtime.js';

const log = createLogger('bot:commands');

function isPrivileged(interaction) {
  if (config.discord.ownerIds.includes(interaction.user.id)) return true;
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function ephem(content) {
  return { content, ephemeral: true };
}

function findProfile(query) {
  if (!query) return null;
  const all = Profiles.all();
  return (
    all.find((p) => p.slug === query.toLowerCase()) ||
    all.find((p) => p.name.toLowerCase() === query.toLowerCase()) ||
    all.find((p) => String(p.id) === query) ||
    null
  );
}

const eventChoices = EVENT_TYPES.map((e) => ({ name: e.label, value: e.key }));

export const commandData = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Zarejestruj ten serwer i pokaż status autoryzacji'),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Pokaż status aplikacji i bota'),
  new SlashCommandBuilder()
    .setName('profiles')
    .setDescription('Wyświetl listę śledzonych profili twórców'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Lista dostępnych komend bota'),
  new SlashCommandBuilder()
    .setName('test_notification')
    .setDescription('Wyślij testowe powiadomienie na ten serwer')
    .addStringOption((o) =>
      o.setName('profile').setDescription('Nazwa lub slug profilu').setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('event')
        .setDescription('Typ powiadomienia')
        .setRequired(true)
        .addChoices(...eventChoices.slice(0, 25))
    ),
  new SlashCommandBuilder()
    .setName('channel_set')
    .setDescription('Ustaw kanał powiadomień dla profilu na tym serwerze')
    .addStringOption((o) =>
      o.setName('profile').setDescription('Nazwa lub slug profilu').setRequired(true)
    )
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Kanał docelowy').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('notify_on')
    .setDescription('Włącz powiadomienia profilu na tym serwerze')
    .addStringOption((o) =>
      o.setName('profile').setDescription('Nazwa lub slug profilu').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('notify_off')
    .setDescription('Wyłącz powiadomienia profilu na tym serwerze')
    .addStringOption((o) =>
      o.setName('profile').setDescription('Nazwa lub slug profilu').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('panel_create')
    .setDescription('Utwórz panel (edytowaną wiadomość) dla zdarzenia w tym kanale')
    .addStringOption((o) =>
      o.setName('profile').setDescription('Nazwa lub slug profilu').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('event').setDescription('Typ zdarzenia').setRequired(true).addChoices(...eventChoices.slice(0, 25))
    )
    .addBooleanOption((o) =>
      o.setName('pinned').setDescription('Przypiąć panel?').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('panel_refresh')
    .setDescription('Odśwież panel testową treścią')
    .addStringOption((o) =>
      o.setName('profile').setDescription('Nazwa lub slug profilu').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('event').setDescription('Typ zdarzenia').setRequired(true).addChoices(...eventChoices.slice(0, 25))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('panel_remove')
    .setDescription('Usuń skonfigurowany panel zdarzenia')
    .addStringOption((o) =>
      o.setName('profile').setDescription('Nazwa lub slug profilu').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('event').setDescription('Typ zdarzenia').setRequired(true).addChoices(...eventChoices.slice(0, 25))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((c) => c.toJSON());

/* ------------------------------------------------------------------ handlers */

const handlers = {
  async setup(interaction) {
    const guild = interaction.guild;
    Guilds.upsertFromDiscord({
      guild_id: guild.id,
      name: guild.name,
      icon_url: guild.iconURL?.() || null,
      member_count: guild.memberCount,
    });
    const authorized = Guilds.isAuthorized(guild.id);
    const perms = summarizeGuildPermissions(guild);
    const missing = Object.entries(perms)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    const embed = new EmbedBuilder()
      .setTitle('🔧 Setup — Discord Notify')
      .setColor(authorized ? 0x57f287 : 0xfee75c)
      .setDescription(
        authorized
          ? '✅ Ten serwer jest **autoryzowany**. Powiadomienia mogą być wysyłane.'
          : '⚠️ Ten serwer **nie jest jeszcze autoryzowany**.\n' +
              'Wejdź do panelu webowego → sekcja **Serwery** i autoryzuj ten serwer.'
      )
      .addFields(
        { name: 'Guild ID', value: `\`${guild.id}\``, inline: true },
        { name: 'Status', value: authorized ? 'Autoryzowany' : 'Oczekuje', inline: true },
        {
          name: 'Uprawnienia bota',
          value: missing.length ? `❌ Brakuje: ${missing.join(', ')}` : '✅ Wszystkie wymagane obecne',
        }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },

  async status(interaction) {
    const st = getStatus();
    const profiles = Profiles.all();
    const guilds = Guilds.all();
    const lastCheck = Settings.get('last_check_at') || 'nigdy';
    const embed = new EmbedBuilder()
      .setTitle('📊 Status — Discord Notify')
      .setColor(0x5865f2)
      .addFields(
        { name: 'Bot', value: st.ready ? '🟢 Online' : '🔴 Offline', inline: true },
        { name: 'Serwery', value: String(guilds.length), inline: true },
        { name: 'Autoryzowane', value: String(guilds.filter((g) => g.authorized).length), inline: true },
        { name: 'Profile', value: String(profiles.length), inline: true },
        { name: 'Wersja', value: config.version, inline: true },
        { name: 'Ostatnie sprawdzenie', value: String(lastCheck), inline: false }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },

  async profiles(interaction) {
    const profiles = Profiles.all();
    if (profiles.length === 0) return interaction.reply(ephem('Brak profili. Dodaj je w panelu webowym.'));
    const lines = profiles.map((p) => {
      const accs = Accounts.forProfile(p.id)
        .map((a) => PLATFORM_LABELS[a.platform])
        .join(', ');
      return `${p.enabled ? '🟢' : '⚪'} **${p.name}** — ${accs || 'brak integracji'}`;
    });
    const embed = new EmbedBuilder()
      .setTitle('👥 Profile twórców')
      .setColor(0x5865f2)
      .setDescription(lines.join('\n').slice(0, 4000));
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },

  async help(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('❓ Pomoc — Discord Notify')
      .setColor(0x5865f2)
      .setDescription(
        [
          '`/setup` — zarejestruj serwer i sprawdź autoryzację',
          '`/status` — status aplikacji i bota',
          '`/profiles` — lista profili',
          '`/test_notification` — wyślij testowe powiadomienie',
          '`/channel_set` — ustaw kanał powiadomień',
          '`/notify_on` — włącz powiadomienia profilu tutaj',
          '`/notify_off` — wyłącz powiadomienia profilu tutaj',
          '`/panel_create` — utwórz panel w tym kanale',
          '`/panel_refresh` — odśwież panel',
          '`/panel_remove` — usuń panel',
          '`/help` — ta pomoc',
        ].join('\n')
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },

  async test_notification(interaction) {
    if (!Guilds.isAuthorized(interaction.guild.id))
      return interaction.reply(ephem('⚠️ Serwer nieautoryzowany. Autoryzuj go w panelu.'));
    const profile = findProfile(interaction.options.getString('profile'));
    if (!profile) return interaction.reply(ephem('Nie znaleziono profilu.'));
    const eventType = interaction.options.getString('event');
    let setting = NotificationSettings.forProfileGuild(profile.id, interaction.guild.id).find(
      (s) => s.event_type === eventType
    );
    if (!setting) {
      NotificationSettings.ensureForProfileGuild(profile.id, interaction.guild.id);
      setting = NotificationSettings.forProfileGuild(profile.id, interaction.guild.id).find(
        (s) => s.event_type === eventType
      );
    }
    if (!setting) return interaction.reply(ephem('Brak konfiguracji dla tego zdarzenia.'));
    // Use the current channel if none configured.
    const target = { ...setting, channel_id: setting.channel_id || interaction.channel.id };
    await interaction.deferReply({ ephemeral: true });
    const res = await sendTest(target);
    return interaction.editReply(
      res.status === 'sent' || res.status === 'panel_edited'
        ? '✅ Wysłano test.'
        : `❌ Nie wysłano: ${res.detail || res.status}`
    );
  },

  async channel_set(interaction) {
    if (!isPrivileged(interaction)) return interaction.reply(ephem('Brak uprawnień.'));
    const profile = findProfile(interaction.options.getString('profile'));
    if (!profile) return interaction.reply(ephem('Nie znaleziono profilu.'));
    const channel = interaction.options.getChannel('channel');
    NotificationSettings.ensureForProfileGuild(profile.id, interaction.guild.id);
    const settings = NotificationSettings.forProfileGuild(profile.id, interaction.guild.id);
    for (const s of settings) NotificationSettings.update(s.id, { channel_id: channel.id });
    const perm = checkChannelPermissions(channel);
    const warn = perm.missing.length ? `\n⚠️ Uwaga, brakuje: ${perm.missing.map((m) => m.label).join(', ')}` : '';
    return interaction.reply(ephem(`✅ Ustawiono kanał <#${channel.id}> dla **${profile.name}**.${warn}`));
  },

  async notify_on(interaction) {
    return toggleNotify(interaction, true);
  },
  async notify_off(interaction) {
    return toggleNotify(interaction, false);
  },

  async panel_create(interaction) {
    if (!isPrivileged(interaction)) return interaction.reply(ephem('Brak uprawnień.'));
    const profile = findProfile(interaction.options.getString('profile'));
    if (!profile) return interaction.reply(ephem('Nie znaleziono profilu.'));
    const eventType = interaction.options.getString('event');
    const pinned = interaction.options.getBoolean('pinned');
    NotificationSettings.ensureForProfileGuild(profile.id, interaction.guild.id);
    const setting = NotificationSettings.forProfileGuild(profile.id, interaction.guild.id).find(
      (s) => s.event_type === eventType
    );
    if (!setting) return interaction.reply(ephem('Brak konfiguracji zdarzenia.'));
    NotificationSettings.update(setting.id, {
      mode: pinned ? 'pinned_panel' : 'panel',
      channel_id: interaction.channel.id,
      enabled: 1,
      panel_message_id: null,
      panel_channel_id: null,
    });
    await interaction.deferReply({ ephemeral: true });
    const fresh = NotificationSettings.byId(setting.id);
    const res = await sendTest({ ...fresh, channel_id: interaction.channel.id });
    return interaction.editReply(
      res.status === 'sent' || res.status === 'panel_edited'
        ? `✅ Panel utworzony w tym kanale dla **${EVENT_TYPE_MAP[eventType].label}**.`
        : `❌ Nie udało się: ${res.detail || res.status}`
    );
  },

  async panel_refresh(interaction) {
    if (!isPrivileged(interaction)) return interaction.reply(ephem('Brak uprawnień.'));
    const profile = findProfile(interaction.options.getString('profile'));
    if (!profile) return interaction.reply(ephem('Nie znaleziono profilu.'));
    const eventType = interaction.options.getString('event');
    const setting = NotificationSettings.forProfileGuild(profile.id, interaction.guild.id).find(
      (s) => s.event_type === eventType
    );
    if (!setting) return interaction.reply(ephem('Brak konfiguracji zdarzenia.'));
    await interaction.deferReply({ ephemeral: true });
    const res = await sendTest(setting);
    return interaction.editReply(`Status: ${res.status}${res.detail ? ` — ${res.detail}` : ''}`);
  },

  async panel_remove(interaction) {
    if (!isPrivileged(interaction)) return interaction.reply(ephem('Brak uprawnień.'));
    const profile = findProfile(interaction.options.getString('profile'));
    if (!profile) return interaction.reply(ephem('Nie znaleziono profilu.'));
    const eventType = interaction.options.getString('event');
    const setting = NotificationSettings.forProfileGuild(profile.id, interaction.guild.id).find(
      (s) => s.event_type === eventType
    );
    if (!setting) return interaction.reply(ephem('Brak konfiguracji zdarzenia.'));
    if (setting.panel_message_id) {
      try {
        const ch = await interaction.client.channels.fetch(setting.panel_channel_id);
        const msg = await ch.messages.fetch(setting.panel_message_id);
        await msg.delete();
      } catch {
        /* already gone */
      }
    }
    NotificationSettings.update(setting.id, {
      mode: 'embed',
      panel_message_id: null,
      panel_channel_id: null,
    });
    return interaction.reply(ephem('✅ Panel usunięty.'));
  },
};

async function toggleNotify(interaction, enabled) {
  if (!isPrivileged(interaction)) return interaction.reply(ephem('Brak uprawnień.'));
  const profile = findProfile(interaction.options.getString('profile'));
  if (!profile) return interaction.reply(ephem('Nie znaleziono profilu.'));
  NotificationSettings.ensureForProfileGuild(profile.id, interaction.guild.id);
  const settings = NotificationSettings.forProfileGuild(profile.id, interaction.guild.id);
  for (const s of settings) NotificationSettings.update(s.id, { enabled: enabled ? 1 : 0 });
  return interaction.reply(
    ephem(`${enabled ? '✅ Włączono' : '⏸️ Wyłączono'} powiadomienia **${profile.name}** na tym serwerze.`)
  );
}

export async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) {
    return interaction.reply(ephem('Komendy działają tylko na serwerze.'));
  }
  const handler = handlers[interaction.commandName];
  if (!handler) return;
  try {
    await handler(interaction);
  } catch (err) {
    log.error('Command handler failed', { command: interaction.commandName, err: err.message });
    const msg = ephem(`❌ Błąd: ${err.message}`);
    if (interaction.deferred || interaction.replied) interaction.editReply(msg).catch(() => {});
    else interaction.reply(msg).catch(() => {});
  }
}
