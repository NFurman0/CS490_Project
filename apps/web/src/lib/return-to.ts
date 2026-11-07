const INTERNAL_ORIGIN = 'https://reviewlens.internal';
const MAX_LENGTH = 2048;

/**
 * Returns `value` only if it is a path inside ReviewLens, such as
 * `/analysis-targets?tab=reviews`. Anything that could send the user to another
 * site (`https://…`, `//host`, `/\host`, `javascript:`) returns null, so the
 * sign-in redirect cannot be abused as an open redirect.
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_LENGTH) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || hasControlCharacter(value)) return null;

  const url = new URL(value, INTERNAL_ORIGIN);
  if (url.origin !== INTERNAL_ORIGIN) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** The URL that sends a signed-out user to sign in, then back to `path`. */
export function signInPathFor(path: string): string {
  return `/?${new URLSearchParams({ returnTo: path }).toString()}`;
}
