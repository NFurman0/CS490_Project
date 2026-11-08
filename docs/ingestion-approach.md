# Review Ingestion Approach (S1-020)

ReviewLens supports one review platform: **Google Maps**. Reviews come from **SerpApi's [Google Maps Reviews API](https://serpapi.com/google-maps-reviews-api)**. Only the API calls SerpApi. The browser never does.

## Why SerpApi

- Google has no public API that returns all of a place's reviews. The official Places API returns at most 5.
- Scraping Google Maps directly needs browser automation, breaks whenever the page changes, and is against Google's terms. SerpApi handles that and returns stable JSON.
- Each request returns one page of reviews and costs one search from the team's SerpApi plan.

## Where the code lives

| File                                                     | Job                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/ingestion/review-source.ts`        | The `ReviewSource` interface and the `RawReview` shape. The rest of the app uses only these. |
| `apps/api/src/adapters/serpapi/place-url.ts`             | Turns a Google Maps URL into a SerpApi place identifier.                                     |
| `apps/api/src/adapters/serpapi/serpapi.client.ts`        | Fetches one page from SerpApi and turns failures into outcome codes.                         |
| `apps/api/src/adapters/serpapi/serpapi.parser.ts`        | Pure parsing of a SerpApi response into `RawReview` records.                                 |
| `apps/api/src/adapters/serpapi/serpapi-review-source.ts` | Puts the pieces together: resolve, page, cap.                                                |

Parsing is separate from HTTP and from the UI, so it is tested against saved responses with no network.

## Supported source URLs

| Format                 | Example                                                                                       | Becomes                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Full place link        | `https://www.google.com/maps/place/Name/@40.7,-74.1,17z/data=!4m6!3m5!1s0x89c2…:0x40a0…!8m2…` | `data_id`                                                        |
| Place ID query         | `https://www.google.com/maps/place/?q=place_id:ChIJ…`                                         | `place_id`                                                       |
| Search link with place | `https://www.google.com/maps/search/?api=1&query=…&query_place_id=ChIJ…`                      | `place_id`                                                       |
| Share short link       | `https://maps.app.goo.gl/…` or `https://goo.gl/maps/…`                                        | Its redirect is read once and parsed as one of the formats above |

Country domains such as `google.co.uk` work. Any other URL, such as a Maps search with no single place, directions, or a non-Google site, fails as `SOURCE_UNRESOLVABLE` without calling SerpApi. For short links we only read the `Location` header of the redirect. We never load the Google Maps page itself.

## Paging and the review cap

1. Page 1 is requested with `engine=google_maps_reviews`, `data_id` or `place_id`, `hl=en`, and `sort_by=newestFirst`. SerpApi returns up to 8 reviews.
2. While SerpApi returns a `next_page_token` and we have fewer than `MAX_REVIEWS_PER_RUN` reviews, the next page is requested with that token and `num=20`.
3. The result is trimmed to `MAX_REVIEWS_PER_RUN`. With the default of 50, a run costs at most 4 searches.

Paging also stops if a page comes back empty, so a bad token can never loop and spend searches.

## Field mapping (SerpApi → `RawReview`)

| `RawReview`      | SerpApi field                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `sourceReviewId` | `review_id`                                                                                                 |
| `text`           | `extracted_snippet.original`, else `snippet` (the original language is preferred over Google's translation) |
| `rating`         | `rating` (numbers only. Any other type becomes `null`.)                                                     |
| `reviewerName`   | `user.name`                                                                                                 |
| `publishedAt`    | `iso_date`                                                                                                  |
| `reviewUrl`      | `link`                                                                                                      |
| `metadata`       | `likes`, `date` → `relativeDate`, `user.local_guide` → `reviewerIsLocalGuide`, `response` → `ownerResponse` |

The adapter **extracts but does not judge**. A record with missing text or rating is passed on with `null` in that field. The normalizer (S1-021) decides what happens to invalid records. One malformed record never causes the rest of the page to be dropped.

## Outcomes

Source and provider failures are returned as values, not thrown (Engineering Standards §6.4):

| Situation                                                                       | Result                                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| URL is not a Google Maps place                                                  | `SOURCE_UNRESOLVABLE`                                                  |
| SerpApi says it found nothing, and returns no place info                        | `SOURCE_UNRESOLVABLE`                                                  |
| The place exists but has no reviews                                             | `SOURCE_NO_REVIEWS`                                                    |
| No response within 15 seconds                                                   | `PROVIDER_TIMEOUT`                                                     |
| HTTP 429, or "run out of searches"                                              | `PROVIDER_QUOTA_EXHAUSTED`                                             |
| Network failure, non-JSON body, unexpected shape, invalid API key, other errors | `PROVIDER_ERROR`                                                       |
| Page 1 succeeded but a later page failed                                        | Success with the reviews collected so far, plus `stoppedEarly: <code>` |

## No substitute data

The app always calls SerpApi. It never falls back to sample, cached, or hard-coded reviews when ingestion fails. A failure is reported as a failure. The JSON files in `apps/api/test/fixtures/serpapi/` are used only by tests.

## Secrets

`SERPAPI_API_KEY` is server-side only. SerpApi takes the key as a query parameter, so the request URL is never logged, thrown, or returned. Logs carry only the page number, HTTP status, and outcome code. A unit test checks this.

## Re-recording fixtures

To capture a real SerpApi response (this uses one search from your key):

```bash
cd apps/api
npm run record:fixture -- "https://www.google.com/maps/place/..." my-place-page-1.json
```

The script prints the place, the review count, and whether there is a next page. It saves the response with every key-bearing URL replaced by `[scrubbed]`, and refuses to save if the key still appears anywhere. Before committing, check the file yourself for `api_key`.
