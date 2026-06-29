import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './index.js';
import { createLogger } from '../logger.js';

const log = createLogger('db:migrate');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

/**
 * Simple, dependency-free migration runner. It applies every *.sql file in the
 * migrations directory in lexicographic order exactly once, recording applied
 * files in the schema_migrations table. Safe to run on every container start.
 */
export function runMigrations() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name)
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const insert = db.prepare(
    'INSERT INTO schema_migrations (name) VALUES (?)'
  );

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      insert.run(file);
    });
    tx();
    count += 1;
    log.info('Applied migration', { file });
  }

  if (count === 0) {
    log.info('Database schema up to date', { total: files.length });
  } else {
    log.info('Migrations complete', { applied: count });
  }
  return count;
}

// Allow `npm run migrate` to run this standalone.
if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  runMigrations();
  process.exit(0);
}
