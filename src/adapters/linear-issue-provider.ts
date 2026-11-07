import { z } from 'zod';
import { IssueSchema, type Issue } from '../domain/contracts.js';
import type { IssueProvider } from '../application/context.js';

const responseSchema = z.object({
  errors: z.array(z.object({ message: z.string() })).optional(),
  data: z
    .object({
      issue: z
        .object({
          identifier: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          attachments: z.object({
            nodes: z.array(z.object({ url: z.url() })),
            pageInfo: z.object({
              hasNextPage: z.boolean(),
              endCursor: z.string().nullable(),
            }),
          }),
        })
        .nullable(),
    })
    .nullable()
    .optional(),
});

const query = `query IssueContext($id: String!, $after: String) {
  issue(id: $id) {
    identifier
    title
    description
    attachments(first: 100, after: $after) {
      nodes {
        url
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

/** Extracts checklist items under an English or Spanish acceptance-criteria heading. */
function acceptanceCriteria(description: string): string[] {
  const lines = description.split(/\r?\n/);
  const heading =
    /^\s*(#{1,6})\s+(?:acceptance criteria|criterios de aceptación)\s*:?\s*$/i;
  const index = lines.findIndex((line) => heading.test(line));
  if (index < 0) {
    return [];
  }
  const level = heading.exec(lines[index])![1].length;
  const criteria: string[] = [];
  for (const line of lines.slice(index + 1)) {
    const nextHeading = /^\s*(#{1,6})\s+/.exec(line);
    if (nextHeading && nextHeading[1].length <= level) {
      break;
    }
    const item = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/.exec(line);
    if (item) {
      criteria.push(item[1]);
    }
  }
  return criteria;
}

function descriptionUrls(description: string): string[] {
  const text = description
    .split(/\r?\n/)
    .filter((line) => !/^\s*required-context\s*:/i.test(line))
    .join('\n');
  return [...text.matchAll(/https?:\/\/[^\s<>"']+/g)]
    .map((match) => match[0].replace(/[),.\];!?]+$/, ''))
    .filter((url) => z.url().safeParse(url).success);
}

/** Explicit directives prevent inaccessible required references from being ignored. */
function requiredContextUrls(description: string): string[] {
  const urls: string[] = [];
  for (const line of description.split(/\r?\n/)) {
    const directive = /^\s*required-context\s*:\s*(.*?)\s*$/i.exec(line);
    if (!directive) {
      continue;
    }
    const url = directive[1];
    if (
      /\s/.test(url) ||
      !/^https?:\/\//i.test(url) ||
      !z.url().safeParse(url).success
    ) {
      throw new Error(
        'Invalid required-context directive in Linear description',
      );
    }
    urls.push(url);
  }
  return urls;
}

export interface LinearIssueProviderOptions {
  apiKey: string;
  fetch?: typeof fetch;
  endpoint?: string;
}

export class LinearIssueProvider implements IssueProvider {
  private readonly request: typeof fetch;
  private readonly endpoint: string;

  constructor(private readonly options: LinearIssueProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new Error('Linear API key is required');
    }
    this.request = options.fetch ?? fetch;
    this.endpoint = options.endpoint ?? 'https://api.linear.app/graphql';
  }

  async getIssue(id: string): Promise<Issue> {
    const attachmentUrls: string[] = [];
    const cursors = new Set<string>();
    let after: string | null = null;
    let details:
      | { identifier: string; title: string; description: string | null }
      | undefined;
    for (;;) {
      const issue = await this.fetchIssuePage(id, after);

      details ??= issue;
      if (
        issue.identifier !== details.identifier ||
        issue.title !== details.title ||
        issue.description !== details.description
      ) {
        throw new Error('Linear issue changed while fetching attachments');
      }
      attachmentUrls.push(...issue.attachments.nodes.map((node) => node.url));

      const page = issue.attachments.pageInfo;
      if (!page.hasNextPage) {
        break;
      }
      if (!page.endCursor || cursors.has(page.endCursor)) {
        throw new Error('Invalid Linear attachments pagination');
      }
      cursors.add(page.endCursor);
      after = page.endCursor;
    }

    const description = details.description ?? '';
    const requiredUrls = new Set(requiredContextUrls(description));
    const uniqueUrls = new Set([
      ...descriptionUrls(description),
      ...attachmentUrls,
      ...requiredUrls,
    ]);
    const references = [...uniqueUrls].map((url) => ({
      url,
      required: requiredUrls.has(url),
    }));

    return IssueSchema.parse({
      id: details.identifier,
      title: details.title,
      description,
      acceptanceCriteria: acceptanceCriteria(description),
      references,
    });
  }

  private async fetchIssuePage(id: string, after: string | null) {
    const response = await this.request(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.options.apiKey,
      },
      body: JSON.stringify({
        query,
        variables: {
          id,
          after,
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Linear request failed with HTTP ${response.status}`);
    }

    const result = responseSchema.parse(await response.json());
    if (result.errors?.length) {
      const messages = result.errors.map((error) => error.message).join('; ');
      throw new Error(`Linear GraphQL error: ${messages}`);
    }

    const issue = result.data?.issue;
    if (!issue) {
      throw new Error(`Linear issue not found: ${id}`);
    }
    return issue;
  }
}
