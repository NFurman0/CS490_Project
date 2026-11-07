import { describe, expect, it } from 'vitest';
import { isClerkPublishableKey } from './clerk.js';

const encode = (host: string) => btoa(`${host}$`);

describe('isClerkPublishableKey', () => {
  it('accepts development and production keys', () => {
    expect(isClerkPublishableKey(`pk_test_${encode('example.clerk.accounts.dev')}`)).toBe(true);
    expect(isClerkPublishableKey(`pk_live_${encode('clerk.example.com')}`)).toBe(true);
  });

  it('rejects placeholders and made-up keys', () => {
    expect(isClerkPublishableKey('pk_test_replace_me')).toBe(false);
    expect(isClerkPublishableKey('pk_test_local123')).toBe(false);
  });

  it('rejects secret keys', () => {
    expect(isClerkPublishableKey(`sk_test_${encode('example.clerk.accounts.dev')}`)).toBe(false);
  });
});
