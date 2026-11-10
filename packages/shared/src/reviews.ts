import { z } from 'zod';

/** Owned target reviews, with original normalized optional source fields. */
export const reviewSchema = z.object({
  id: z.uuid(),
  targetId: z.uuid(),
  sourceReviewId: z.string().nullable(),
  text: z.string(),
  rating: z.number().min(1).max(5),
  reviewerName: z.string().nullable(),
  publishedAt: z.string().nullable(),
  reviewUrl: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const reviewsResponseSchema = z.object({ data: z.array(reviewSchema) });
export type ReviewResponse = z.infer<typeof reviewSchema>;
