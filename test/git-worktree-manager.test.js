import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
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

describe('GitWorktreeManager', () => {
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

  test('does not let another issue adopt a worktree after restart', (t) => {
    const { root, repo } = fixture(t);
    const request = {
      issueId: 'ABC-1',
      branch: 'issue/ABC-1',
      path: join(root, 'worktree'),
    };
    new GitWorktreeManager(repo).ensure(request);
    assert.throws(
      () =>
        new GitWorktreeManager(repo).ensure({
          ...request,
          issueId: 'ABC-2',
        }),
      /ownership does not match/,
    );
    assert.equal(new GitWorktreeManager(repo).ensure(request).reused, true);
  });

  test('refuses a second configuration for the same issue after restart', (t) => {
    const { root, repo } = fixture(t);
    const request = {
      issueId: 'ABC-1',
      branch: 'issue/ABC-1',
      path: join(root, 'worktree'),
    };
    new GitWorktreeManager(repo).ensure(request);
    assert.throws(
      () =>
        new GitWorktreeManager(repo).ensure({
          ...request,
          branch: 'issue/alternative',
          path: join(root, 'alternative'),
        }),
      /Issue already has a different worktree configuration/,
    );
    assert.equal(new GitWorktreeManager(repo).ensure(request).reused, true);
  });

  test('rejects invalid ownership records', (t) => {
    const { root, repo } = fixture(t);
    const directory = join(repo, '.git', 'issue-to-pr', 'worktrees');
    mkdirSync(directory, { recursive: true });
    const record = join(directory, 'invalid.json');
    const manager = new GitWorktreeManager(repo);
    const request = {
      issueId: 'ABC-1',
      branch: 'issue/ABC-1',
      path: join(root, 'worktree'),
    };
    for (const content of ['{', 'null', '{"issueId":"ABC-2","branch":42}']) {
      writeFileSync(record, content);
      assert.throws(
        () => manager.ensure(request),
        /Invalid worktree ownership record/,
      );
    }
  });

  test('refuses to adopt an externally created worktree', (t) => {
    const { root, repo, git } = fixture(t);
    const path = join(root, 'worktree');
    git('worktree', 'add', '-b', 'issue/ABC-1', path);
    assert.throws(
      () =>
        new GitWorktreeManager(repo).ensure({
          issueId: 'ABC-1',
          branch: 'issue/ABC-1',
          path,
        }),
      /ownership does not match/,
    );
  });

  test('locks issue, branch and path for the whole operation and releases on failure', async (t) => {
    const { root, repo } = fixture(t);
    const manager = new GitWorktreeManager(repo);
    const request = {
      issueId: 'ABC-1',
      branch: 'issue/ABC-1',
      path: join(root, 'worktree'),
    };
    await assert.rejects(
      manager.withWorktree(request, async () => {
        for (const other of [
          request,
          {
            ...request,
            branch: 'other',
            path: join(root, 'other'),
          },
          {
            ...request,
            issueId: 'ABC-2',
            path: join(root, 'other'),
          },
          {
            ...request,
            issueId: 'ABC-2',
            branch: 'other',
          },
        ]) {
          assert.throws(
            () => new GitWorktreeManager(repo).ensure(other),
            /acquire worktree lock/,
          );
        }
        throw new Error('operation failed');
      }),
      /operation failed/,
    );
    assert.equal(manager.ensure(request).reused, true);
  });

  test('releases locks after a process is killed', async (t) => {
    const { root, repo } = fixture(t);
    const request = {
      issueId: 'ABC-1',
      branch: 'issue/ABC-1',
      path: join(root, 'worktree'),
    };
    const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
    const script = `
    import { GitWorktreeManager } from ${JSON.stringify(moduleUrl)};
    const manager = new GitWorktreeManager(${JSON.stringify(repo)});
    await manager.withWorktree(${JSON.stringify(request)}, async () => {
      console.log('locked');
      await new Promise(() => setInterval(() => {}, 1000));
    });
  `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    t.after(() => child.kill('SIGKILL'));
    await once(child.stdout, 'data');
    assert.throws(
      () => new GitWorktreeManager(repo).ensure(request),
      /acquire worktree lock/,
    );
    child.kill('SIGKILL');
    await once(child, 'exit');
    assert.equal(new GitWorktreeManager(repo).ensure(request).reused, true);
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
        () =>
          manager.ensure({
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
          issueId: 'ABC-2',
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
          issueId: 'ABC-2',
          branch: 'orphan-feature',
          path: join(root, 'other'),
        }),
      /already exists/,
    );
    git('checkout', '-b', 'other');
    assert.throws(() => manager.ensure(request), /checked out on main/);
  });
});
