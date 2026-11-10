import { describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl } from './test-database.js';

describe('test database URL guard', () => {
  it('accepts a URL for the dedicated reviewlens_test database', () => {
    expect(() =>
      assertTestDatabaseUrl('postgresql://test:test@localhost:5433/reviewlens_test'),
    ).not.toThrow();
  });

  it.each([
    'postgresql://test:test@localhost:5432/reviewlens',
    'postgresql://test:test@localhost:5433/reviewlens_test_backup',
    'not a database URL',
  ])('rejects a non-test database URL without exposing it', (url) => {
    // The backup name tests exact matching; the normal dev name and malformed
    // input test that neither can reach a destructive integration suite.
    expect(() => assertTestDatabaseUrl(url)).toThrow(/reviewlens_test/);
    try {
      assertTestDatabaseUrl(url);
    } catch (error) {
      expect(String(error)).not.toContain('test:test');
    }
  });
});
