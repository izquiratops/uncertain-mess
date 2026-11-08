import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition } from '../dist/index.js';

describe('workflow: context retry', () => {
  test('context retry resumes only an initial context failure', () => {
    const blocked = transition(initialState(), {
      type: 'attention_required',
      reason: 'Context unavailable',
    });
    assert.equal(blocked.attentionFrom, 'created');
    const repeated = transition(blocked, {
      type: 'attention_required',
      reason: 'Still unavailable',
    });
    assert.equal(
      transition(repeated, { type: 'context_retry' }).status,
      'created',
    );
    assert.throws(
      () => transition(initialState(), { type: 'context_retry' }),
      /Invalid transition/,
    );
    const planning = {
      status: 'planning',
      reviews: [],
    };
    const blockedPlanning = transition(planning, {
      type: 'attention_required',
      reason: 'Other failure',
    });
    assert.throws(
      () => transition(blockedPlanning, { type: 'context_retry' }),
      /Invalid transition/,
    );
    assert.throws(
      () =>
        transition(
          {
            status: 'needs_attention',
            reviews: [],
          },
          { type: 'context_retry' },
        ),
      /Invalid transition/,
    );
  });
});
