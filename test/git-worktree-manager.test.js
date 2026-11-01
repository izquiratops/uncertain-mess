import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitWorktreeManager } from '../dist/index.js';

// Create an isolated repository and remove it after the test.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'worktree-test-'));
  t.after(() =>
    rmSync(root, {
      recursive: true,
      force: true,
    }),
  );
  const repo = join(root, 'repo');
  mkdirSync(repo);
  // Run Git commands in the fixture repository and return trimmed output.
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  // Seed main with a commit so tests can create worktrees and branches.
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(repo, 'file'), 'initial');
  git('add', 'file');
  git('commit', '-m', 'initial');
  return {
    root,
    repo,
    git,
  };
}

test('creates and recovers a configured worktree without changing main', (t) => {
  const { root, repo, git } = fixture(t);
  const request = {
    issueId: 'ABC-1',
    branch: 'issue/ABC-1',
    path: join(root, 'worktree'),
  };
  const before = git('rev-parse', 'HEAD');
  assert.equal(new GitWorktreeManager(repo).ensure(request).reused, false);
  writeFileSync(join(request.path, 'file'), 'uncommitted work');
  assert.equal(new GitWorktreeManager(repo).ensure(request).reused, true);
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(git('rev-parse', 'HEAD'), before);
  assert.equal(git('status', '--porcelain'), '');
  assert.match(
    execFileSync('git', ['-C', request.path, 'status', '--porcelain'], {
      encoding: 'utf8',
    }),
    /file/,
  );
});

test('resolves symlinked paths and refuses missing worktrees', (t) => {
  const { root, repo } = fixture(t);
  const alias = join(root, 'alias');
  symlinkSync(root, alias);
  const manager = new GitWorktreeManager(repo);
  const request = {
    issueId: 'ABC-1',
    branch: 'issue/ABC-1',
    path: join(alias, 'worktree'),
  };
  assert.equal(manager.ensure(request).path, join(root, 'worktree'));
  assert.equal(manager.ensure(request).reused, true);
  rmSync(request.path, { recursive: true });
  assert.throws(() => manager.ensure(request), /worktree is missing/);
});

test('rejects main and master as feature branches', (t) => {
  const { root, repo } = fixture(t);
  const manager = new GitWorktreeManager(repo);
  for (const branch of ['main', 'master']) {
    assert.throws(
      () => manager.ensure({
        issueId: 'ABC-1',
        branch,
        path: join(root, 'worktree'),
      }),
      /A feature branch is required/,
    );
  }
});

test('rejects branch names that git expands', (t) => {
  const { root, repo, git } = fixture(t);
  git('checkout', '-b', 'other');
  git('checkout', 'main');
  assert.throws(
    () =>
      new GitWorktreeManager(repo).ensure({
        issueId: 'ABC-1',
        branch: '@{-1}',
        path: join(root, 'worktree'),
      }),
    /explicit branch name/,
  );
});

test('refuses conflicting paths, branches and non-main primary checkout', (t) => {
  const { root, repo, git } = fixture(t);
  const manager = new GitWorktreeManager(repo);
  const request = {
    issueId: 'ABC-1',
    branch: 'issue/ABC-1',
    path: join(root, 'worktree'),
  };
  manager.ensure(request);
  assert.throws(
    () =>
      manager.ensure({
        ...request,
        branch: 'issue/other',
      }),
    /already in use/,
  );
  assert.throws(
    () =>
      manager.ensure({
        ...request,
        path: join(root, 'other'),
      }),
    /already in use/,
  );
  git('branch', 'orphan-feature');
  assert.throws(
    () =>
      manager.ensure({
        ...request,
        branch: 'orphan-feature',
        path: join(root, 'other'),
      }),
    /already exists/,
  );
  git('checkout', '-b', 'other');
  assert.throws(() => manager.ensure(request), /checked out on main/);
});
