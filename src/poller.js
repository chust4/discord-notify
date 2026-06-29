import { config } from './config.js';
import { createLogger } from './logger.js';
import { getPlatform } from './platforms/index.js';
import { Accounts, Profiles, Seen, Events, Settings } from './store.js';
import { dispatchEvent } from './notifications/dispatcher.js';
import { EVENT_STATUS } from './constants.js';

const log = createLogger('poller');

let running = false;
let timer = null;

/**
 * Check a single account and dispatch any newly-detected events.
 */
async function checkAccount(account) {
  const profile = Profiles.byId(account.profile_id);
  if (!profile || !profile.enabled) return;

  const platform = getPlatform(account.platform);
  let result;
  try {
    result = await platform.check(account);
  } catch (err) {
    Accounts.setError(account.id, err.message);
    Profiles.setLastError(profile.id, `${account.platform}: ${err.message}`);
    Events.log({
      profile_id: profile.id,
      account_id: account.id,
      platform: account.platform,
      status: EVENT_STATUS.API_ERROR,
      detail: err.message,
    });
    log.error('Account check threw', { account: account.identifier, err: err.message });
    return;
  }

  if (result.error) {
    Accounts.setError(account.id, result.error);
    Profiles.setLastError(profile.id, `${account.platform}: ${result.error}`);
    Events.log({
      profile_id: profile.id,
      account_id: account.id,
      platform: account.platform,
      status: EVENT_STATUS.API_ERROR,
      detail: result.error,
    });
    log.warn('Account check error', { account: account.identifier, error: result.error });
  } else {
    Accounts.setError(account.id, null);
  }

  // Persist new state first so a crash mid-dispatch doesn't replay everything.
  if (result.state) Accounts.updateState(account.id, result.state);

  for (const event of result.events || []) {
    event.platform = account.platform;
    // Anti-duplicate: mark() returns false if we've already handled this item.
    const isNew = Seen.mark(account.id, event.event_type, event.external_id);
    if (!isNew) {
      Events.log({
        profile_id: profile.id,
        account_id: account.id,
        platform: account.platform,
        event_type: event.event_type,
        external_id: event.external_id,
        title: event.title,
        url: event.url,
        status: EVENT_STATUS.SKIPPED_DUPLICATE,
        detail: 'Już wcześniej obsłużone',
      });
      log.debug('Skipped duplicate', { account: account.identifier, id: event.external_id });
      continue;
    }
    log.info('Detected event', {
      profile: profile.name,
      platform: account.platform,
      event: event.event_type,
      title: event.title,
    });
    try {
      await dispatchEvent({ event, profile, account });
    } catch (err) {
      log.error('Dispatch failed', { err: err.message });
      Events.log({
        profile_id: profile.id,
        account_id: account.id,
        platform: account.platform,
        event_type: event.event_type,
        status: EVENT_STATUS.SEND_FAILED,
        detail: err.message,
      });
    }
  }
}

export async function runOnce() {
  if (running) {
    log.debug('Poll already running, skipping tick');
    return;
  }
  running = true;
  const start = Date.now();
  try {
    const accounts = Accounts.all();
    log.info('Poll cycle start', { accounts: accounts.length });
    for (const account of accounts) {
      await checkAccount(account);
    }
    Settings.set('last_check_at', new Date().toISOString());
    Settings.set('last_check_duration_ms', String(Date.now() - start));
    log.info('Poll cycle done', { ms: Date.now() - start });
  } finally {
    running = false;
  }
}

export function startPoller() {
  const intervalMs = Math.max(60, config.pollIntervalSeconds) * 1000;
  log.info('Starting poller', { intervalSeconds: intervalMs / 1000 });
  // First run shortly after boot, then on the configured interval.
  setTimeout(() => runOnce().catch((e) => log.error('runOnce error', { err: e.message })), 8000);
  timer = setInterval(
    () => runOnce().catch((e) => log.error('runOnce error', { err: e.message })),
    intervalMs
  );
  timer.unref?.();
}

export function stopPoller() {
  if (timer) clearInterval(timer);
}
