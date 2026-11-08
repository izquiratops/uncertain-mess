import { z } from 'zod';

import { text } from './text.js';
import { ExternalContextSchema } from './external-context.js';

export const TaskContextSchema = z.object({
  issueId: text,
  title: text,
  description: text,
  acceptanceCriteria: z.array(text),
  references: z.array(z.url()),
  externalContext: z.array(ExternalContextSchema).optional(),
});
export type TaskContext = z.infer<typeof TaskContextSchema>;
