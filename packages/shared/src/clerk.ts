/**
 * Checks that a value has the shape of a Clerk publishable key: `pk_test_` or
 * `pk_live_` followed by the base64-encoded Frontend API host ending in `$`.
 * Lets both apps reject malformed keys at startup instead of failing on every request.
 */
export function isClerkPublishableKey(value: string): boolean {
  const match = /^pk_(test|live)_([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match?.[2]) return false;
  try {
    const host = atob(match[2]);
    return host.endsWith('$') && host.includes('.');
  } catch {
    return false;
  }
}
