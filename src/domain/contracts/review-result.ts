import { z } from 'zod';

import { text } from './text.js';

export const ReviewerSchema = z.enum(['correctness', 'tests', 'simplicity']);

export const ReviewResultSchema = z.object({
  reviewer: ReviewerSchema,
  snapshot: text,
  approved: z.boolean(),
  findings: z.array(text),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
