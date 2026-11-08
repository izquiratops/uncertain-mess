import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRunRepository } from '../../dist/index.js';

const context = {
  issueId: 'A-1',
  title: 'Issue',
  description: 'Description',
  acceptanceCriteria: [],
  references: [],
};

describe('SqliteRunRepository', () => {
  test('recovers state, events and artifacts after restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runs-'));
    try {
      const path = join(dir, 'runs.sqlite');
      let repo = new SqliteRunRepository(path);
      repo.create('run-1', 'A-1');
      repo.append(
        'run-1',
        0,
        {
          type: 'context_ready',
          context,
        },
        [
          {
            name: 'context',
            version: 1,
            content: JSON.stringify(context),
          },
        ],
      );
      repo.close();
      repo = new SqliteRunRepository(path);
      assert.equal(repo.load('run-1').state.status, 'planning');
      assert.equal(repo.load('run-1').version, 1);
      assert.deepEqual(repo.events('run-1')[0].event, {
        type: 'context_ready',
        context,
      });
      assert.equal(repo.artifacts('run-1')[0].content, JSON.stringify(context));
      repo.close();
    } finally {
      rmSync(dir, {
        recursive: true,
        force: true,
      });
    }
  });

  test('conflicts and errors roll back event, state and artifacts', () => {
    const repo = new SqliteRunRepository(':memory:');
    try {
      repo.create('run', 'A-1');
      repo.append(
        'run',
        0,
        {
          type: 'context_ready',
          context,
        },
        [
          {
            name: 'context',
            version: 1,
            content: 'original',
          },
        ],
      );
      const event = {
        type: 'plan_proposed',
        plan: {
          version: 1,
          summary: 'Plan',
          steps: ['Step'],
        },
      };
      assert.throws(() => repo.append('run', 0, event));
      assert.throws(() =>
        repo.append('run', 1, event, [
          {
            name: 'new',
            version: 1,
            content: 'x',
          },
          {
            name: 'context',
            version: 1,
            content: 'duplicate',
          },
        ]),
      );
      assert.equal(repo.load('run').version, 1);
      assert.equal(repo.events('run').length, 1);
      assert.deepEqual(
        repo.artifacts('run').map((a) => a.name),
        ['context'],
      );
      assert.equal(
        repo.append('run', 1, event).state.status,
        'awaiting_approval',
      );
    } finally {
      repo.close();
    }
  });
});
