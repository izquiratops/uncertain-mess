import { z } from 'zod';

import { text } from './text.js';
import { TaskContextSchema } from './task-context.js';
import { ImplementationPlanSchema } from './implementation-plan.js';
import { VerificationResultSchema } from './verification-result.js';
import { ReviewResultSchema } from './review-result.js';

export const WorkflowEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('context_ready'),
    context: TaskContextSchema,
  }),
  z.object({
    type: z.literal('plan_proposed'),
    plan: ImplementationPlanSchema,
  }),
  z.object({ type: z.literal('plan_rejected') }),
  z.object({
    type: z.literal('plan_approved'),
    version: z.number().int().positive(),
  }),
  z.object({ type: z.literal('implementation_done') }),
  z.object({
    type: z.literal('verification_finished'),
    result: VerificationResultSchema,
  }),
  z.object({
    type: z.literal('review_finished'),
    result: ReviewResultSchema,
  }),
  z.object({ type: z.literal('code_changed') }),
  z.object({ type: z.literal('scope_changed') }),
  z.object({
    type: z.literal('publication_started'),
    snapshot: text,
  }),
  z.object({
    type: z.literal('publication_finished'),
    prUrl: z.url(),
  }),
  z.object({
    type: z.literal('attention_required'),
    reason: text,
  }),
  z.object({ type: z.literal('context_retry') }),
  z.object({ type: z.literal('context_collection_started') }),
]);
export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>;
