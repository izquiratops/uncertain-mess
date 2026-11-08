import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateSqlite, SqliteRunRepository } from '../dist/index.js';

const fixtureMigrations = [
  {
    version: 1,
    up: (db) =>
      db.exec(
        'CREATE TABLE runs (id TEXT PRIMARY KEY, issue_id TEXT, version INTEGER, updated_at TEXT, state TEXT)',
      ),
  },
];

const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('fresh repository applies baseline and reopening preserves data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
  try {
    const path = join(dir, 'runs.sqlite');
    let repo = new SqliteRunRepository(path);
    repo.create('run', 'issue');
    repo.close();
    repo = new SqliteRunRepository(path);
    assert.equal(repo.load('run').issueId, 'issue');
    repo.close();
    const db = new DatabaseSync(path);
    assert.equal(version(db), 1);
    assert.deepEqual(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map((row) => row.name),
      ['artifacts', 'events', 'runs'],
    );
    db.close();
  } finally {
    rmSync(dir, {
      recursive: true,
      force: true,
    });
  }
});

test('applies only pending migrations and preserves existing data', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateSqlite(db, fixtureMigrations);
    db.prepare(
      "INSERT INTO runs VALUES ('run', 'issue', 0, 'now', '{}')",
    ).run();
    const migrations = [
      ...fixtureMigrations,
      {
        version: 2,
        up: (database) =>
          database.exec(
            "ALTER TABLE runs ADD COLUMN label TEXT NOT NULL DEFAULT 'default'",
          ),
      },
    ];
    migrateSqlite(db, migrations);
    migrateSqlite(db, migrations);
    assert.equal(version(db), 2);
    assert.equal(db.prepare('SELECT label FROM runs').get().label, 'default');
  } finally {
    db.close();
  }
});

test('failed migrations roll back schema, data and version', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateSqlite(db, fixtureMigrations);
    assert.throws(
      () =>
        migrateSqlite(db, [
          ...fixtureMigrations,
          {
            version: 2,
            up: (database) =>
              database.exec('CREATE TABLE temporary_data (id INTEGER)'),
          },
          {
            version: 3,
            up: () => {
              throw new Error('migration failed');
            },
          },
        ]),
      /migration failed/,
    );
    assert.equal(version(db), 1);
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name = 'temporary_data'")
        .get(),
      undefined,
    );
  } finally {
    db.close();
  }
});

test('rejects newer databases and invalid migration sequences', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA user_version = 2');
    assert.throws(
      () => migrateSqlite(db, fixtureMigrations),
      /newer than supported/,
    );
    assert.equal(version(db), 2);
    assert.throws(
      () =>
        migrateSqlite(db, [
          {
            version: 2,
            up: () => {},
          },
        ]),
      /consecutively numbered/,
    );
  } finally {
    db.close();
  }
});
