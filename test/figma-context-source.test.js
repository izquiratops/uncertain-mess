import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FigmaContextSource } from '../dist/index.js';

const reference = (url) => ({
  url,
  required: true,
});
const document = {
  id: '1:2',
  name: 'Frame',
  type: 'FRAME',
  children: [{ name: 'Button' }],
};

test('resolves a Figma node with token and retains its document', async () => {
  const source = new FigmaContextSource({
    accessToken: 'secret',
    fetch: async (url, options) => {
      assert.equal(
        url.href,
        'https://api.figma.com/v1/files/abc123/nodes?ids=1%3A2',
      );
      assert.equal(options.headers['X-Figma-Token'], 'secret');
      assert.equal(options.redirect, 'error');
      return globalThis.Response.json({
        name: 'Design',
        nodes: { '1:2': { document } },
      });
    },
  });
  const ref = reference(
    'https://www.figma.com/design/abc123/design?node-id=1-2',
  );
  assert.equal(source.supports(ref), true);
  assert.deepEqual(
    JSON.parse((await source.resolve(ref)).content).nodes['1:2'].document,
    document,
  );
});

test('resolves files and rejects unsupported links, HTTP errors and invalid nodes', async () => {
  const source = new FigmaContextSource({
    accessToken: 'secret',
    fetch: async () =>
      globalThis.Response.json({
        name: 'File',
        document,
      }),
  });
  const ref = reference('https://figma.com/file/abc123/name');
  assert.equal(JSON.parse((await source.resolve(ref)).content).name, 'File');
  for (const url of [
    'http://figma.com/file/abc',
    'https://figma.com.evil.com/file/abc',
    'https://figma.com/design/abc?node-id=bad',
  ]) {
    assert.equal(source.supports(reference(url)), false);
    await assert.rejects(source.resolve(reference(url)), /Unsupported/);
  }
  const node = reference('https://figma.com/design/abc?node-id=1-2');
  await assert.rejects(source.resolve(node));
  const missing = new FigmaContextSource({
    accessToken: 'secret',
    fetch: async () =>
      globalThis.Response.json({
        name: 'File',
        nodes: { '1:2': null },
      }),
  });
  await assert.rejects(missing.resolve(node), /not found/);
  const denied = new FigmaContextSource({
    accessToken: 'secret',
    fetch: async () => new globalThis.Response('', { status: 403 }),
  });
  await assert.rejects(denied.resolve(ref), /HTTP 403/);
  assert.throws(() => new FigmaContextSource({ accessToken: ' ' }), /token/);
});
