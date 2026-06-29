import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function activeLevel() {
  if (config.debug) return LEVELS.debug;
  return LEVELS[config.logLevel] ?? LEVELS.info;
}

let stream = null;
let currentDay = null;

function ensureLogDir() {
  if (!config.logToFile) return;
  try {
    fs.mkdirSync(config.logDir, { recursive: true });
  } catch (err) {
    // Fall back to stdout-only logging if the directory is not writable.
    config.logToFile = false;
    process.stderr.write(`[logger] cannot create log dir: ${err.message}\n`);
  }
}

function dayStamp(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function fileForToday() {
  return path.join(config.logDir, `app-${dayStamp()}.log`);
}

function rotateStreamIfNeeded() {
  if (!config.logToFile) return;
  const today = dayStamp();
  if (today === currentDay && stream) return;
  if (stream) {
    stream.end();
    stream = null;
  }
  currentDay = today;
  stream = fs.createWriteStream(fileForToday(), { flags: 'a' });
}

/**
 * Delete log files older than the configured retention window so the NAS disk
 * does not fill up over time. Runs at startup and then on a daily timer.
 */
export function cleanupOldLogs() {
  if (!config.logToFile) return;
  try {
    const cutoff = Date.now() - config.logRetentionDays * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(config.logDir);
    for (const file of files) {
      if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(file)) continue;
      const full = path.join(config.logDir, file);
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        process.stdout.write(`[logger] removed old log file ${file}\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`[logger] log cleanup failed: ${err.message}\n`);
  }
}

function write(level, scope, message, meta) {
  if (LEVELS[level] < activeLevel()) return;

  const time = new Date().toISOString();
  const metaStr =
    meta && Object.keys(meta).length ? ' ' + safeJson(meta) : '';
  const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${metaStr}`;

  // stdout for info/debug, stderr for warn/error -> clear separation in Portainer.
  if (LEVELS[level] >= LEVELS.warn) {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }

  if (config.logToFile) {
    try {
      rotateStreamIfNeeded();
      stream?.write(line + '\n');
    } catch {
      /* best effort */
    }
  }
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj, (_k, v) =>
      v instanceof Error ? { message: v.message, stack: v.stack } : v
    );
  } catch {
    return String(obj);
  }
}

export function createLogger(scope = 'app') {
  return {
    debug: (msg, meta) => write('debug', scope, msg, meta),
    info: (msg, meta) => write('info', scope, msg, meta),
    warn: (msg, meta) => write('warn', scope, msg, meta),
    error: (msg, meta) => write('error', scope, msg, meta),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

export function initLogging() {
  ensureLogDir();
  rotateStreamIfNeeded();
  cleanupOldLogs();
  // Re-run cleanup + rotation once a day.
  setInterval(() => {
    rotateStreamIfNeeded();
    cleanupOldLogs();
  }, 6 * 60 * 60 * 1000).unref();
}

export const logger = createLogger('app');
