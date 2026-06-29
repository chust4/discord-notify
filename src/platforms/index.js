import * as youtube from './youtube.js';
import * as tiktok from './tiktok.js';
import * as twitch from './twitch.js';
import * as kick from './kick.js';

export const platforms = { youtube, tiktok, twitch, kick };

export function getPlatform(name) {
  const p = platforms[name];
  if (!p) throw new Error(`Nieobsługiwana platforma: ${name}`);
  return p;
}
