import { z } from 'zod';

export const text = z.string().trim().min(1);
