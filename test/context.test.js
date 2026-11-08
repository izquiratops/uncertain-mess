import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskContext, RequiredContextError } from '../dist/index.js';

const url = 'https://example.com/design';
const issue = (references = []) => ({
  id: 'TEAM-1',
  title: 'Title',
  description: 'Description',
  acceptanceCriteria: ['Works'],
  references,
});
const provider = (value) => ({ getIssue: async () => value });

test('normalizes a ticket and resolves context through generic providers', async () => {
  const source = {
    supports: (reference) => reference.url === url,
    resolve: async (reference) => ({
      url: reference.url,
      content: 'Design details',
    }),
  };
  const context = await createTaskContext(
    provider(
      issue([
        {
          url,
          required: true,
        },
      ]),
    ),
    [source],
    'TEAM-1',
  );
  assert.deepEqual(context, {
    issueId: 'TEAM-1',
    title: 'Title',
    description: 'Description',
    acceptanceCriteria: ['Works'],
    references: [url],
    externalContext: [
      {
        url,
        content: 'Design details',
      },
    ],
  });
});

test('required references block when unsupported, failing or invalid', async () => {
  for (const sources of [
    [],
    [
      {
        supports: () => true,
        resolve: async () => {
          throw new Error('offline');
        },
      },
    ],
    [
      {
        supports: () => true,
        resolve: async () => ({
          url,
          content: '',
        }),
      },
    ],
  ]) {
    await assert.rejects(
      createTaskContext(
        provider(
          issue([
            {
              url,
              required: true,
            },
          ]),
        ),
        sources,
        '1',
      ),
      (error) =>
        error instanceof RequiredContextError &&
        error.url === url &&
        !!error.cause,
    );
  }
});

test('unavailable optional references remain visible', async () => {
  const context = await createTaskContext(
    provider(
      issue([
        {
          url,
          required: false,
        },
      ]),
    ),
    [],
    '1',
  );
  assert.deepEqual(context.references, [url]);
  assert.deepEqual(context.externalContext, []);
});

test('invalid issue data is rejected', async () => {
  await assert.rejects(
    createTaskContext(
      provider({
        ...issue(),
        title: '',
      }),
      [],
      '1',
    ),
  );
});
