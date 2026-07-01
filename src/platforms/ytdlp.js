import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
 * `cookies` (optional) is a map of {name: value} sent as a Netscape-format
 * cookie file to yt-dlp — used for sites (e.g. Instagram) that require an
 * authenticated session to list content.
 */
export async function flatPlaylist(url, { limit = 12, cookies = null } = {}) {
  let cookieFile = null;
  const args = [
    '--flat-playlist',
    '--dump-single-json',
    '--no-warnings',
    '--no-progress',
    '--ignore-errors',
    '--playlist-end',
    String(limit),
  ];
  try {
    if (cookies && Object.keys(cookies).length) {
      cookieFile = writeNetscapeCookieFile(cookies);
      args.push('--cookies', cookieFile);
    }
    args.push(url);
    const out = await run(args);
    const data = JSON.parse(out);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return entries.filter((e) => e && e.id);
  } finally {
    if (cookieFile) fs.rm(cookieFile, { force: true }, () => {});
  }
}

/**
 * Write a throwaway Netscape-format cookie file (the format yt-dlp/curl
 * expect via --cookies) for the given domain + {name: value} map. Caller is
 * responsible for deleting the returned path when done.
 */
function writeNetscapeCookieFile(cookies, domain = '.instagram.com') {
  const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365; // 1 year
  const lines = ['# Netscape HTTP Cookie File'];
  for (const [name, value] of Object.entries(cookies)) {
    lines.push([domain, 'TRUE', '/', 'TRUE', String(expiry), name, value].join('\t'));
  }
  const file = path.join(os.tmpdir(), `dn-cookies-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  return file;
}
