import { z } from 'zod';

import { text } from './text.js';

export const VerificationResultSchema = z.object({
  snapshot: text,
  passed: z.boolean(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
