import { Client, GatewayIntentBits, Events as DEvents, REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { Guilds } from '../store.js';
import { setClient, setStatus } from './runtime.js';
import { commandData, handleInteraction } from './commands.js';

const log = createLogger('bot');

let client = null;

async function registerCommands(appId) {
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  // Per-guild registration is instant; global can take up to an hour. We
  // register to every guild the bot is currently in for a snappy UX, plus
  // global as a fallback for guilds joined later.
  try {
    await rest.put(Routes.applicationCommands(appId), { body: commandData });
    log.info('Registered global slash commands', { count: commandData.length });
  } catch (err) {
    log.error('Global command registration failed', { err: err.message });
  }
  for (const [, guild] of client.guilds.cache) {
    try {
      await rest.put(Routes.applicationGuildCommands(appId, guild.id), { body: commandData });
    } catch (err) {
      log.warn('Guild command registration failed', { guild: guild.id, err: err.message });
    }
  }
}

function syncGuild(guild) {
  const preAuthorized = config.discord.authorizedGuildIds.includes(guild.id);
  const existing = Guilds.byGuildId(guild.id);
  Guilds.upsertFromDiscord({
    guild_id: guild.id,
    name: guild.name,
    icon_url: guild.iconURL?.() || null,
    member_count: guild.memberCount,
  });
  if (preAuthorized && (!existing || !existing.authorized)) {
    Guilds.setAuthorized(guild.id, true);
    log.info('Auto-authorized guild from env', { guild: guild.name });
  }
}

export async function startBot() {
  if (!config.discord.token) {
    log.warn('DISCORD_TOKEN not set — bot disabled, web panel still runs');
    setStatus({ online: false, ready: false, error: 'Brak DISCORD_TOKEN' });
    return null;
  }

  client = new Client({ intents: [GatewayIntentBits.Guilds] });
  setClient(client);

  client.once(DEvents.ClientReady, async (c) => {
    log.info('Discord bot ready', { tag: c.user.tag, guilds: c.guilds.cache.size });
    setStatus({ online: true, ready: true, error: null, since: new Date().toISOString() });
    for (const [, guild] of c.guilds.cache) syncGuild(guild);
    await registerCommands(c.user.id);
  });

  client.on(DEvents.GuildCreate, (guild) => {
    log.info('Joined guild', { guild: guild.name, id: guild.id });
    syncGuild(guild);
    if (config.discord.clientId || client.user) {
      const rest = new REST({ version: '10' }).setToken(config.discord.token);
      rest
        .put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commandData })
        .catch((err) => log.warn('Command sync on join failed', { err: err.message }));
    }
  });

  client.on(DEvents.GuildDelete, (guild) => {
    log.info('Removed from guild', { guild: guild.name, id: guild.id });
  });

  client.on(DEvents.InteractionCreate, handleInteraction);

  client.on(DEvents.Error, (err) => {
    log.error('Discord client error', { err: err.message });
    setStatus({ error: err.message });
  });

  try {
    await client.login(config.discord.token);
  } catch (err) {
    log.error('Discord login failed', { err: err.message });
    setStatus({ online: false, ready: false, error: err.message });
  }
  return client;
}

export function getDiscordClient() {
  return client;
}
