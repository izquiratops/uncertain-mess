import { DatabaseSync } from 'node:sqlite';
import {
  WorkflowEventSchema,
  WorkflowStateSchema,
  type WorkflowState,
  type WorkflowEvent,
} from '../domain/contracts.js';
import { initialState, transition } from '../domain/workflow.js';

export interface Run {
  id: string;
  issueId: string;
  version: number;
  updatedAt: string;
  state: WorkflowState;
}

export interface Artifact {
  name: string;
  version: number;
  content: string;
}

export class SqliteRunRepository {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, version INTEGER NOT NULL,
        updated_at TEXT NOT NULL, state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        run_id TEXT NOT NULL REFERENCES runs(id), version INTEGER NOT NULL,
        event TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (run_id, version)
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL,
        version INTEGER NOT NULL, content TEXT NOT NULL,
        PRIMARY KEY (run_id, name, version)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  create(id: string, issueId: string): Run {
    if (!id.trim() || !issueId.trim())
      throw new Error('Run and issue IDs are required');
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT INTO runs VALUES (?, ?, 0, ?, ?)')
      .run(id, issueId, now, JSON.stringify(initialState()));
    return this.load(id)!;
  }

  load(id: string): Run | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    if (!row) return undefined;
    return {
      id: String(row.id),
      issueId: String(row.issue_id),
      version: Number(row.version),
      updatedAt: String(row.updated_at),
      state: WorkflowStateSchema.parse(JSON.parse(String(row.state))),
    };
  }

  append(
    id: string,
    expectedVersion: number,
    rawEvent: WorkflowEvent,
    artifacts: Artifact[] = [],
  ): Run {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const run = this.load(id);
      if (!run) throw new Error(`Run not found: ${id}`);
      if (run.version !== expectedVersion)
        throw new Error('Run version conflict');
      const event = WorkflowEventSchema.parse(rawEvent);
      const state = transition(run.state, event);
      const version = run.version + 1;
      const now = new Date().toISOString();
      for (const artifact of artifacts) {
        if (
          !artifact.name.trim() ||
          !Number.isSafeInteger(artifact.version) ||
          artifact.version < 1 ||
          typeof artifact.content !== 'string'
        ) {
          throw new Error('Invalid artifact');
        }
        this.db
          .prepare('INSERT INTO artifacts VALUES (?, ?, ?, ?)')
          .run(id, artifact.name, artifact.version, artifact.content);
      }
      this.db
        .prepare('INSERT INTO events VALUES (?, ?, ?, ?)')
        .run(id, version, JSON.stringify(event), now);
      this.db
        .prepare(
          'UPDATE runs SET version = ?, updated_at = ?, state = ? WHERE id = ?',
        )
        .run(version, now, JSON.stringify(state), id);
      this.db.exec('COMMIT');
      return {
        ...run,
        version,
        updatedAt: now,
        state,
      };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  events(
    id: string,
  ): { version: number; event: WorkflowEvent; createdAt: string }[] {
    return this.db
      .prepare(
        'SELECT version, event, created_at FROM events WHERE run_id = ? ORDER BY version',
      )
      .all(id)
      .map((row) => ({
        version: Number(row.version),
        event: WorkflowEventSchema.parse(JSON.parse(String(row.event))),
        createdAt: String(row.created_at),
      }));
  }

  artifacts(id: string): Artifact[] {
    return this.db
      .prepare(
        'SELECT name, version, content FROM artifacts WHERE run_id = ? ORDER BY name, version',
      )
      .all(id)
      .map((row) => ({
        name: String(row.name),
        version: Number(row.version),
        content: String(row.content),
      }));
  }
}
