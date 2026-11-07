import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { WorktreeRequest } from './git-worktree-manager.js';
import { canonicalPath } from './worktree-path.js';

// Keep the connections alive for the entire duration of each operation.
const activeLocks = new Set<DatabaseSync[]>();

export function acquireWorktreeLocks(
  gitDir: string,
  request: WorktreeRequest,
): () => void {
  const lockDir = join(gitDir, 'issue-to-pr', 'locks');
  mkdirSync(lockDir, { recursive: true });
  const resources = [
    `issue:${request.issueId}`,
    `branch:${request.branch}`,
    `path:${canonicalPath(request.path)}`,
  ].sort();
  const databases: DatabaseSync[] = [];
  try {
    for (const resource of resources) {
      const key = createHash('sha256').update(resource).digest('hex');
      const db = new DatabaseSync(join(lockDir, `${key}.sqlite`));
      databases.push(db);
      db.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');
    }
  } catch (error) {
    for (const db of databases.reverse()) {
      db.close();
    }
    throw new Error('Unable to acquire worktree lock', { cause: error });
  }
  activeLocks.add(databases);
  return () => {
    activeLocks.delete(databases);
    for (const db of databases.reverse()) {
      db.close();
    }
  };
}
