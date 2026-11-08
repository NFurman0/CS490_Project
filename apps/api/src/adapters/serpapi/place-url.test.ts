import { describe, expect, it, vi } from 'vitest';
import { resolvePlaceRef } from './place-url.js';

const DATA_ID = '0x89c25a197c06b7cb:0x40a06c78f79e5de6';
const PLACE_URL = `https://www.google.com/maps/place/Corner+Slice/@40.73,-74.17,17z/data=!3m1!4b1!4m6!3m5!1s${DATA_ID}!8m2!3d40.73!4d-74.17`;

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function resolveWith(url: string, fetchFn = vi.fn<typeof fetch>()) {
  return resolvePlaceRef(url, { fetchFn, timeoutMs: 1000 });
}

describe('resolvePlaceRef', () => {
  it('reads the data_id from a full place URL', async () => {
    await expect(resolveWith(PLACE_URL)).resolves.toEqual({ dataId: DATA_ID });
  });

  it('reads a percent-encoded data_id', async () => {
    const encoded = PLACE_URL.replace(`${DATA_ID}`, DATA_ID.replace(':', '%3A'));
    await expect(resolveWith(encoded)).resolves.toEqual({ dataId: DATA_ID });
  });

  it('skips the search term and reads the place data_id when the place was opened from a search', async () => {
    const url =
      'https://www.google.com/maps/place/Blank+Street/@40.5651238,-74.7132858,10z/data=!4m12!1m2!2m1!1sblank+street!3m8!1s0x89c2596c4887e2a3:0xddb2f8e53c1226bb!8m2!3d40.782894!4d-73.975184!9m1!1b1?entry=ttu';
    await expect(resolveWith(url)).resolves.toEqual({
      dataId: '0x89c2596c4887e2a3:0xddb2f8e53c1226bb',
    });
  });

  it('accepts country Google domains', async () => {
    const url = PLACE_URL.replace('www.google.com', 'www.google.co.uk');
    await expect(resolveWith(url)).resolves.toEqual({ dataId: DATA_ID });
  });

  it('reads a place_id from q=place_id:', async () => {
    const url = 'https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4';
    await expect(resolveWith(url)).resolves.toEqual({ placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4' });
  });

  it('reads a place_id from query_place_id', async () => {
    const url =
      'https://www.google.com/maps/search/?api=1&query=pizza&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4';
    await expect(resolveWith(url)).resolves.toEqual({ placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4' });
  });

  it('follows a maps.app.goo.gl short link to the place URL without fetching the place page', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(redirectTo(PLACE_URL));

    await expect(resolveWith('https://maps.app.goo.gl/AbC123', fetchFn)).resolves.toEqual({
      dataId: DATA_ID,
    });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('returns null when a short link does not redirect', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(resolveWith('https://maps.app.goo.gl/missing', fetchFn)).resolves.toBeNull();
  });

  it('returns null when a short link cannot be reached', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(resolveWith('https://maps.app.goo.gl/AbC123', fetchFn)).resolves.toBeNull();
  });

  it('gives up on a short link that redirects in a loop', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => redirectTo('https://maps.app.goo.gl/again'));
    await expect(resolveWith('https://maps.app.goo.gl/AbC123', fetchFn)).resolves.toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['a Maps search with no place', 'https://www.google.com/maps/search/pizza+near+me'],
    ['a Maps directions link', 'https://www.google.com/maps/dir/Newark/Hoboken'],
    ['a non-Maps Google page', `https://www.google.com/search?q=pizza&data=!1s${DATA_ID}`],
    ['a look-alike host', PLACE_URL.replace('www.google.com', 'google.com.evil.example')],
    ['another site', 'https://www.yelp.com/biz/corner-slice-newark'],
    ['a non-http scheme', `javascript:alert(1)//www.google.com/maps/place/x/data=!1s${DATA_ID}`],
    ['text that is not a URL', 'Corner Slice Pizzeria'],
  ])('returns null for %s without any network call', async (_label, url) => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(resolveWith(url, fetchFn)).resolves.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
