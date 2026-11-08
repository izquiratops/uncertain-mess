import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition, ReviewResultSchema } from '../../dist/index.js';

const context = {
  issueId: 'A-1',
  title: 'Issue',
  description: 'Description',
  acceptanceCriteria: [],
  references: [],
};
const plan = {
  version: 1,
  summary: 'Plan',
  steps: ['Implement'],
};
const apply = (state, ...events) => events.reduce(transition, state);
const implementing = () =>
  apply(
    initialState(),
    {
      type: 'context_ready',
      context,
    },
    {
      type: 'plan_proposed',
      plan,
    },
    {
      type: 'plan_approved',
      version: 1,
    },
  );
const reviewing = () =>
  apply(
    implementing(),
    { type: 'implementation_done' },
    {
      type: 'verification_finished',
      result: {
        passed: true,
        snapshot: 'abc',
      },
    },
  );
const review = (reviewer, snapshot = 'abc', approved = true) => ({
  type: 'review_finished',
  result: {
    reviewer,
    snapshot,
    approved,
    findings: [],
  },
});

describe('workflow: transitions', () => {
  test('complete workflow with three reviews of the verified snapshot', () => {
    const state = apply(
      reviewing(),
      review('correctness'),
      review('tests'),
      review('simplicity'),
      {
        type: 'publication_started',
        snapshot: 'abc',
      },
      {
        type: 'publication_finished',
        prUrl: 'https://example.com/pr/1',
      },
    );
    assert.equal(state.status, 'completed');
    assert.equal(state.prUrl, 'https://example.com/pr/1');
  });

  test('implementation and publication require approval and verification', () => {
    assert.throws(() =>
      transition(initialState(), { type: 'implementation_done' }),
    );
    assert.throws(() =>
      transition(implementing(), {
        type: 'publication_started',
        snapshot: 'abc',
      }),
    );
    const pending = apply(
      initialState(),
      {
        type: 'context_ready',
        context,
      },
      {
        type: 'plan_proposed',
        plan,
      },
    );
    assert.throws(() =>
      transition(pending, {
        type: 'plan_approved',
        version: 2,
      }),
    );
  });

  test('rejection requires a new version of the plan', () => {
    const state = apply(
      initialState(),
      {
        type: 'context_ready',
        context,
      },
      {
        type: 'plan_proposed',
        plan,
      },
      { type: 'plan_rejected' },
    );
    assert.throws(() =>
      transition(state, {
        type: 'plan_proposed',
        plan,
      }),
    );
    assert.equal(
      transition(state, {
        type: 'plan_proposed',
        plan: {
          ...plan,
          version: 2,
        },
      }).status,
      'awaiting_approval',
    );
  });

  test('failed verification and rejected review return to implementation', () => {
    const verifying = transition(implementing(), {
      type: 'implementation_done',
    });
    assert.equal(
      transition(verifying, {
        type: 'verification_finished',
        result: {
          passed: false,
          snapshot: 'abc',
        },
      }).status,
      'implementing',
    );
    assert.equal(
      transition(reviewing(), review('tests', 'abc', false)).status,
      'implementing',
    );
  });

  test('duplicate reviews or reviews of another snapshot are invalid', () => {
    const state = transition(reviewing(), review('tests'));
    assert.throws(() => transition(state, review('tests')));
    assert.throws(() => transition(state, review('correctness', 'other')));
    assert.equal(state.reviews.length, 1);
  });

  test('code or scope changes invalidate corresponding approvals', () => {
    const ready = apply(
      reviewing(),
      review('correctness'),
      review('tests'),
      review('simplicity'),
    );
    const changed = transition(ready, { type: 'code_changed' });
    assert.equal(changed.status, 'implementing');
    assert.equal(changed.verification, undefined);
    assert.deepEqual(changed.reviews, []);
    const scope = transition(ready, { type: 'scope_changed' });
    assert.equal(scope.status, 'planning');
    assert.equal(scope.approvedPlanVersion, undefined);
    assert.throws(() =>
      transition(changed, {
        type: 'publication_started',
        snapshot: 'abc',
      }),
    );
  });
});

describe('workflow: contracts', () => {
  test('contracts validate external data', () => {
    assert.equal(
      ReviewResultSchema.safeParse({
        reviewer: 'unknown',
        snapshot: 'x',
        approved: true,
        findings: [],
      }).success,
      false,
    );
    assert.throws(() =>
      transition(initialState(), {
        type: 'context_ready',
        context: {
          ...context,
          issueId: '',
        },
      }),
    );
  });
});
