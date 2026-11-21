import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger.js';
import { QA_OUTCOMES, type QaModelRequest } from '../../modules/qa/qa-model.js';
import { createGeminiQaModel, GeminiError, parseGeminiResponse } from './gemini-qa-model.js';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../test/fixtures/gemini/${name}`, import.meta.url), 'utf8'),
  );

const API_KEY = 'AIza-test-key-not-real';

const request: QaModelRequest = {
  systemPrompt: 'You are ReviewLens. Use only the supplied reviews.',
  target: { name: 'Copper Kettle Cafe', platform: 'GOOGLE_MAPS' },
  reviews: [
    {
      id: 'r1',
      rating: 5,
      text: 'The oat latte is excellent.',
      reviewerName: 'Sam',
      publishedAt: '2026-10-01',
    },
    { id: 'r2', rating: 2, text: 'Wi-Fi drops often.', reviewerName: null, publishedAt: null },
  ],
  availableReviewCount: 2,
  question: 'What do customers like?',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(respond: () => Promise<Response>) {
  const fetchFn = vi.fn<typeof fetch>(respond);
  const warn = vi.fn();
  const model = createGeminiQaModel({
    apiKey: API_KEY,
    model: 'gemini-3.8-flash',
    timeoutMs: 5_000,
    logger: { warn } as unknown as Logger,
    fetchFn,
  });
  const sent = () => {
    const [url, init] = fetchFn.mock.calls[0]!;
    return { url: String(url), init: init!, body: JSON.parse(String(init!.body)) };
  };
  return { model, fetchFn, warn, sent };
}

async function captureGeminiError(promise: Promise<unknown>): Promise<GeminiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GeminiError) return error;
    throw error;
  }
  throw new Error('expected a GeminiError');
}

describe('createGeminiQaModel', () => {
  it('calls generateContent for the configured model with the key in a header, not the URL', async () => {
    const { model, sent } = setup(async () => jsonResponse(200, fixture('answer-success.json')));

    await model.complete(request);

    const { url, init } = sent();
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    expect(url).not.toContain(API_KEY);
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe(API_KEY);
    expect(init.method).toBe('POST');
  });

  it('sends the system prompt as system instructions and the reviews plus question as the user message', async () => {
    const { model, sent } = setup(async () => jsonResponse(200, fixture('answer-success.json')));

    await model.complete(request);

    const { body } = sent();
    expect(body.systemInstruction.parts[0].text).toBe(request.systemPrompt);
    const userText: string = body.contents[0].parts[0].text;
    expect(body.contents[0].role).toBe('user');
    expect(userText).toContain('The oat latte is excellent.');
    expect(userText).toContain('Wi-Fi drops often.');
    expect(userText.trim().endsWith('QUESTION: What do customers like?')).toBe(true);
  });

  it('asks for low thinking by default, so answers come back quickly', async () => {
    const { model, sent } = setup(async () => jsonResponse(200, fixture('answer-success.json')));

    await model.complete(request);

    expect(sent().body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('omits the thinking setting when it is turned off, for Gemini 2.5 models', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, fixture('answer-success.json')),
    );
    const model = createGeminiQaModel({
      apiKey: API_KEY,
      model: 'gemini-2.5-flash',
      timeoutMs: 5_000,
      logger: { warn: vi.fn() } as unknown as Logger,
      thinkingLevel: 'off',
      fetchFn,
    });

    await model.complete(request);

    const body = JSON.parse(String(fetchFn.mock.calls[0]![1]!.body));
    expect(body.generationConfig).not.toHaveProperty('thinkingConfig');
  });

  it('asks for JSON constrained to the allowed outcomes, at a low temperature', async () => {
    const { model, sent } = setup(async () => jsonResponse(200, fixture('answer-success.json')));

    await model.complete(request);

    const { generationConfig } = sent().body;
    expect(generationConfig.responseMimeType).toBe('application/json');
    expect(generationConfig.responseSchema.properties.outcome.enum).toEqual([...QA_OUTCOMES]);
    expect(generationConfig.responseSchema.required).toEqual(['outcome', 'answer']);
    expect(generationConfig.temperature).toBeLessThanOrEqual(0.3);
  });

  it('returns the parsed answer from a successful response', async () => {
    const { model } = setup(async () => jsonResponse(200, fixture('answer-success.json')));

    await expect(model.complete(request)).resolves.toEqual({
      outcome: 'grounded_answer',
      answer:
        'Several reviewers praise the oat latte, while 2 of 3 reviews complain that the Wi-Fi drops often.',
    });
  });

  it('reports a rate-limited request without exposing the key', async () => {
    const { model, warn } = setup(async () =>
      jsonResponse(429, fixture('error-rate-limited.json')),
    );

    const error = await captureGeminiError(model.complete(request));

    expect(error).toMatchObject({ kind: 'http', status: 429 });
    expect(error.message).not.toContain(API_KEY);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 429, providerStatus: 'RESOURCE_EXHAUSTED' }),
      'Gemini returned an error',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(API_KEY);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('oat latte');
  });

  it('reports a timeout distinctly from a network failure', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    const timedOut = setup(async () => {
      throw timeout;
    });
    const offline = setup(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(captureGeminiError(timedOut.model.complete(request))).resolves.toMatchObject({
      kind: 'timeout',
    });
    await expect(captureGeminiError(offline.model.complete(request))).resolves.toMatchObject({
      kind: 'network',
    });
  });

  it('treats a blocked prompt as a failure', async () => {
    const { model } = setup(async () => jsonResponse(200, fixture('prompt-blocked.json')));

    await expect(captureGeminiError(model.complete(request))).resolves.toMatchObject({
      kind: 'blocked',
    });
  });
});

describe('parseGeminiResponse', () => {
  const withText = (text: string, finishReason = 'STOP') => ({
    candidates: [{ content: { parts: [{ text }] }, finishReason }],
  });

  it('accepts JSON wrapped in a Markdown code fence', () => {
    expect(
      parseGeminiResponse(
        withText('```json\n{"outcome":"insufficient_evidence","answer":"No."}\n```'),
      ),
    ).toEqual({
      outcome: 'insufficient_evidence',
      answer: 'No.',
    });
  });

  it.each([
    ['no candidates', {}],
    ['an empty answer', withText('   ')],
    ['a response stopped for safety', { candidates: [{ finishReason: 'SAFETY' }] }],
    ['a non-JSON body', null],
  ])('rejects %s', (_label, body) => {
    expect(() => parseGeminiResponse(body)).toThrow(GeminiError);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseGeminiResponse(withText('The latte is great.'))).toThrow(
      expect.objectContaining({ kind: 'invalid_json' }),
    );
  });
});

describe('retrying temporary Gemini failures', () => {
  function retryingModel(statuses: number[], timeoutMs = 30_000) {
    const responses = statuses.map((status) =>
      status === 200
        ? jsonResponse(200, fixture('answer-success.json'))
        : jsonResponse(status, { error: { code: status, status: 'UNAVAILABLE' } }),
    );
    const fetchFn = vi.fn<typeof fetch>(async () => responses.shift()!);
    const sleep = vi.fn(async (_ms: number) => {});
    const model = createGeminiQaModel({
      apiKey: API_KEY,
      model: 'gemini-3.8-flash',
      timeoutMs,
      logger: { warn: vi.fn() } as unknown as Logger,
      fetchFn,
      sleep,
    });
    return { model, fetchFn, sleep };
  }

  it('retries an overloaded model (503) and returns the answer once it recovers', async () => {
    const { model, fetchFn, sleep } = retryingModel([503, 200]);

    await expect(model.complete(request)).resolves.toMatchObject({ outcome: 'grounded_answer' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it('gives up after two retries and reports the failure', async () => {
    const { model, fetchFn, sleep } = retryingModel([503, 500, 503]);

    await expect(captureGeminiError(model.complete(request))).resolves.toMatchObject({
      kind: 'http',
      status: 503,
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000]);
  });

  it('never retries a rate limit (429), which would only use more free-tier quota', async () => {
    const { model, fetchFn, sleep } = retryingModel([429, 200]);

    await expect(captureGeminiError(model.complete(request))).resolves.toMatchObject({
      status: 429,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('stops retrying when the next wait would pass the request time limit', async () => {
    const { model, fetchFn } = retryingModel([503, 503, 200], 1_500);

    await expect(captureGeminiError(model.complete(request))).resolves.toMatchObject({
      status: 503,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
