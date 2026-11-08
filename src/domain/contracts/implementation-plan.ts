import { z } from 'zod';

import { text } from './text.js';

export const ImplementationPlanSchema = z.object({
  version: z.number().int().positive(),
  summary: text,
  steps: z.array(text).min(1),
});
export type ImplementationPlan = z.infer<typeof ImplementationPlanSchema>;
