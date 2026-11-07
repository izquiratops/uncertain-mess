import {
  ExternalContextSchema,
  IssueSchema,
  TaskContextSchema,
  type ContextReference,
  type ExternalContext,
  type Issue,
  type TaskContext,
} from '../domain/contracts.js';

/** A ticket system normalizes its own response into an Issue. */
export interface IssueProvider {
  getIssue(id: string): Promise<Issue>;
}

/** A source declares which references it can resolve; failures reject the promise. */
export interface ContextSource {
  supports(reference: ContextReference): boolean;
  resolve(reference: ContextReference): Promise<ExternalContext>;
}

export class RequiredContextError extends Error {
  constructor(
    public readonly url: string,
    options?: ErrorOptions,
  ) {
    super(`Required context unavailable: ${url}`, options);
    this.name = 'RequiredContextError';
  }
}

/** Builds a validated snapshot. Optional references remain listed even if unavailable. */
export async function createTaskContext(
  issueProvider: IssueProvider,
  sources: readonly ContextSource[],
  issueId: string,
): Promise<TaskContext> {
  const issue = IssueSchema.parse(await issueProvider.getIssue(issueId));
  const externalContext: ExternalContext[] = [];
  for (const reference of issue.references) {
    try {
      const source = sources.find((candidate) => candidate.supports(reference));
      if (!source) throw new Error('No context source supports this reference');
      const context = ExternalContextSchema.parse(
        await source.resolve(reference),
      );
      if (context.url !== reference.url)
        throw new Error('Context URL does not match reference');
      externalContext.push(context);
    } catch (error) {
      if (reference.required)
        throw new RequiredContextError(reference.url, { cause: error });
    }
  }
  return TaskContextSchema.parse({
    issueId: issue.id,
    title: issue.title,
    description: issue.description,
    acceptanceCriteria: issue.acceptanceCriteria,
    references: issue.references.map((reference) => reference.url),
    externalContext,
  });
}
