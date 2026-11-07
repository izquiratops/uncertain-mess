import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteRunRepository, prepareContext } from '../dist/index.js';

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
