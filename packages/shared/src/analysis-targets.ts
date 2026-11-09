import { z } from 'zod';

export const analysisTargetNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name for this target.')
  .max(200, 'Use 200 characters or fewer.');

export const analysisTargetSourceUrlSchema = z
  .string()
  .trim()
  .min(1, 'Enter a Google Maps place URL.')
  .max(2048, 'Use a URL shorter than 2,048 characters.')
  .url('Enter a valid URL.')
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'Use a URL that starts with https:// or http://.',
  });

export const createAnalysisTargetSchema = z
  .object({
    name: analysisTargetNameSchema,
    sourceUrl: analysisTargetSourceUrlSchema,
  })
  .strict();

export type CreateAnalysisTargetInput = z.infer<typeof createAnalysisTargetSchema>;
