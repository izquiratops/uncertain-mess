import { z } from 'zod';

export const ContextReferenceSchema = z.object({
  url: z.url(),
  required: z.boolean(),
});
export type ContextReference = z.infer<typeof ContextReferenceSchema>;
