import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { acquireWorktreeLocks } from './worktree-locks.js';
import { WorktreeOwnership } from './worktree-ownership.js';
import { canonicalPath } from './worktree-path.js';

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

/** Manages worktrees without checking out or modifying the main worktree. */
export class GitWorktreeManager {
  private readonly repository: string;

  constructor(repository: string) {
    this.repository = realpathSync(repository);
  }

  private git(...args: string[]): string {
    return execFileSync('git', ['-C', this.repository, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], // [stdin, stdout, stderr]
    }).trim();
  }

  /** Hold all locks while using the worktree, including during agent execution. */
  async withWorktree<T>(
    request: WorktreeRequest,
    operation: (worktree: ManagedWorktree) => T | Promise<T>,
  ): Promise<T> {
    const release = this.lock(request);
    try {
      return await operation(this.ensureUnlocked(request));
    } finally {
      release();
    }
  }

  /** Ensure a worktree exists; use withWorktree for operations that use it. */
  ensure(request: WorktreeRequest): ManagedWorktree {
    const release = this.lock(request);
    try {
      return this.ensureUnlocked(request);
    } finally {
      release();
    }
  }

  private lock(request: WorktreeRequest): () => void {
    return acquireWorktreeLocks(
      this.git('rev-parse', '--absolute-git-dir'),
      request,
    );
  }

  private ensureUnlocked(request: WorktreeRequest): ManagedWorktree {
    this.validateRequest(request);
    const path = canonicalPath(request.path);
    const entries = this.listWorktrees();
    const main = entries[0];
    // Only the primary worktree on main is a valid base.
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
    const ownership = new WorktreeOwnership(
      this.git('rev-parse', '--absolute-git-dir'),
      request,
      path,
    );
    // The issue lock prevents concurrent claims for different branches.
    ownership.assertIssueAvailable();

    if (byPath || byBranch) {
      if (!byPath || byPath !== byBranch) {
        throw new Error('Worktree path or branch is already in use');
      }
      if (!existsSync(path)) {
        throw new Error('Configured worktree is missing');
      }
      ownership.assertMatches();
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
    ownership.reserve();
    const baseCommit = this.git('rev-parse', 'main^{commit}');
    this.git('worktree', 'add', '-b', request.branch, '--', path, baseCommit);
    return {
      ...request,
      path,
      reused: false,
    };
  }

  private validateRequest(request: WorktreeRequest): void {
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
    if (
      this.git('check-ref-format', '--branch', request.branch) !==
      request.branch
    ) {
      throw new Error('Branch must be an explicit branch name');
    }
  }

  private listWorktrees(): {
    path: string | undefined;
    branch: string | undefined;
  }[] {
    return this.git('worktree', 'list', '--porcelain', '-z')
      .split('\0\0')
      .filter(Boolean)
      .map((entry) => {
        const fields = entry.split('\0');
        return {
          path: fields.find((field) => field.startsWith('worktree '))?.slice(9),
          branch: fields.find((field) => field.startsWith('branch '))?.slice(7),
        };
      });
  }
}
