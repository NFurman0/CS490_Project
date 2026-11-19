import { describe, expect, it, vi } from 'vitest';
import { askQuestion } from './api';

describe('askQuestion', () => {
  it('posts the question to the active target Q&A endpoint', async () => {
    const answer = {
      target: { id: 'target/1', name: 'Coffee shop', platform: 'google_maps' },
      outcome: 'grounded_answer' as const,
      answer: 'Customers praise the coffee.',
      reviewCount: 12,
      context: { reviewsUsed: 12, truncated: false },
    };
    const post = vi.fn().mockResolvedValue(answer);
    const client = { post };

    await expect(askQuestion(client, 'target/1', 'What do customers like?')).resolves.toEqual(
      answer,
    );
    expect(post).toHaveBeenCalledWith('/api/analysis-targets/target%2F1/qa', {
      question: 'What do customers like?',
    });
  });
});
