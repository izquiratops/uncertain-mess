import { z } from 'zod';

import { ImplementationPlanSchema } from './implementation-plan.js';
import { VerificationResultSchema } from './verification-result.js';
import { ReviewResultSchema } from './review-result.js';

export const WorkflowStateSchema = z.object({
  status: z.enum([
    'created',
    'planning',
    'awaiting_approval',
    'implementing',
    'verifying',
    'reviewing',
    'ready_for_pr',
    'publishing',
    'completed',
    'needs_attention',
  ]),
  attentionFrom: z
    .enum([
      'created',
      'planning',
      'awaiting_approval',
      'implementing',
      'verifying',
      'reviewing',
      'ready_for_pr',
      'publishing',
    ])
    .optional(),
  plan: ImplementationPlanSchema.optional(),
  approvedPlanVersion: z.number().int().positive().optional(),
  verification: VerificationResultSchema.optional(),
  reviews: z.array(ReviewResultSchema),
  prUrl: z.string().url().optional(),
});
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
