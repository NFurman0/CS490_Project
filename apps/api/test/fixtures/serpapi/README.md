# SerpApi fixtures

Saved `google_maps_reviews` responses used by the adapter tests in
`apps/api/src/adapters/serpapi/`. Tests never call SerpApi (Engineering Standards §11.3).
The app never reads these files at runtime.

- `reviews-real.json`: one page recorded from the live SerpApi API (Blank Street), with key-bearing URLs scrubbed.
- `reviews-page-1.json`, `reviews-page-2.json`: a two-page result (page 1 has `next_page_token`).
- `reviews-malformed.json`: records with missing text, a non-numeric rating, and missing metadata.
- `reviews-empty.json`: a place that exists but has no reviews.
- `error-quota.json`, `error-no-results.json`: SerpApi error bodies.

In every file except `reviews-real.json`, reviewer names and review text are placeholders in SerpApi's response shape.
To capture a real response, see "Re-recording fixtures" in `docs/ingestion-approach.md`.
Never commit a file containing `api_key`.
