import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('avatar');

// Social avatar URLs (TikTok `x-expires`, Instagram `oe=`, etc.) are signed and
// EXPIRE, so a URL stored days ago no longer loads in the browser. We fetch the
// image server-side (no browser referrer, which some CDNs also block) and cache
// the bytes on disk in the data volume, re-fetching when the cache goes stale.
const dir = path.join(config.dataDir, 'avatars');
const TTL_MS = 6 * 60 * 60 * 1000; // consider a cached file fresh for 6h
const UA =
  'Mozilla/5.0 (compatible; DiscordNotifyBot/1.0; +https://github.com/chust4/discord-notify)';

function safeKey(key) {
  return String(key).replace(/[^a-z0-9_-]/gi, '_');
}
function fileFor(key) {
  return path.join(dir, safeKey(key));
}

/** Return a cached file path if it exists and is younger than the TTL. */
export function freshCache(key) {
  try {
    const f = fileFor(key);
    const st = fs.statSync(f);
    if (st.size > 0 && Date.now() - st.mtimeMs < TTL_MS) return f;
  } catch {
    /* miss */
  }
  return null;
}

/** Return a cached file path if it exists at all (even stale). */
export function anyCache(key) {
  try {
    const f = fileFor(key);
    if (fs.statSync(f).size > 0) return f;
  } catch {
    /* miss */
  }
  return null;
}

export function cacheContentType(key) {
  try {
    return fs.readFileSync(fileFor(key) + '.ct', 'utf8') || 'image/jpeg';
  } catch {
    return 'image/jpeg';
  }
}

/** Download `url` into the cache under `key`. Returns the file path or null. */
export async function fetchToCache(key, url) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/*,*/*' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!/^image\//i.test(ct)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fileFor(key), buf);
    fs.writeFileSync(fileFor(key) + '.ct', ct);
    return fileFor(key);
  } catch (err) {
    log.debug('Avatar download failed', { url: String(url).slice(0, 60), err: err.message });
    return null;
  }
}
