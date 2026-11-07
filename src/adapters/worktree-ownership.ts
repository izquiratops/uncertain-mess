import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { WorktreeRequest } from './git-worktree-manager.js';

const ownershipRecordSchema = z.object({
  issueId: z.string(),
  branch: z.string(),
  path: z.string(),
});

/** Persists reservations before worktree creation so interrupted attempts can resume. */
export class WorktreeOwnership {
  private readonly directory: string;
  private readonly file: string;
  private readonly key: string;
  private readonly contents: string;

  constructor(
    gitDir: string,
    private readonly request: WorktreeRequest,
    path: string,
  ) {
    this.directory = join(gitDir, 'issue-to-pr', 'worktrees');
    this.key = createHash('sha256').update(request.branch).digest('hex');
    this.file = join(this.directory, `${this.key}.json`);
    this.contents = JSON.stringify({
      issueId: request.issueId,
      branch: request.branch,
      path,
    });
  }

  assertIssueAvailable(): void {
    if (!existsSync(this.directory)) return;
    for (const file of readdirSync(this.directory)) {
      if (!file.endsWith('.json') || file === `${this.key}.json`) continue;
      let record: unknown;
      try {
        record = JSON.parse(readFileSync(join(this.directory, file), 'utf8'));
      } catch (error) {
        throw new Error('Invalid worktree ownership record', { cause: error });
      }
      const parsed = ownershipRecordSchema.safeParse(record);
      if (!parsed.success) throw new Error('Invalid worktree ownership record');
      if (parsed.data.issueId === this.request.issueId) {
        throw new Error('Issue already has a different worktree configuration');
      }
    }
  }

  assertMatches(): void {
    if (
      !existsSync(this.file) ||
      readFileSync(this.file, 'utf8') !== this.contents
    ) {
      throw new Error(
        'Worktree ownership does not match the issue and configuration',
      );
    }
  }

  reserve(): void {
    mkdirSync(this.directory, { recursive: true });
    try {
      writeFileSync(this.file, this.contents, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (readFileSync(this.file, 'utf8') !== this.contents) {
        throw new Error(
          'Worktree ownership does not match the issue and configuration',
          { cause: error },
        );
      }
    }
  }
}
