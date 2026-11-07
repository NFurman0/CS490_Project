import { describe, expect, it } from 'vitest';
import { safeReturnTo, signInPathFor } from './return-to';

describe('safeReturnTo', () => {
  it.each(['/analysis-targets', '/analysis-targets/abc?tab=reviews#latest'])(
    'keeps the internal path %s',
    (path) => {
      expect(safeReturnTo(path)).toBe(path);
    },
  );

  it.each([
    ['missing', null],
    ['empty', ''],
    ['absolute URL', 'https://evil.example/phish'],
    ['protocol-relative URL', '//evil.example'],
    ['backslash trick', '/\\evil.example'],
    ['javascript URL', 'javascript:alert(1)'],
    ['relative path', 'analysis-targets'],
    ['control character', '/analysis-targets\n//evil.example'],
    ['oversized value', `/${'a'.repeat(3000)}`],
  ])('rejects a %s', (_label, value) => {
    expect(safeReturnTo(value)).toBeNull();
  });
});

describe('signInPathFor', () => {
  it('encodes the destination so it survives the round trip', () => {
    const path = '/analysis-targets/abc?tab=reviews';
    const returnTo = new URLSearchParams(signInPathFor(path).slice(2)).get('returnTo');
    expect(safeReturnTo(returnTo)).toBe(path);
  });
});
