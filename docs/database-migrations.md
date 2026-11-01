# SQLite database migrations

Migrations describe changes to the database schema (and, when necessary, its data) as a sequence of numbered steps. They run automatically when `SqliteRunRepository` opens a database; there is no separate migration command.

## How they work

The migration list and runner live in `src/adapters/sqlite-migrations.ts`. Migration 1 creates the `runs`, `events`, and `artifacts` tables. SQLite stores the last applied version in `PRAGMA user_version`; a new database starts at version 0.

On opening a repository, the runner:

1. Checks that the migration list is numbered consecutively from 1.
2. Starts a `BEGIN IMMEDIATE` transaction, acquiring a write reservation before reading the version.
3. Reads `user_version` and rejects a database newer than the application's migration list.
4. Runs each pending migration in order and updates `user_version` after each step.
5. Commits all pending migrations together. If any step fails, it rolls back the entire transaction, including the version changes, and opening the repository fails.

Reopening an up-to-date database does not rerun migrations. Multiple processes opening the same database serialize their migration attempts through SQLite's write lock; the repository configures a five-second busy timeout.

## Adding a migration

Append a new entry to `runRepositoryMigrations` with the next consecutive version. For example, after migration 1, add an index for looking up runs by issue:

```ts
{
  version: 2,
  up: (db) => db.exec(`
    CREATE INDEX runs_issue_id_idx ON runs(issue_id);
  `),
},
```

Add this entry **after** migration 1 inside the array. A new database will apply versions 1 and 2; an existing version-1 database will apply only version 2. Both end at version 2. If index creation fails, neither the index nor the version update is committed.

## Guidelines

- Treat shipped migrations as immutable. Append a new migration rather than changing an existing one: databases that already applied it will not run it again.
- Migration functions run synchronously inside the runner's transaction. Do not start or commit a separate transaction inside them.
- Consider existing data when changing tables. Some SQLite changes require creating a replacement table and copying data. Repository queries such as `INSERT INTO runs VALUES (...)` may also need updating when columns change.
- Changes to serialized workflow states or events may need data transformations as well as schema changes, because those JSON values are validated when read.
- Test both fresh creation and upgrades with representative existing data, including failure and rollback cases. See `test/sqlite-migrations.test.js`.
- Back up persistent databases before deploying migrations. The runner supports forward migrations only; it does not provide an automatic downgrade or backup mechanism.

This baseline assumes databases are created using the migration runner. An unversioned database with pre-existing tables is not automatically adopted as version 1.
