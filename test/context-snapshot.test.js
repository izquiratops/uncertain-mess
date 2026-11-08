import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectContextSnapshot,
  ContextSnapshotSchema,
} from '../dist/index.js';

describe('collectContextSnapshot', () => {
  test('snapshot retains resolved and unavailable references without provider errors', async () => {
    const references = [
      {
        url: 'https://example.com/one',
        required: true,
      },
      {
        url: 'https://example.com/two',
        required: false,
      },
      {
        url: 'https://example.org/three',
        required: true,
      },
    ];
    const issue = {
      id: 'A-1',
      title: 'Title',
      description: 'Description',
      acceptanceCriteria: [],
      references,
    };
    const source = {
      supports: (ref) => ref.url.includes('example.com'),
      resolve: async (ref) => {
        if (ref.url.endsWith('/two')) {
          throw new Error('secret credential');
        }
        return {
          url: ref.url,
          content: 'Design',
        };
      },
    };
    const snapshot = await collectContextSnapshot(
      { getIssue: async () => issue },
      [source],
      'A-1',
    );
    assert.deepEqual(
      snapshot.resolutions.map((result) => result.status),
      ['resolved', 'unavailable', 'unavailable'],
    );
    assert.equal(snapshot.resolutions[0].content, 'Design');
    assert.equal(snapshot.resolutions[2].reference.required, true);
    assert.ok(!JSON.stringify(snapshot).includes('secret'));
    assert.equal(
      ContextSnapshotSchema.safeParse({
        ...snapshot,
        resolutions: [],
      }).success,
      false,
    );
  });
});
