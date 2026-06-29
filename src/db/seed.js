// Optional demo/seed data. Enable by setting SEED_DEMO_DATA=true or run
// `npm run seed` manually. Safe to run repeatedly — it only seeds an empty DB.
import { config } from '../config.js';
import { getDb } from './index.js';
import { runMigrations } from './migrate.js';
import { Profiles, Accounts, Guilds, NotificationSettings } from '../store.js';
import { createLogger } from '../logger.js';

const log = createLogger('db:seed');

export function seedDemoData({ force = false } = {}) {
  getDb();
  runMigrations();

  const existing = Profiles.all();
  if (existing.length > 0 && !force) {
    log.info('Database already has profiles — skipping seed');
    return;
  }

  log.info('Seeding demo data');

  // A demo, unauthorized guild so the Servers page is not empty on first run.
  Guilds.upsertFromDiscord({
    guild_id: '000000000000000000',
    name: 'Demo Serwer (przykład)',
    icon_url: null,
    member_count: 1,
  });

  const lofi = Profiles.create({
    name: 'Lofi Girl',
    notes: 'Przykładowy profil demo — możesz go usunąć.',
  });
  Accounts.upsert(lofi.id, 'youtube', {
    identifier: 'UCSJ4gkVC6NrvII8umztf0Ow',
    input_url: 'https://www.youtube.com/@LofiGirl',
    display_name: 'Lofi Girl',
    avatar_url: null,
  });
  NotificationSettings.ensureForProfileGuild(lofi.id, '000000000000000000');

  const demo = Profiles.create({
    name: 'Demo Streamer',
    notes: 'Drugi przykładowy profil demo.',
  });
  Accounts.upsert(demo.id, 'twitch', {
    identifier: 'twitch',
    input_url: 'https://twitch.tv/twitch',
    display_name: 'Twitch',
    avatar_url: null,
  });
  NotificationSettings.ensureForProfileGuild(demo.id, '000000000000000000');

  log.info('Demo data seeded');
}

const isMain = process.argv[1] && process.argv[1].endsWith('seed.js');
if (isMain || config.env === 'seed') {
  seedDemoData({ force: process.argv.includes('--force') });
  process.exit(0);
}
