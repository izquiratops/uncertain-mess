import { DatabaseSync } from 'node:sqlite';

export interface SqliteMigration {
  version: number;
  up: (db: DatabaseSync) => void;
}

const _migrations: readonly SqliteMigration[] = [
  {
    version: 1,
    up: (db) =>
      db.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, version INTEGER NOT NULL,
        updated_at TEXT NOT NULL, state TEXT NOT NULL
      );
      CREATE TABLE events (
        run_id TEXT NOT NULL REFERENCES runs(id), version INTEGER NOT NULL,
        event TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (run_id, version)
      );
      CREATE TABLE artifacts (
        run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL,
        version INTEGER NOT NULL, content TEXT NOT NULL,
        PRIMARY KEY (run_id, name, version)
      );
    `),
  },
];

export function migrateSqlite(
  db: DatabaseSync,
  migrations: readonly SqliteMigration[] = _migrations,
): void {
  for (const [index, migration] of migrations.entries()) {
    if (migration.version !== index + 1) {
      throw new Error(
        'SQLite migrations must be consecutively numbered from 1',
      );
    }
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('PRAGMA user_version').get();
    const currentVersion = Number(row?.user_version);
    if (currentVersion > migrations.length) {
      throw new Error(
        `Database schema version ${currentVersion} is newer than supported version ${migrations.length}`,
      );
    }
    for (const migration of migrations.slice(currentVersion)) {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
