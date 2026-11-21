import type { Logger } from '../../lib/logger.js';
import { buildUserMessage } from '../../modules/qa/qa-message.js';
import {
  QA_OUTCOMES,
  type QaModel,
  type QaModelRequest,
  type QaModelResponse,
} from '../../modules/qa/qa-model.js';

/**
 * Gemini implementation of the Q&A model boundary. Uses the
 * generateContent REST endpoint directly, so no SDK dependency is needed.
 */

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Low temperature keeps outcomes and refusals consistent between runs. */
export const DEFAULT_TEMPERATURE = 0.2;

/**
 * Gemini 3 Flash models "think" before answering, at medium effort by default,
 * which can take long enough to hit the timeout. Summarizing supplied reviews
 * doesn't need deep reasoning, so ReviewLens asks for low thinking. Use "off"
 * for Gemini 2.5 models, which don't accept thinkingLevel.
 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'low';

/** Constrains the model to the `{ outcome, answer }` contract the service validates. */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    outcome: {
      type: 'STRING',
      enum: [...QA_OUTCOMES],
      description:
        'grounded_answer when the reviews support an answer; insufficient_evidence when the question is about these reviews but they do not contain enough information; out_of_scope_refusal for anything unrelated to these reviews or about another business, product, or platform.',
    },
    answer: {
      type: 'STRING',
      description: 'The answer, or a short explanation of the limitation or refusal, for the user.',
    },
  },
  required: ['outcome', 'answer'],
} as const;

export type GeminiErrorKind = 'timeout' | 'network' | 'http' | 'blocked' | 'empty' | 'invalid_json';

/** A Gemini failure. Messages never contain the API key or review content. */
export class GeminiError extends Error {
  constructor(
    readonly kind: GeminiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export interface GeminiQaModelConfig {
  apiKey: string;
  /** Model ID, e.g. gemini-3.6-flash. Configured with LLM_MODEL. */
  model: string;
  timeoutMs: number;
  logger: Logger;
  temperature?: number;
  thinkingLevel?: ThinkingLevel;
  fetchFn?: typeof fetch;
  /** Waits before each retry of a temporary Gemini failure. Defaults to 1 s, then 2 s. */
  retryDelaysMs?: readonly number[];
  /** Replaced in tests so retries don't really wait. */
  sleep?: (ms: number) => Promise<void>;
}

export function buildGeminiRequestBody(
  request: QaModelRequest,
  temperature = DEFAULT_TEMPERATURE,
  thinkingLevel: ThinkingLevel = DEFAULT_THINKING_LEVEL,
) {
  return {
    systemInstruction: { parts: [{ text: request.systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: buildUserMessage(request) }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      ...(thinkingLevel === 'off' ? {} : { thinkingConfig: { thinkingLevel } }),
    },
  };
}

interface GeminiResponse {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
}

/**
 * Extracts the JSON answer from a generateContent response. The Q&A service
 * validates its shape; this only turns provider-specific failures into errors.
 */
export function parseGeminiResponse(body: unknown): QaModelResponse {
  const response = (body ?? {}) as GeminiResponse;
  if (response.promptFeedback?.blockReason) {
    throw new GeminiError(
      'blocked',
      `Gemini blocked the prompt (${response.promptFeedback.blockReason}).`,
    );
  }
  const candidate = response.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim();
  if (!text) {
    const reason = candidate?.finishReason ?? 'no candidates';
    throw new GeminiError(
      reason === 'SAFETY' ? 'blocked' : 'empty',
      `Gemini returned no answer (${reason}).`,
    );
  }
  // JSON mode returns bare JSON; tolerate a Markdown code fence just in case.
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(json) as QaModelResponse;
  } catch {
    throw new GeminiError('invalid_json', 'Gemini returned text that is not JSON.');
  }
}

/**
 * Temporary server-side failures worth retrying: 503 means the model is
 * overloaded, 500 an internal error. 429 (rate limit) is not retried, because on
 * the free tier a retry only uses more of the quota.
 */
const RETRYABLE_STATUSES = new Set([500, 503]);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createGeminiQaModel({
  apiKey,
  model,
  timeoutMs,
  logger,
  temperature = DEFAULT_TEMPERATURE,
  thinkingLevel = DEFAULT_THINKING_LEVEL,
  fetchFn = (input, init) => fetch(input, init),
  retryDelaysMs = [1_000, 2_000],
  sleep = wait,
}: GeminiQaModelConfig): QaModel {
  // The key goes in a header, never the URL, so it can't end up in logs.
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`;

  async function attempt(body: string, signal: AbortSignal): Promise<QaModelResponse> {
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      logger.warn({ model, kind: timedOut ? 'timeout' : 'network' }, 'Gemini request failed');
      throw timedOut
        ? new GeminiError('timeout', `Gemini did not respond within ${timeoutMs} ms.`)
        : new GeminiError('network', 'Could not reach Gemini.');
    }

    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // e.g. RESOURCE_EXHAUSTED for free-tier rate limits; never log the request body.
      const providerStatus = (json as { error?: { status?: string } } | null)?.error?.status;
      logger.warn({ model, status: response.status, providerStatus }, 'Gemini returned an error');
      throw new GeminiError('http', `Gemini returned HTTP ${response.status}.`, response.status);
    }
    return parseGeminiResponse(json);
  }

  return {
    async complete(request) {
      const body = JSON.stringify(buildGeminiRequestBody(request, temperature, thinkingLevel));
      // One time limit covers every attempt, including the waits between them.
      const signal = AbortSignal.timeout(timeoutMs);
      const deadline = Date.now() + timeoutMs;

      for (let retry = 0; ; retry += 1) {
        try {
          return await attempt(body, signal);
        } catch (error) {
          const delay = retryDelaysMs[retry];
          const retryable =
            error instanceof GeminiError &&
            error.kind === 'http' &&
            RETRYABLE_STATUSES.has(error.status ?? 0);
          if (!retryable || delay === undefined || Date.now() + delay >= deadline) throw error;
          logger.warn({ model, status: error.status, retry: retry + 1 }, 'Retrying Gemini request');
          await sleep(delay);
        }
      }
    },
  };
}
