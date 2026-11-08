import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LinearIssueProvider,
  RequiredContextError,
  createTaskContext,
} from '../../dist/index.js';

const issue = {
  identifier: 'ABC-12',
  title: 'Build screen',
  description:
    'Design: https://figma.com/file/123\n\n## Acceptance criteria\n- [ ] Works\n- Tested\n## Other\n- Not a criterion',
};
const page = (nodes, hasNextPage = false, endCursor = null) => ({
  data: {
    issue: {
      ...issue,
      attachments: {
        nodes,
        pageInfo: {
          hasNextPage,
          endCursor,
        },
      },
    },
  },
});

describe('LinearIssueProvider', () => {
  test('fetches and normalizes Linear issue and paginated attachments', async () => {
    const requests = [];
    const responses = [
      page([{ url: 'https://example.com/a' }], true, 'cursor'),
      page([{ url: 'https://figma.com/file/123' }]),
    ];
    const provider = new LinearIssueProvider({
      apiKey: 'secret',
      fetch: async (url, options) => {
        requests.push({
          url,
          ...options,
          body: JSON.parse(options.body),
        });
        return globalThis.Response.json(responses.shift());
      },
    });
    const context = await createTaskContext(provider, [], 'ABC-12');
    assert.equal(context.issueId, 'ABC-12');
    assert.deepEqual(context.acceptanceCriteria, ['Works', 'Tested']);
    assert.deepEqual(context.references, [
      'https://figma.com/file/123',
      'https://example.com/a',
    ]);
    assert.equal(requests[0].headers.Authorization, 'secret');
    assert.equal(requests[1].body.variables.after, 'cursor');
  });

  test('explicit required context blocks until a source resolves it', async () => {
    const url = 'https://figma.com/file/123';
    const data = page([{ url }]);
    data.data.issue.description = `Design: ${url}\nrequired-context: ${url}`;
    const provider = new LinearIssueProvider({
      apiKey: 'key',
      fetch: async () => globalThis.Response.json(data),
    });

    const normalized = await provider.getIssue('ABC-12');
    assert.deepEqual(normalized.references, [
      {
        url,
        required: true,
      },
    ]);
    await assert.rejects(
      createTaskContext(provider, [], 'ABC-12'),
      RequiredContextError,
    );

    const source = {
      supports: () => true,
      resolve: async (reference) => ({
        url: reference.url,
        content: 'Design',
      }),
    };
    const context = await createTaskContext(provider, [source], 'ABC-12');
    assert.deepEqual(context.externalContext, [
      {
        url,
        content: 'Design',
      },
    ]);
  });

  test('rejects malformed required-context directives', async () => {
    for (const directive of [
      'required-context:',
      'required-context: not-a-url',
      'required-context: https://example.com extra',
    ]) {
      const data = page([]);
      data.data.issue.description = directive;
      const provider = new LinearIssueProvider({
        apiKey: 'key',
        fetch: async () => globalThis.Response.json(data),
      });
      await assert.rejects(
        provider.getIssue('ABC-12'),
        /Invalid required-context/,
      );
    }
  });

  test('rejects HTTP, GraphQL and pagination errors', async () => {
    for (const response of [
      new globalThis.Response('', { status: 401 }),
      globalThis.Response.json({ errors: [{ message: 'denied' }] }),
      globalThis.Response.json(page([], true, null)),
    ]) {
      const provider = new LinearIssueProvider({
        apiKey: 'key',
        fetch: async () => response,
      });
      await assert.rejects(provider.getIssue('ABC-12'));
    }
  });
});
