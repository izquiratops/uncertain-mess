import { z } from 'zod';

const text = z.string().trim().min(1);
export const ContextReferenceSchema = z.object({
  url: z.url(),
  required: z.boolean(),
});
export type ContextReference = z.infer<typeof ContextReferenceSchema>;

export const ExternalContextSchema = z.object({
  url: z.url(),
  content: text,
});
export type ExternalContext = z.infer<typeof ExternalContextSchema>;

export const IssueSchema = z.object({
  id: text,
  title: text,
  description: text,
  acceptanceCriteria: z.array(text),
  references: z.array(ContextReferenceSchema),
});
export type Issue = z.infer<typeof IssueSchema>;

export const TaskContextSchema = z.object({
  issueId: text,
  title: text,
  description: text,
  acceptanceCriteria: z.array(text),
  references: z.array(z.url()),
  externalContext: z.array(ExternalContextSchema).optional(),
});
export type TaskContext = z.infer<typeof TaskContextSchema>;

export const ContextResolutionSchema = z.discriminatedUnion('status', [
  z.object({
    reference: ContextReferenceSchema,
    status: z.literal('resolved'),
    content: text,
  }),
  z.object({
    reference: ContextReferenceSchema,
    status: z.literal('unavailable'),
    reason: text,
  }),
]);
export const ContextSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    issue: IssueSchema,
    resolutions: z.array(ContextResolutionSchema),
  })
  .superRefine((snapshot, ctx) => {
    if (
      snapshot.resolutions.length !== snapshot.issue.references.length ||
      snapshot.resolutions.some((result, index) => {
        const reference = snapshot.issue.references[index];
        return (
          !reference ||
          result.reference.url !== reference.url ||
          result.reference.required !== reference.required
        );
      })
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Resolutions must correspond to issue references in order',
      });
    }
  });
export type ContextSnapshot = z.infer<typeof ContextSnapshotSchema>;

export const ImplementationPlanSchema = z.object({
  version: z.number().int().positive(),
  summary: text,
  steps: z.array(text).min(1),
});
export type ImplementationPlan = z.infer<typeof ImplementationPlanSchema>;

export const VerificationResultSchema = z.object({
  snapshot: text,
  passed: z.boolean(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const ReviewerSchema = z.enum(['correctness', 'tests', 'simplicity']);
export const ReviewResultSchema = z.object({
  reviewer: ReviewerSchema,
  snapshot: text,
  approved: z.boolean(),
  findings: z.array(text),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

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
]);
export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>;
