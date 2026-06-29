import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('ytdlp');

let availability = null; // null = unknown, true/false once probed

/**
 * Run yt-dlp and return parsed JSON (single-json mode). Rejects on non-zero
 * exit, a missing binary (ENOENT), or a timeout. Never throws synchronously.
 */
function run(args, { timeoutMs = config.ytdlp.timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(config.ytdlp.path, args, { windowsHide: true });
    } catch (err) {
      return reject(err);
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`yt-dlp timeout po ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(stderr.trim().split('\n').pop() || `yt-dlp exit ${code}`));
      }
      resolve(stdout);
    });
  });
}

/** Probe once whether the yt-dlp binary is present and runnable. */
export async function isAvailable() {
  if (!config.ytdlp.enabled) return false;
  if (availability !== null) return availability;
  try {
    const out = await run(['--version'], { timeoutMs: 10000 });
    availability = true;
    log.info('yt-dlp available', { version: out.trim() });
  } catch (err) {
    availability = false;
    log.warn('yt-dlp not available — TikTok video detection will fall back to scraping', {
      err: err.message,
    });
  }
  return availability;
}

/**
 * Return a flat playlist (newest-first) of a channel/profile URL.
 * Each entry: { id, title, url, timestamp, duration, thumbnails }.
 */
export async function flatPlaylist(url, { limit = 12 } = {}) {
  const out = await run([
    '--flat-playlist',
    '--dump-single-json',
    '--no-warnings',
    '--no-progress',
    '--ignore-errors',
    '--playlist-end',
    String(limit),
    url,
  ]);
  const data = JSON.parse(out);
  const entries = Array.isArray(data.entries) ? data.entries : [];
  return entries.filter((e) => e && e.id);
}
