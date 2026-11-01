import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export interface WorktreeRequest {
  issueId: string;
  branch: string;
  path: string;
}

export interface ManagedWorktree {
  issueId: string;
  branch: string;
  path: string;
  reused: boolean;
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) {
    return realpathSync(absolute);
  }
  const parent = dirname(absolute);
  if (parent === absolute) {
    return absolute;
  }
  return join(canonicalPath(parent), basename(absolute));
}

/** Manages worktrees without checking out or modifying the main worktree. */
export class GitWorktreeManager {
  private readonly repository: string;

  constructor(repository: string) {
    this.repository = realpathSync(repository);
  }

  private git(...args: string[]): string {
    return execFileSync('git', ['-C', this.repository, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  /** The caller must serialize operations for the issue and worktree. */
  ensure(request: WorktreeRequest): ManagedWorktree {
    if (!request.issueId.trim()) {
      throw new Error('Issue ID is required');
    }
    if (
      !request.branch ||
      request.branch === 'main' ||
      request.branch === 'master'
    ) {
      throw new Error('A feature branch is required');
    }
    const validatedBranch = this.git(
      'check-ref-format',
      '--branch',
      request.branch,
    );
    if (validatedBranch !== request.branch) {
      throw new Error('Branch must be an explicit branch name');
    }
    const path = canonicalPath(request.path);
    const entries = this.git('worktree', 'list', '--porcelain', '-z')
      .split('\0\0')
      .filter(Boolean)
      .map((entry) => {
        const fields = entry.split('\0');
        return {
          path: fields.find((field) => field.startsWith('worktree '))?.slice(9),
          branch: fields.find((field) => field.startsWith('branch '))?.slice(7),
        };
      });
    const main = entries[0];
    // Require the supplied repository to be the primary worktree on main,
    // rather than a linked worktree or a primary checkout on another branch.
    if (
      !main?.path ||
      realpathSync(main.path) !== this.repository ||
      main.branch !== 'refs/heads/main'
    ) {
      throw new Error(
        'Repository must be the main worktree checked out on main',
      );
    }

    const byPath = entries.find((entry) => entry.path === path);
    const byBranch = entries.find(
      (entry) => entry.branch === `refs/heads/${request.branch}`,
    );
    // Record ownership before creating the worktree, so an interruption after
    // `git worktree add` cannot make another issue adopt it on recovery.
    const gitDir = this.git('rev-parse', '--absolute-git-dir');
    const ownershipDir = join(gitDir, 'issue-to-pr', 'worktrees');
    const key = createHash('sha256').update(request.branch).digest('hex');
    const ownershipFile = join(ownershipDir, `${key}.json`);
    const ownership = JSON.stringify({
      issueId: request.issueId,
      branch: request.branch,
      path,
    });

    if (byPath || byBranch) {
      if (!byPath || byPath !== byBranch) {
        throw new Error('Worktree path or branch is already in use');
      }
      if (!existsSync(path)) {
        throw new Error('Configured worktree is missing');
      }
      if (
        !existsSync(ownershipFile) ||
        readFileSync(ownershipFile, 'utf8') !== ownership
      ) {
        throw new Error(
          'Worktree ownership does not match the issue and configuration',
        );
      }
      return {
        ...request,
        path,
        reused: true,
      };
    }

    // Never attach an existing branch implicitly: it may belong to another issue.
    const branches = this.git(
      'for-each-ref',
      '--format=%(refname)',
      `refs/heads/${request.branch}`,
    ).split('\n');
    if (branches.includes(`refs/heads/${request.branch}`)) {
      throw new Error(
        'Feature branch already exists without the configured worktree',
      );
    }
    mkdirSync(ownershipDir, { recursive: true });
    try {
      writeFileSync(ownershipFile, ownership, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (readFileSync(ownershipFile, 'utf8') !== ownership) {
        throw new Error(
          'Worktree ownership does not match the issue and configuration',
          { cause: error },
        );
      }
    }
    const baseCommit = this.git('rev-parse', 'main^{commit}');
    this.git('worktree', 'add', '-b', request.branch, '--', path, baseCommit);

    return {
      ...request,
      path,
      reused: false,
    };
  }
}
