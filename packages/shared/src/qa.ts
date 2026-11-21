import { z } from 'zod';

/** Longest question accepted by POST /api/analysis-targets/:targetId/qa. */
export const QA_QUESTION_MAX_LENGTH = 1000;

/** Request body for asking a question. Strict, so owner or target fields are rejected. */
export const askQuestionRequestSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(1, 'Enter a question about these reviews.')
      .max(
        QA_QUESTION_MAX_LENGTH,
        `Questions can be at most ${QA_QUESTION_MAX_LENGTH} characters.`,
      ),
  })
  .strict();

export type AskQuestionRequest = z.infer<typeof askQuestionRequestSchema>;

/** Every outcome the Q&A endpoint can return. `no_review_data` means the model was not called. */
export const QA_ANSWER_OUTCOMES = [
  'grounded_answer',
  'insufficient_evidence',
  'out_of_scope_refusal',
  'no_review_data',
] as const;

export const qaAnswerSchema = z.object({
  target: z.object({ id: z.string(), name: z.string(), platform: z.string() }),
  outcome: z.enum(QA_ANSWER_OUTCOMES),
  answer: z.string(),
  reviewCount: z.number().int().nonnegative(),
  context: z.object({ reviewsUsed: z.number().int().nonnegative(), truncated: z.boolean() }),
});

export const qaAnswerResponseSchema = z.object({ data: qaAnswerSchema });

export type QaAnswerResponse = z.infer<typeof qaAnswerResponseSchema>;
