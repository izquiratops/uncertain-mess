import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRunRepository, prepareContext } from '../../dist/index.js';

const simpleIssue = {
  id: 'A-1',
  title: 'Title',
  description: 'Description',
  acceptanceCriteria: [],
  references: [
    {
      url: 'https://example.com/optional',
      required: false,
    },
  ],
};

describe('prepareContext', () => {
  test('persists failure and retries atomically; reuses successful snapshot', async () => {
    const repository = new SqliteRunRepository(':memory:');
    try {
      repository.create('run', 'A-1');
      let calls = 0;
      const issue = {
        id: 'A-1',
        title: 'Title',
        description: 'Description',
        acceptanceCriteria: [],
        references: [
          {
            url: 'https://example.com/design',
            required: true,
          },
        ],
      };
      const provider = {
        getIssue: async () => {
          calls++;
          return issue;
        },
      };
      await prepareContext(repository, provider, [], 'run');
      assert.equal(repository.load('run').state.status, 'needs_attention');
      assert.deepEqual(
        repository.events('run').map((item) => item.event.type),
        ['context_collection_started', 'attention_required'],
      );
      const source = {
        supports: () => true,
        resolve: async (ref) => ({
          url: ref.url,
          content: 'Design',
        }),
      };
      const snapshot = await prepareContext(
        repository,
        provider,
        [source],
        'run',
        { retry: true },
      );
      assert.equal(snapshot.resolutions[0].content, 'Design');
      assert.equal(repository.load('run').state.status, 'planning');
      assert.deepEqual(
        repository.artifacts('run').map((item) => item.version),
        [1, 2],
      );
      assert.deepEqual(
        await prepareContext(repository, provider, [], 'run'),
        snapshot,
      );
      assert.equal(calls, 2);
    } finally {
      repository.close();
    }
  });

  test('resumes after an interrupted attempt and persists optional failures', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'context-resume-'));
    const path = join(directory, 'runs.sqlite');
    let repository = new SqliteRunRepository(path);
    try {
      repository.create('run', 'A-1');
      repository.append('run', 0, { type: 'context_collection_started' });
      repository.close();
      repository = new SqliteRunRepository(path);

      const snapshot = await prepareContext(
        repository,
        { getIssue: async () => simpleIssue },
        [],
        'run',
      );
      assert.equal(snapshot.resolutions[0].status, 'unavailable');
      assert.equal(repository.load('run').state.status, 'planning');
      assert.deepEqual(
        repository.events('run').map(({ event }) => event.type),
        [
          'context_collection_started',
          'context_collection_started',
          'context_ready',
        ],
      );
      assert.deepEqual(
        JSON.parse(repository.artifacts('run')[0].content),
        snapshot,
      );
    } finally {
      repository.close();
      rmSync(directory, {
        recursive: true,
        force: true,
      });
    }
  });

  test('source selection failures are recorded per reference', async () => {
    for (const required of [false, true]) {
      const repository = new SqliteRunRepository(':memory:');
      try {
        repository.create('run', 'A-1');
        const issue = {
          ...simpleIssue,
          references: [
            {
              ...simpleIssue.references[0],
              required,
            },
          ],
        };
        const snapshot = await prepareContext(
          repository,
          { getIssue: async () => issue },
          [
            {
              supports: () => {
                throw new Error('private provider error');
              },
              resolve: async () => {
                throw new Error('unexpected');
              },
            },
          ],
          'run',
        );
        assert.equal(snapshot.resolutions[0].status, 'unavailable');
        assert.equal(
          repository.load('run').state.status,
          required ? 'needs_attention' : 'planning',
        );
        const artifacts = repository.artifacts('run');
        assert.deepEqual(JSON.parse(artifacts[0].content), snapshot);
        assert.ok(
          !JSON.stringify(artifacts).includes('private provider error'),
        );
      } finally {
        repository.close();
      }
    }
  });

  test('concurrent attempts cannot overwrite the winning snapshot', async () => {
    const repository = new SqliteRunRepository(':memory:');
    try {
      repository.create('run', 'A-1');
      let release;
      const waiting = new Promise((resolve) => {
        release = resolve;
      });
      let started;
      const startedPromise = new Promise((resolve) => {
        started = resolve;
      });
      const slow = prepareContext(
        repository,
        {
          getIssue: async () => {
            started();
            await waiting;
            return {
              ...simpleIssue,
              title: 'Stale',
            };
          },
        },
        [],
        'run',
      );
      await startedPromise;
      const winner = await prepareContext(
        repository,
        {
          getIssue: async () => simpleIssue,
        },
        [],
        'run',
      );
      release();
      await assert.rejects(slow, /version conflict/);
      assert.deepEqual(
        await prepareContext(
          repository,
          {
            getIssue: async () => {
              throw new Error('unexpected');
            },
          },
          [],
          'run',
        ),
        winner,
      );
      assert.equal(repository.artifacts('run').length, 1);
      assert.equal(
        repository
          .events('run')
          .filter(({ event }) => event.type === 'context_ready').length,
        1,
      );
    } finally {
      repository.close();
    }
  });
});
