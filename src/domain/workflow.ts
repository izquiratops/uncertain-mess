import {
  WorkflowEventSchema,
  WorkflowStateSchema,
  type WorkflowEvent,
  type WorkflowState,
} from './contracts.js';

export function initialState(): WorkflowState {
  return {
    status: 'created',
    reviews: [],
  };
}

/** Returns a new state; invalid events never mutate the input. */
export function transition(
  input: WorkflowState,
  rawEvent: WorkflowEvent,
): WorkflowState {
  const state = WorkflowStateSchema.parse(input);
  const event = WorkflowEventSchema.parse(rawEvent);
  const invalid = (): never => {
    throw new Error(`Invalid transition: ${event.type} from ${state.status}`);
  };

  if (event.type === 'attention_required' && state.status !== 'completed') {
    return {
      ...state,
      status: 'needs_attention',
    };
  }
  if (
    event.type === 'scope_changed' &&
    [
      'awaiting_approval',
      'implementing',
      'verifying',
      'reviewing',
      'ready_for_pr',
    ].includes(state.status)
  ) {
    return {
      status: 'planning',
      plan: state.plan,
      reviews: [],
    };
  }
  if (
    event.type === 'code_changed' &&
    ['implementing', 'verifying', 'reviewing', 'ready_for_pr'].includes(
      state.status,
    )
  ) {
    return {
      ...state,
      status: 'implementing',
      verification: undefined,
      reviews: [],
    };
  }
  switch (event.type) {
    case 'context_ready':
      if (state.status !== 'created') return invalid();
      return {
        ...state,
        status: 'planning',
      };
    case 'plan_proposed':
      if (
        state.status !== 'planning' ||
        (state.plan && event.plan.version <= state.plan.version)
      )
        return invalid();
      return {
        ...state,
        status: 'awaiting_approval',
        plan: event.plan,
        approvedPlanVersion: undefined,
      };
    case 'plan_rejected':
      if (state.status !== 'awaiting_approval') return invalid();
      return {
        ...state,
        status: 'planning',
      };
    case 'plan_approved':
      if (
        state.status !== 'awaiting_approval' ||
        state.plan?.version !== event.version
      )
        return invalid();
      return {
        ...state,
        status: 'implementing',
        approvedPlanVersion: event.version,
      };
    case 'implementation_done':
      if (
        state.status !== 'implementing' ||
        !state.plan ||
        state.approvedPlanVersion !== state.plan.version
      )
        return invalid();
      return {
        ...state,
        status: 'verifying',
        verification: undefined,
        reviews: [],
      };
    case 'verification_finished':
      if (state.status !== 'verifying') return invalid();
      return {
        ...state,
        status: event.result.passed ? 'reviewing' : 'implementing',
        verification: event.result,
        reviews: [],
      };
    case 'review_finished': {
      if (
        state.status !== 'reviewing' ||
        !state.verification?.passed ||
        event.result.snapshot !== state.verification.snapshot ||
        state.reviews.some((r) => r.reviewer === event.result.reviewer)
      )
        return invalid();
      const reviews = [...state.reviews, event.result];
      if (!event.result.approved)
        return {
          ...state,
          status: 'implementing',
          verification: undefined,
          reviews: [],
        };
      return {
        ...state,
        reviews,
        status: reviews.length === 3 ? 'ready_for_pr' : 'reviewing',
      };
    }
    case 'publication_started':
      if (
        state.status !== 'ready_for_pr' ||
        !state.verification?.passed ||
        event.snapshot !== state.verification.snapshot ||
        state.reviews.length !== 3 ||
        !state.reviews.every(
          (r) => r.approved && r.snapshot === event.snapshot,
        ) ||
        new Set(state.reviews.map((r) => r.reviewer)).size !== 3 ||
        !state.plan ||
        state.approvedPlanVersion !== state.plan.version
      )
        return invalid();
      return {
        ...state,
        status: 'publishing',
      };
    case 'publication_finished':
      if (state.status !== 'publishing') return invalid();
      return {
        ...state,
        status: 'completed',
        prUrl: event.prUrl,
      };
    default:
      return invalid();
  }
}
