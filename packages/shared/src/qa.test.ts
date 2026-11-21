import { describe, expect, it } from 'vitest';
import { askQuestionRequestSchema, QA_QUESTION_MAX_LENGTH } from './qa.js';

describe('askQuestionRequestSchema', () => {
  it('accepts a question and trims surrounding whitespace', () => {
    expect(askQuestionRequestSchema.parse({ question: '  What do people like?  ' })).toEqual({
      question: 'What do people like?',
    });
  });

  it.each([
    ['an empty question', { question: '' }],
    ['a whitespace-only question', { question: '   ' }],
    ['a question over the length limit', { question: 'a'.repeat(QA_QUESTION_MAX_LENGTH + 1) }],
    ['a missing question', {}],
    ['client-supplied ownership fields', { question: 'Hi?', ownerId: 'someone-else' }],
  ])('rejects %s', (_label, body) => {
    expect(askQuestionRequestSchema.safeParse(body).success).toBe(false);
  });
});
