// Central definitions shared by the bot, web API and frontend.

export const PLATFORMS = ['youtube', 'tiktok', 'twitch', 'kick', 'instagram'];

export const PLATFORM_LABELS = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  twitch: 'Twitch',
  kick: 'Kick',
  instagram: 'Instagram',
};

export const NOTIFICATION_MODES = ['message', 'embed', 'panel', 'pinned_panel'];

// Default emoji reaction the bot adds after sending a notification (opt-in
// per event type; quick-pick choices offered alongside a free-text input).
export const DEFAULT_REACTION_EMOJI = '❤️';
export const REACTION_EMOJI_CHOICES = ['❤️', '🔥', '🎉', '👀', '🔔', '👍'];

export const MODE_LABELS = {
  message: 'Zwykła wiadomość',
  embed: 'Embed Discord',
  panel: 'Panel (edytowana wiadomość)',
  pinned_panel: 'Przypięty panel',
};

// All notification event types. `platform` ties an event to an account,
// `live` marks it as a stream event (handled by live state transitions).
export const EVENT_TYPES = [
  { key: 'youtube_video', platform: 'youtube', label: 'YouTube nowy film', live: false },
  { key: 'youtube_short', platform: 'youtube', label: 'YouTube Shorts', live: false },
  { key: 'youtube_live', platform: 'youtube', label: 'YouTube live', live: true },
  { key: 'tiktok_video', platform: 'tiktok', label: 'TikTok nowy film', live: false },
  { key: 'tiktok_live', platform: 'tiktok', label: 'TikTok live', live: true },
  { key: 'twitch_live_start', platform: 'twitch', label: 'Twitch live start', live: true },
  { key: 'twitch_live_end', platform: 'twitch', label: 'Twitch live end', live: true },
  { key: 'kick_live_start', platform: 'kick', label: 'Kick live start', live: true },
  { key: 'kick_live_end', platform: 'kick', label: 'Kick live end', live: true },
  { key: 'instagram_post', platform: 'instagram', label: 'Instagram nowy post', live: false, requiresSession: true },
  { key: 'instagram_reel', platform: 'instagram', label: 'Instagram Reels', live: false, requiresSession: true },
  { key: 'instagram_story', platform: 'instagram', label: 'Instagram Stories', live: false, requiresSession: true, experimental: true },
];

export const EVENT_TYPE_KEYS = EVENT_TYPES.map((e) => e.key);

export const EVENT_TYPE_MAP = Object.fromEntries(
  EVENT_TYPES.map((e) => [e.key, e])
);

export function eventTypesForPlatform(platform) {
  return EVENT_TYPES.filter((e) => e.platform === platform);
}

// Allowed template variables. Templates referencing anything outside this list
// are rejected by the validator.
export const TEMPLATE_VARIABLES = [
  'creator_name',
  'platform',
  'title',
  'url',
  'thumbnail_url',
  'published_at',
  'duration',
  'viewer_count',
  'category',
  'guild_name',
  'channel_name',
  'role_ping',
];

// Sample values used for the live preview in the panel.
export const TEMPLATE_SAMPLE = {
  creator_name: 'Przykładowy Twórca',
  platform: 'YouTube',
  title: 'Najnowszy film na kanale!',
  url: 'https://youtu.be/dQw4w9WgXcQ',
  thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  published_at: '2026-06-29 18:00',
  duration: '12:34',
  viewer_count: '1234',
  category: 'Just Chatting',
  guild_name: 'Mój Serwer',
  channel_name: 'powiadomienia',
  role_ping: '@everyone',
};

export const DEFAULT_TEMPLATES = {
  youtube_video:
    '🎬 **{creator_name}** dodał nowy film na {platform}!\n**{title}**\n{url} {role_ping}',
  youtube_short:
    '📱 **{creator_name}** dodał nowego Shorta!\n**{title}**\n{url} {role_ping}',
  youtube_live:
    '🔴 **{creator_name}** jest LIVE na {platform}!\n**{title}**\n{url} {role_ping}',
  tiktok_video:
    '🎵 **{creator_name}** dodał nowy film na TikTok!\n**{title}**\n{url} {role_ping}',
  tiktok_live:
    '🔴 **{creator_name}** jest LIVE na TikTok!\n{url} {role_ping}',
  twitch_live_start:
    '🟣 **{creator_name}** rozpoczął transmisję na Twitch!\n**{title}**\n🎮 {category} | 👀 {viewer_count}\n{url} {role_ping}',
  twitch_live_end:
    '⚫ **{creator_name}** zakończył transmisję na Twitch.',
  kick_live_start:
    '🟢 **{creator_name}** rozpoczął transmisję na Kick!\n**{title}**\n🎮 {category}\n{url} {role_ping}',
  kick_live_end:
    '⚫ **{creator_name}** zakończył transmisję na Kick.',
  instagram_post:
    '🖼️ **{creator_name}** dodał nowy post na Instagramie!\n**{title}**\n{url} {role_ping}',
  instagram_reel:
    '🎞️ **{creator_name}** dodał nowego Reelsa!\n**{title}**\n{url} {role_ping}',
  instagram_story:
    '⭐ **{creator_name}** dodał nowe Story na Instagramie!\n{url} {role_ping}',
};

// Status values used in the events / history table.
export const EVENT_STATUS = {
  DETECTED: 'detected',
  SENT: 'sent',
  SKIPPED_DUPLICATE: 'skipped_duplicate',
  API_ERROR: 'api_error',
  NO_PERMISSION: 'no_permission',
  PANEL_EDITED: 'panel_edited',
  SEND_FAILED: 'send_failed',
};

export const SLASH_COMMANDS = [
  '/setup',
  '/status',
  '/profiles',
  '/test_notification',
  '/panel_create',
  '/panel_refresh',
  '/panel_remove',
  '/notify_on',
  '/notify_off',
  '/channel_set',
  '/help',
];
