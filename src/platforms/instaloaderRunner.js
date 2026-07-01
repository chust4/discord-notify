import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('instaloader');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, 'instaloader_fetch.py');

let availability = null; // null = unknown, true/false once probed

function run(args, { timeoutMs = config.instagram.timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      // The session cookie travels via env var rather than a CLI arg, since
      // process argv (unlike env) is visible to any `ps aux` inside the
      // container.
      const env = { ...process.env };
      if (config.instagram.sessionId) env.INSTALOADER_SESSION_ID = config.instagram.sessionId;
      child = spawn(config.instagram.pythonPath, [SCRIPT_PATH, ...args], { windowsHide: true, env });
    } catch (err) {
      return reject(err);
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`instaloader timeout po ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const lastLine = stdout.trim().split('\n').pop() || '';
      let data;
      try {
        data = JSON.parse(lastLine);
      } catch {
        return reject(
          new Error(stderr.trim().split('\n').pop() || 'nie udało się odczytać odpowiedzi instaloader')
        );
      }
      if (!data.ok) return reject(new Error(data.error || 'nieznany błąd instaloader'));
      resolve(data.items || []);
    });
  });
}

/** Probe once whether python3 + the instaloader package are usable. */
export async function isAvailable() {
  if (!config.instagram.enabled) return false;
  if (availability !== null) return availability;
  try {
    // A cheap import-only check via -c avoids spawning our own script args
    // parser just to prove the interpreter/module are present.
    await new Promise((resolve, reject) => {
      const child = spawn(config.instagram.pythonPath, ['-c', 'import instaloader'], { windowsHide: true });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('timeout'));
      }, 10000);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`exit ${code}`));
      });
    });
    availability = true;
    log.info('instaloader available');
  } catch (err) {
    availability = false;
    log.warn('instaloader not available — Instagram posts/reels/stories detection disabled', {
      err: err.message,
    });
  }
  return availability;
}

/** Recent posts/Reels for a profile, newest-first. */
export function fetchPosts(username, { limit = 12 } = {}) {
  return run(['--mode', 'posts', '--username', username, '--limit', String(limit)]);
}

/** Currently-active story items for a profile. */
export function fetchStories(username) {
  return run(['--mode', 'stories', '--username', username]);
}
