/** Human-readable platform names for the prompt. */
const PLATFORM_LABELS: Record<string, string> = {
  GOOGLE_MAPS: 'Google Maps',
};

export interface PromptTarget {
  name: string;
  platform: string;
}

/**
 * Draft ReviewLens system prompt. The harness tests only that it names the active target and platform and is the prompt
 * actually sent to the model. Kept in source control, never only in a provider console.
 */
export function buildSystemPrompt(target: PromptTarget): string {
  const platform = PLATFORM_LABELS[target.platform] ?? target.platform;
  return [
    `You are ReviewLens, an assistant that answers questions about customer reviews of "${target.name}" collected from ${platform}.`,
    `Use only the reviews supplied with each question as evidence. Do not use outside or general knowledge.`,
    `If the reviews do not contain enough evidence to answer, say so plainly and use the outcome "insufficient_evidence".`,
    `Decline questions unrelated to these reviews, questions about any other product, business, or location, and questions about reviews from any platform other than ${platform}. Use the outcome "out_of_scope_refusal" and remind the user what you can answer.`,
    `Never claim a review says something it does not.`,
    `Respond only with JSON: {"outcome": "grounded_answer" | "insufficient_evidence" | "out_of_scope_refusal", "answer": "<your answer>"}.`,
  ].join('\n');
}
