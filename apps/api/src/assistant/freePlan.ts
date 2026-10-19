/** Application caps stay well below Groq's published GPT-OSS 20B Free Plan limits. */
export const GROQ_FREE_PLAN_LIMITS = Object.freeze({
  requestsPerMinute: 5,
  requestsPerDay: 100,
  tokensPerMinute: 6_000,
  tokensPerDay: 20_000,
  maxTokensPerRequest: 6_000,
});

export type FreePlanLimits = typeof GROQ_FREE_PLAN_LIMITS;
