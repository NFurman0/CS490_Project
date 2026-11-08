/**
 * Dev-only: fetches one real page of Google Maps reviews from SerpApi and saves
 * it as a scrubbed test fixture. Costs one SerpApi search per run.
 *
 *   npm run record:fixture -w apps/api -- "<google maps place url>" reviews-page-1.json
 *
 * Reads SERPAPI_API_KEY from apps/api/.env. Prints counts only, never the key or request URL.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolvePlaceRef } from '../src/adapters/serpapi/place-url.js';
import { SERPAPI_SEARCH_URL } from '../src/adapters/serpapi/serpapi.client.js';
import { parseReviewsPage } from '../src/adapters/serpapi/serpapi.parser.js';

const FIXTURE_DIR = resolve(import.meta.dirname, '../test/fixtures/serpapi');
const SCRUBBED_KEYS = new Set([
  'api_key',
  'json_endpoint',
  'google_maps_reviews_url',
  'raw_html_file',
  'next',
]);

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

/** Removes URLs that embed the API key, then double-checks the key's value is gone. */
function scrub(value: unknown, apiKey: string): unknown {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, child]) => [
          k,
          SCRUBBED_KEYS.has(k) ? '[scrubbed]' : walk(child),
        ]),
      );
    }
    return v;
  };
  const cleaned = walk(value);
  if (JSON.stringify(cleaned).includes(apiKey))
    fail('Refusing to save: response still contains the API key.');
  return cleaned;
}

const [sourceUrl, fileName] = process.argv.slice(2);
if (!sourceUrl || !fileName) fail('Usage: record:fixture -- "<google maps place url>" <file.json>');
if (!/^[\w.-]+\.json$/.test(fileName)) fail('File name must be a plain name ending in .json');

if (existsSync('.env')) process.loadEnvFile('.env');
const apiKey = process.env.SERPAPI_API_KEY;
if (!apiKey || apiKey.includes('replace_me')) fail('Set SERPAPI_API_KEY in apps/api/.env first.');

const ref = await resolvePlaceRef(sourceUrl, { fetchFn: fetch, timeoutMs: 15_000 });
if (!ref) fail('That URL does not identify a Google Maps place (SOURCE_UNRESOLVABLE).');

const params = new URLSearchParams({
  engine: 'google_maps_reviews',
  hl: 'en',
  sort_by: 'newestFirst',
});
if ('dataId' in ref) params.set('data_id', ref.dataId);
else params.set('place_id', ref.placeId);
params.set('api_key', apiKey);

const res = await fetch(`${SERPAPI_SEARCH_URL}?${params.toString()}`, {
  signal: AbortSignal.timeout(15_000),
});
const json: unknown = await res.json();
const parsed = parseReviewsPage(json);

out(`HTTP ${res.status}`);
if (parsed.kind === 'page') {
  const withText = parsed.reviews.filter((r) => r.text !== null).length;
  const withRating = parsed.reviews.filter((r) => r.rating !== null).length;
  out(`Place: ${parsed.place.title ?? '(unknown)'}`);
  out(
    `Reviews on this page: ${parsed.reviews.length} (${withText} with text, ${withRating} with rating)`,
  );
  out(`Has next page: ${parsed.nextPageToken !== null}`);
} else {
  out(`SerpApi returned ${parsed.kind === 'error' ? 'an error' : 'an unexpected shape'}.`);
}

const target = resolve(FIXTURE_DIR, fileName);
writeFileSync(target, `${JSON.stringify(scrub(json, apiKey), null, 2)}\n`);
out(`Saved ${target}`);
