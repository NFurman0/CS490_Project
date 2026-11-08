/** How SerpApi's Google Maps Reviews engine identifies a place. */
export type PlaceRef = { dataId: string } | { placeId: string };

/** Hosts that serve full Google Maps place pages, e.g. www.google.com, maps.google.co.uk. */
const MAPS_HOST = /^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/i;

/** Hosts that only issue redirects to a full Google Maps URL. */
const SHORT_LINK_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);

/** `!1s0x89c259a61c75684f:0x79d31adb123348d2` inside the `data=` path segment. */
const DATA_ID_IN_PATH = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i;
const DATA_ID = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;
const PLACE_ID = /^[A-Za-z0-9_-]{10,}$/;

const MAX_REDIRECTS = 3;
export const DEFAULT_SOURCE_RESOLUTION_TIMEOUT_MS = 15_000;

export interface ResolvePlaceOptions {
  fetchFn: typeof fetch;
  timeoutMs: number;
}

/**
 * Turns a Google Maps place URL into the identifier SerpApi needs, or `null`
 * when the URL does not identify a single place (SOURCE_UNRESOLVABLE).
 *
 * Supported formats are listed in docs/ingestion-approach.md. Short links are
 * resolved by reading their redirect; their target is parsed, never fetched,
 * unless it is another short link.
 */
export async function resolvePlaceRef(
  sourceUrl: string,
  { fetchFn, timeoutMs }: ResolvePlaceOptions,
): Promise<PlaceRef | null> {
  let url = parseUrl(sourceUrl);

  for (let hop = 0; url && isShortLink(url); hop++) {
    if (hop >= MAX_REDIRECTS) return null;
    url = await followRedirect(url, fetchFn, timeoutMs);
  }

  return url ? placeRefFromMapsUrl(url) : null;
}

/** Extracts a place identifier from a full Google Maps URL. Pure; exported for tests. */
export function placeRefFromMapsUrl(url: URL): PlaceRef | null {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!MAPS_HOST.test(url.hostname)) return null;
  if (!url.pathname.startsWith('/maps')) return null;

  const path = safeDecode(url.pathname);
  const fromPath = DATA_ID_IN_PATH.exec(path)?.[1];
  if (fromPath) return { dataId: fromPath };

  const ftid = url.searchParams.get('ftid');
  if (ftid && DATA_ID.test(ftid)) return { dataId: ftid };

  const queryPlaceId = url.searchParams.get('query_place_id');
  if (queryPlaceId && PLACE_ID.test(queryPlaceId)) return { placeId: queryPlaceId };

  // ?q=place_id:ChIJ...
  const q = url.searchParams.get('q');
  const qPlaceId = q?.startsWith('place_id:') ? q.slice('place_id:'.length) : null;
  if (qPlaceId && PLACE_ID.test(qPlaceId)) return { placeId: qPlaceId };

  return null;
}

function isShortLink(url: URL): boolean {
  if (!SHORT_LINK_HOSTS.has(url.hostname)) return false;
  // goo.gl only redirects to Maps under /maps/; other goo.gl links are not place links.
  return url.hostname !== 'goo.gl' || url.pathname.startsWith('/maps/');
}

async function followRedirect(
  url: URL,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<URL | null> {
  if (url.protocol !== 'https:') return null;
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    return location ? parseUrl(location, url) : null;
  } catch {
    // Unreachable or slow short link: the source cannot be resolved to a place.
    return null;
  }
}

function parseUrl(value: string, base?: URL): URL | null {
  try {
    return new URL(value.trim(), base);
  } catch {
    // Not a URL at all.
    return null;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Malformed percent-encoding: match against the raw path instead.
    return value;
  }
}
