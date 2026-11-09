import { describe, expect, it } from 'vitest';
import { createAnalysisTargetSchema } from './analysis-targets.js';

describe('createAnalysisTargetSchema', () => {
  it('accepts and trims a name and a valid HTTP URL', () => {
    expect(
      createAnalysisTargetSchema.parse({
        name: ' Joe’s Pizza ',
        sourceUrl: ' https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4 ',
      }),
    ).toEqual({
      name: 'Joe’s Pizza',
      sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4',
    });
  });

  it.each([
    [
      {
        name: '   ',
        sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4',
      },
      'name',
    ],
    [
      {
        name: 'x'.repeat(201),
        sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4',
      },
      'name',
    ],
    [{ name: 'Place', sourceUrl: 'not a URL' }, 'sourceUrl'],
    [{ name: 'Place', sourceUrl: 'javascript:alert(1)' }, 'sourceUrl'],
  ])('rejects invalid input %#', (input, field) => {
    const result = createAnalysisTargetSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes(field))).toBe(true);
    }
  });

  it('rejects client-supplied ownership and platform fields', () => {
    const result = createAnalysisTargetSchema.safeParse({
      name: 'Place',
      sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4',
      ownerId: 'another-user',
      platform: 'yelp',
    });

    expect(result.success).toBe(false);
  });
});
