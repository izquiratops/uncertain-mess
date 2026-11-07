import { z } from 'zod';
import type { ContextSource } from '../application/context.js';
import type { ContextReference, ExternalContext } from '../domain/contracts.js';

const FileSchema = z
  .object({
    name: z.string().min(1),
    document: z
      .object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
      })
      .passthrough(),
  })
  .passthrough();
const NodesSchema = z
  .object({
    name: z.string().min(1),
    nodes: z.record(
      z.string(),
      z
        .object({
          document: z
            .object({
              id: z.string(),
              name: z.string(),
              type: z.string(),
            })
            .passthrough(),
        })
        .passthrough()
        .nullable(),
    ),
  })
  .passthrough();

function parseFigmaUrl(
  value: string,
): { key: string; nodeId?: string } | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== 'https:' ||
    !['figma.com', 'www.figma.com'].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password
  ) {
    return undefined;
  }
  const match = /^\/(?:file|design)\/([a-zA-Z0-9]+)(?:\/|$)/.exec(url.pathname);
  if (!match) {
    return undefined;
  }
  const nodeId = url.searchParams.get('node-id');
  if (nodeId !== null && !/^\d+[:-]\d+$/.test(nodeId)) {
    return undefined;
  }
  return {
    key: match[1],
    ...(nodeId ? { nodeId: nodeId.replace('-', ':') } : {}),
  };
}

export interface FigmaContextSourceOptions {
  accessToken: string;
  fetch?: typeof fetch;
}

/** Resolves Figma file or node links using the official REST API. */
export class FigmaContextSource implements ContextSource {
  constructor(private readonly options: FigmaContextSourceOptions) {
    if (!options.accessToken.trim()) {
      throw new Error('Figma access token is required');
    }
  }

  supports(reference: ContextReference): boolean {
    return parseFigmaUrl(reference.url) !== undefined;
  }

  async resolve(reference: ContextReference): Promise<ExternalContext> {
    const parsed = parseFigmaUrl(reference.url);
    if (!parsed) {
      throw new Error('Unsupported Figma URL');
    }
    const endpoint = new URL(
      `https://api.figma.com/v1/files/${parsed.key}${parsed.nodeId ? '/nodes' : ''}`,
    );
    if (parsed.nodeId) {
      endpoint.searchParams.set('ids', parsed.nodeId);
    }
    const response = await (this.options.fetch ?? fetch)(endpoint, {
      headers: { 'X-Figma-Token': this.options.accessToken },
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Figma request failed with HTTP ${response.status}`);
    }
    const data: unknown = await response.json();
    if (parsed.nodeId) {
      const result = NodesSchema.parse(data);
      if (!result.nodes[parsed.nodeId]) {
        throw new Error('Figma node not found');
      }
      return {
        url: reference.url,
        content: JSON.stringify(result),
      };
    }
    return {
      url: reference.url,
      content: JSON.stringify(FileSchema.parse(data)),
    };
  }
}
