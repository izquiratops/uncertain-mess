import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FigmaContextSource,
  LinearIssueProvider,
  SqliteRunRepository,
  prepareContext,
} from '../../dist/index.js';

const env = process.env;
const missing = (...names) => {
  const absent = names.filter((name) => !env[name]?.trim());
  return absent.length
    ? `Missing environment variables: ${absent.join(', ')}`
    : false;
};

// Do not expose provider errors, response bodies or configuration values in test output.
async function safely(operation) {
  try {
    return await operation();
  } catch {
    throw new Error(
      'Provider request failed; check test configuration and access',
    );
  }
}

const request = (url, options) =>
  globalThis.fetch(url, {
    ...options,
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(30000),
  });
const linear = (fetchImplementation = request) =>
  new LinearIssueProvider({
    apiKey: env.LINEAR_API_KEY,
    fetch: fetchImplementation,
  });
const figma = () =>
  new FigmaContextSource({
    accessToken: env.FIGMA_ACCESS_TOKEN,
    fetch: request,
  });

describe('Linear integration', () => {
  test(
    'normalizes a real issue, criterion and attachment',
    {
      skip: missing(
        'LINEAR_API_KEY',
        'LINEAR_ISSUE_ID',
        'LINEAR_EXPECTED_CRITERION',
        'LINEAR_EXPECTED_ATTACHMENT_URL',
      ),
    },
    async () => {
      let attachmentFound = false;
      const checkingFetch = async (url, options) => {
        const response = await request(url, options);
        const body = await response.clone().json();
        const nodes = body.data?.issue?.attachments?.nodes ?? [];
        attachmentFound ||= nodes.some(
          (node) => node.url === env.LINEAR_EXPECTED_ATTACHMENT_URL,
        );
        return response;
      };
      const issue = await safely(() =>
        linear(checkingFetch).getIssue(env.LINEAR_ISSUE_ID),
      );
      assert.ok(attachmentFound, 'Expected attachment not returned by Linear');
      assert.ok(
        issue.id === env.LINEAR_ISSUE_ID,
        'Issue identifier does not match',
      );
      assert.ok(
        issue.acceptanceCriteria.includes(env.LINEAR_EXPECTED_CRITERION),
        'Expected criterion not found',
      );
      assert.ok(
        issue.references.some(
          (ref) => ref.url === env.LINEAR_EXPECTED_ATTACHMENT_URL,
        ),
        'Expected attachment URL not found',
      );
    },
  );

  test(
    'fetches more than one real attachment page',
    {
      skip: missing('LINEAR_API_KEY', 'LINEAR_PAGINATION_ISSUE_ID'),
    },
    async () => {
      let pages = 0;
      let attachments = 0;
      const countingFetch = async (url, options) => {
        const response = await request(url, options);
        const body = await response.clone().json();
        pages++;
        attachments += body.data?.issue?.attachments?.nodes?.length ?? 0;
        return response;
      };
      await safely(() =>
        linear(countingFetch).getIssue(env.LINEAR_PAGINATION_ISSUE_ID),
      );
      assert.ok(
        pages > 1 && attachments > 100,
        'Issue must return more than 100 attachments across multiple pages',
      );
    },
  );
});

describe('Figma integration', () => {
  for (const [name, variable, isNode] of [
    ['file', 'FIGMA_FILE_URL', false],
    ['node', 'FIGMA_NODE_URL', true],
  ]) {
    test(
      `resolves a real ${name}`,
      { skip: missing('FIGMA_ACCESS_TOKEN', variable) },
      async () => {
        const url = env[variable];
        const reference = {
          url,
          required: true,
        };
        const source = figma();
        assert.ok(source.supports(reference), 'Unsupported Figma test URL');
        assert.ok(
          new globalThis.URL(url).searchParams.has('node-id') === isNode,
          'Unexpected Figma URL type',
        );
        const result = await safely(() => source.resolve(reference));
        const content = JSON.parse(result.content);
        assert.ok(
          result.url === url && typeof content.name === 'string',
          'Invalid Figma result',
        );
        assert.ok(
          isNode
            ? Object.values(content.nodes).some(Boolean)
            : Boolean(content.document),
          'Missing Figma document',
        );
      },
    );
  }
});

describe('Context integration', () => {
  test(
    'persists and reuses a real Linear and Figma snapshot after restart',
    {
      skip: missing(
        'LINEAR_API_KEY',
        'LINEAR_ISSUE_ID',
        'FIGMA_ACCESS_TOKEN',
        'FIGMA_NODE_URL',
      ),
    },
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'issue-to-pr-integration-'));
      const path = join(directory, 'runs.sqlite');
      let repository;
      try {
        repository = new SqliteRunRepository(path);
        repository.create('integration', env.LINEAR_ISSUE_ID);
        const snapshot = await safely(() =>
          prepareContext(repository, linear(), [figma()], 'integration'),
        );
        assert.ok(snapshot, 'Context collection failed');
        assert.ok(
          repository.load('integration').state.status === 'planning',
          'Context did not reach planning',
        );
        assert.ok(
          snapshot.resolutions.some(
            (result) =>
              result.reference.url === env.FIGMA_NODE_URL &&
              result.reference.required &&
              result.status === 'resolved',
          ),
          'Required Figma node was not resolved',
        );
        const saved = repository
          .artifacts('integration')
          .find((artifact) => artifact.name === 'context-snapshot');
        assert.ok(
          saved && saved.content === JSON.stringify(snapshot),
          'Snapshot was not persisted',
        );
        repository.close();
        repository = undefined;
        repository = new SqliteRunRepository(path);
        const reused = await safely(() =>
          prepareContext(
            repository,
            {
              getIssue: async () => {
                throw new Error('Unexpected provider call');
              },
            },
            [],
            'integration',
          ),
        );
        assert.ok(
          JSON.stringify(reused) === saved.content,
          'Persisted snapshot was not reused',
        );
        assert.ok(
          repository.load('integration').state.status === 'planning',
          'State was not restored',
        );
      } finally {
        repository?.close();
        rmSync(directory, {
          recursive: true,
          force: true,
        });
      }
    },
  );
});
