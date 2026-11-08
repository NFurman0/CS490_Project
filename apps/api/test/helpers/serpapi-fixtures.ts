import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE_DIR = resolve(import.meta.dirname, '../fixtures/serpapi');

/** Loads a saved SerpApi response from test/fixtures/serpapi. */
export function loadSerpApiFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, name), 'utf8'));
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
