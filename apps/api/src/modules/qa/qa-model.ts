import { z } from 'zod';

/**
 * The model boundary. The Q&A service talks to the LLM only through `QaModel`, so tests can replace the provider with a fake that
 * records every request and returns a controlled response. Provider SDKs and
 * response formats stay inside the adapter that implements this interface.
 */

/** The three answer kinds a model may return. */
export const QA_OUTCOMES = [
  'grounded_answer',
  'insufficient_evidence',
  'out_of_scope_refusal',
] as const;

export type QaOutcome = (typeof QA_OUTCOMES)[number];

/** A review as supplied to the model only supplying what the answer needs. */
export interface QaContextReview {
  id: string;
  rating: number;
  text: string;
  reviewerName: string | null;
  publishedAt: string | null;
}

/** Everything the application sends across the model boundary for one question. */
export interface QaModelRequest {
  systemPrompt: string;
  target: { name: string; platform: string };
  reviews: readonly QaContextReview[];
  /** Distinct reviews the target has. Greater than `reviews.length` when the context was trimmed. */
  availableReviewCount: number;
  question: string;
}

/** The structured answer every adapter must return. Validated before the app uses it. */
export const qaModelResponseSchema = z
  .object({
    outcome: z.enum(QA_OUTCOMES),
    answer: z.string().trim().min(1),
  })
  .strict();

export type QaModelResponse = z.infer<typeof qaModelResponseSchema>;

export interface QaModel {
  /** Answers one question. Throws on provider failure; the service handles it. */
  complete(request: QaModelRequest): Promise<QaModelResponse>;
}
