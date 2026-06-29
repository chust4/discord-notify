import { config } from './config.js';
import { initLogging, logger } from './logger.js';
import { runMigrations } from './db/migrate.js';
import { getDb, closeDb } from './db/index.js';
import { startWeb } from './web/server.js';
import { startBot } from './bot/client.js';
import { startPoller, stopPoller } from './poller.js';
import { seedDemoData } from './db/seed.js';
import { applyConfigOverrides } from './runtimeSettings.js';
import { Events, Seen, TempNotifications } from './store.js';

async function main() {
  initLogging();
  logger.info('==============================================');
  logger.info(`${config.appName} v${config.version} starting`);
  logger.info('==============================================', {
    port: config.port,
    dataDir: config.dataDir,
    pollIntervalSeconds: config.pollIntervalSeconds,
    debug: config.debug,
  });

  // 1. Database + migrations.
  getDb();
  runMigrations();

  // Load API-key / tunable overrides saved from the panel onto the live config.
  applyConfigOverrides();

  // Optional demo data (only seeds an empty database).
  if (config.seedDemo) {
    try {
      seedDemoData();
    } catch (err) {
      logger.warn('Demo seed failed', { err: err.message });
    }
  }

  // 2. Periodic history retention cleanup (keeps events/seen tidy).
  scheduleRetention();

  // 3. Web panel (always on, even without a Discord token).
  const server = await startWeb();

  // 4. Discord bot (optional — degrades gracefully without a token).
  await startBot();

  // 5. Background poller.
  startPoller();

  logger.info('Startup complete — panel ready', {
    url: `http://localhost:${config.port}`,
  });

  setupShutdown(server);
}

function scheduleRetention() {
  const days = config.logRetentionDays;
  const run = () => {
    try {
      const events = Events.purgeOlderThan(days);
      const seen = Seen.purgeOlderThan(90); // keep dedupe ledger longer
      const temp = TempNotifications.purgeOlderThan(30); // already-deleted rows age out
      if (events || seen || temp) {
        logger.info('Retention cleanup', { eventsPurged: events, seenPurged: seen, tempPurged: temp });
      }
    } catch (err) {
      logger.warn('Retention cleanup failed', { err: err.message });
    }
  };
  run();
  setInterval(run, 12 * 60 * 60 * 1000).unref();
}

function setupShutdown(server) {
  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    logger.info('Shutting down', { signal });
    stopPoller();
    server?.close();
    closeDb();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { err: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });
}

main().catch((err) => {
  logger.error('Fatal startup error', { err: err.message, stack: err.stack });
  process.exit(1);
});
