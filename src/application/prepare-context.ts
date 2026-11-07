import {
  ContextSnapshotSchema,
  type ContextSnapshot,
  type WorkflowEvent,
  type WorkflowState,
} from '../domain/contracts.js';
import {
  collectContextSnapshot,
  type ContextSource,
  type IssueProvider,
} from './context.js';

export interface ContextRunRepository {
  load(
    id: string,
  ):
    | { id: string; issueId: string; version: number; state: WorkflowState }
    | undefined;
  append(
    id: string,
    expectedVersion: number,
    event: WorkflowEvent,
    artifacts?: { name: string; version: number; content: string }[],
  ): { version: number; state: WorkflowState };
  artifacts(id: string): { name: string; version: number; content: string }[];
}

/** Collects once per attempt; the result and transition are committed atomically. */
export async function prepareContext(
  repository: ContextRunRepository,
  provider: IssueProvider,
  sources: readonly ContextSource[],
  runId: string,
  options: { retry?: boolean } = {},
): Promise<ContextSnapshot | undefined> {
  let run = repository.load(runId);
  if (!run) {
    throw new Error('Run not found');
  }
  if (run.state.status === 'planning') {
    const snapshots = repository
      .artifacts(runId)
      .filter((artifact) => artifact.name === 'context-snapshot');
    const latest = snapshots.sort((a, b) => b.version - a.version)[0];
    if (!latest) {
      throw new Error('Context snapshot missing');
    }
    return ContextSnapshotSchema.parse(JSON.parse(latest.content));
  }
  if (run.state.status === 'needs_attention' && options.retry) {
    repository.append(runId, run.version, { type: 'context_retry' });
    run = repository.load(runId)!;
  }
  if (run.state.status !== 'created') {
    throw new Error('Run is not ready for context collection');
  }
  const attempt = repository.append(runId, run.version, {
    type: 'context_collection_started',
  });
  let snapshot: ContextSnapshot;
  try {
    snapshot = await collectContextSnapshot(provider, sources, run.issueId);
    if (snapshot.issue.id !== run.issueId) {
      throw new Error('Issue mismatch');
    }
  } catch {
    repository.append(runId, attempt.version, {
      type: 'attention_required',
      reason: 'Issue context collection failed',
    });
    return undefined;
  }
  const artifactVersion =
    Math.max(
      0,
      ...repository
        .artifacts(runId)
        .filter((item) => item.name === 'context-snapshot')
        .map((item) => item.version),
    ) + 1;
  const artifact = {
    name: 'context-snapshot',
    version: artifactVersion,
    content: JSON.stringify(snapshot),
  };
  if (
    snapshot.resolutions.some(
      (result) => result.reference.required && result.status === 'unavailable',
    )
  ) {
    repository.append(
      runId,
      attempt.version,
      {
        type: 'attention_required',
        reason: 'Required context unavailable',
      },
      [artifact],
    );
    return snapshot;
  }
  const context = {
    issueId: snapshot.issue.id,
    title: snapshot.issue.title,
    description: snapshot.issue.description,
    acceptanceCriteria: snapshot.issue.acceptanceCriteria,
    references: snapshot.issue.references.map((reference) => reference.url),
    externalContext: snapshot.resolutions
      .filter((result) => result.status === 'resolved')
      .map((result) => ({
        url: result.reference.url,
        content: result.content,
      })),
  };
  repository.append(
    runId,
    attempt.version,
    {
      type: 'context_ready',
      context,
    },
    [artifact],
  );
  return snapshot;
}
