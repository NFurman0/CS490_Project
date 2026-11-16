import type { QaModel, QaModelRequest, QaModelResponse } from '../../src/modules/qa/qa-model.js';

type Responder = (request: QaModelRequest) => QaModelResponse | Promise<QaModelResponse>;

const DEFAULT_RESPONSE: QaModelResponse = {
  outcome: 'grounded_answer',
  answer: 'Controlled test answer.',
};

/**
 * A fake LLM for deterministic Q&A tests. It never calls a provider and records every request so tests can assert exactly what the
 * application sent across the model boundary. Returns whatever response the
 * test chooses, including failures and malformed output.
 */
export function createFakeQaModel(initial: Responder = () => DEFAULT_RESPONSE) {
  const requests: QaModelRequest[] = [];
  let responder: Responder = initial;

  const model: QaModel = {
    async complete(request) {
      // Deep-copy so later mutations by the app can't change what the test inspects.
      requests.push(structuredClone(request));
      return responder(request);
    },
  };

  function lastRequest(): QaModelRequest {
    const request = requests.at(-1);
    if (!request) throw new Error('The fake model has not received any request.');
    return request;
  }

  return {
    /** Pass this to createQaService in place of a real provider adapter. */
    model,
    /** Every request received, oldest first. */
    requests,
    lastRequest,
    /** Review IDs supplied in the most recent request. */
    suppliedReviewIds: () => lastRequest().reviews.map((review) => review.id),
    /** Everything ever sent to the model as one string, for "phrase never appears" checks. */
    everythingSent: () => JSON.stringify(requests),
    /** Return a fixed response, or compute one from the request. */
    respondWith(response: QaModelResponse | Responder) {
      responder = typeof response === 'function' ? response : () => response;
    },
    /** Simulate a provider failure such as a timeout or outage. */
    failWith(error: Error) {
      responder = () => {
        throw error;
      };
    },
    /** Return output that does not match the response contract. */
    returnMalformed(value: unknown) {
      responder = () => value as QaModelResponse;
    },
  };
}

export type FakeQaModel = ReturnType<typeof createFakeQaModel>;
