import { z } from 'zod';

/** Response shape for a Review reached through its owned target. The client
 * gets a stable targetId and optional source details, never an ownerId to trust.
 */
export const reviewSchema = z.object({
  id: z.uuid(),
  targetId: z.uuid(),
  sourceReviewId: z.string().nullable(),
  text: z.string(),
  rating: z.number().min(1).max(5),
  reviewerName: z.string().nullable(),
  publishedAt: z.string().nullable(), // Preserve a date-only or offset source value verbatim.
  reviewUrl: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

/** Like other list routes, even an empty target returns { data: [] }. */
export const reviewsResponseSchema = z.object({ data: z.array(reviewSchema) });
export type ReviewResponse = z.infer<typeof reviewSchema>;

/** Full distinct saved-review dataset for one owned AnalysisTarget. */
export const reviewSummarySchema = z.object({
  target: z.object({
    id: z.uuid(),
    name: z.string(),
    platform: z.literal('google_maps'),
  }),
  reviewCount: z.number().int().min(0),
  averageRating: z.number().min(1).max(5).nullable(),
});

export const reviewSummaryResponseSchema = z.object({ data: reviewSummarySchema });
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;
