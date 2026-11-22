/**
 * Manual check that GEMINI_API_KEY and LLM_MODEL work. Sends one small,
 * made-up review set through the real Gemini adapter and prints the result.
 * Costs three free-tier requests. Never run in CI.
 * npm run llm:smoke -w apps/api
 */
import { existsSync } from 'node:fs';
import { createGeminiQaModel } from '../src/adapters/gemini/gemini-qa-model.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { buildSystemPrompt } from '../src/modules/qa/system-prompt.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const env = loadEnv(process.env);
const model = createGeminiQaModel({
  apiKey: env.GEMINI_API_KEY,
  model: env.LLM_MODEL,
  timeoutMs: env.LLM_TIMEOUT_MS,
  thinkingLevel: env.LLM_THINKING_LEVEL,
  logger: createLogger('warn'),
});

const target = { name: 'Smoke Test Cafe', platform: 'GOOGLE_MAPS' };
const reviews = [
  {
    id: 'r1',
    rating: 5,
    text: 'Great coffee and very friendly staff.',
    reviewerName: 'A',
    publishedAt: null,
  },
  {
    id: 'r2',
    rating: 2,
    text: 'Coffee was good but the wait was over 20 minutes.',
    reviewerName: 'B',
    publishedAt: null,
  },
  {
    id: 'r3',
    rating: 4,
    text: 'Friendly staff, a bit slow at lunch.',
    reviewerName: 'C',
    publishedAt: null,
  },
];

// Compare an evidenced question with a relevant fact these synthetic reviews
// never establish. This is a live adapter check, not an automated model test.
for (const question of [
  'What do customers like?',
  'Do customers think the parking lot is safe at night?',
  'What is the capital of France?',
]) {
  const started = Date.now();
  const answer = await model.complete({
    systemPrompt: buildSystemPrompt(target),
    target,
    reviews,
    availableReviewCount: reviews.length,
    question,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(`\nQ: ${question} (${seconds} s)\n${JSON.stringify(answer, null, 2)}\n`);
}
