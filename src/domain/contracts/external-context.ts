import { z } from 'zod';

import { text } from './text.js';

export const ExternalContextSchema = z.object({
  url: z.url(),
  content: text,
});
export type ExternalContext = z.infer<typeof ExternalContextSchema>;
