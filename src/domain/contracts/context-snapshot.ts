import { z } from 'zod';

import { IssueSchema } from './issue.js';
import { ContextReferenceSchema } from './context-reference.js';
import { text } from './text.js';

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
