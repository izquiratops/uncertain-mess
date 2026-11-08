import { z } from 'zod';

import { text } from './text.js';
import { ContextReferenceSchema } from './context-reference.js';

export const IssueSchema = z.object({
  id: text,
  title: text,
  description: text,
  acceptanceCriteria: z.array(text),
  references: z.array(ContextReferenceSchema),
});
export type Issue = z.infer<typeof IssueSchema>;
