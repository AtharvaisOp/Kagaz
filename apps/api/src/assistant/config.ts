import { GROQ_FREE_PLAN_LIMITS } from './freePlan.js';
import type { FreePlanLimits } from './freePlan.js';

export type AssistantProviderMode = 'disabled' | 'groq-free' | 'groq-paid';

export interface AssistantConfig {
  readonly enabled: boolean;
  readonly unavailableReason: string;
  readonly projectId: string;
  readonly providerMode: AssistantProviderMode;
  readonly freePlanLimits?: FreePlanLimits;
  readonly dailyBudgetMicroUsd: number;
  readonly allowLocalHttp: boolean;
  readonly renderProxy: boolean;
}

export function readAssistantConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AssistantConfig {
  const projectId = environment.FIREBASE_PROJECT_ID?.trim() ?? '';
  const modeValue = environment.ASSISTANT_PROVIDER_MODE;
  const providerMode: AssistantProviderMode =
    modeValue === 'groq-free' || modeValue === 'groq-paid'
      ? modeValue
      : 'disabled';
  const configuredBudget = environment.ASSISTANT_DAILY_BUDGET_USD;
  const budgetValue = configuredBudget ?? '0';
  const budget = Number(budgetValue);
  const validPaidBudget = Number.isFinite(budget) && budget > 0 && budget <= 3;
  const zeroFreeBudget = configuredBudget === '0' && budget === 0;
  const productionEmulators =
    environment.NODE_ENV === 'production' &&
    Boolean(
      environment.FIREBASE_AUTH_EMULATOR_HOST ||
      environment.FIRESTORE_EMULATOR_HOST,
    );

  let reason = '';
  if (environment.ASSISTANT_ENABLED !== 'true') {
    reason = 'AI Chat is disabled until the live security checks are complete.';
  } else if (providerMode === 'disabled') {
    reason = 'AI Chat requires an explicitly configured provider mode.';
  } else if (providerMode === 'groq-free') {
    if (environment.ASSISTANT_FREE_PLAN_CONFIRMED !== 'true')
      reason =
        'AI Chat is disabled until the owner confirms the Groq organization is on the Free Plan.';
    else if (!zeroFreeBudget)
      reason = 'Groq Free Plan mode requires a zero-dollar application budget.';
    else if (environment.ASSISTANT_BUDGET_CONFIRMED === 'true')
      reason = 'Paid budget confirmation cannot activate Groq Free Plan mode.';
  } else if (
    environment.ASSISTANT_BUDGET_CONFIRMED !== 'true' ||
    !validPaidBudget
  ) {
    reason = 'The owner-approved daily budget is not enabled.';
  }

  if (!reason && !projectId)
    reason = 'Firebase authentication is not configured.';
  if (!reason && !environment.GROQ_API_KEY?.trim())
    reason = 'The AI provider is not configured.';
  if (!reason && productionEmulators)
    reason = 'Production AI Chat cannot use Firebase emulators.';

  return {
    enabled: !reason,
    unavailableReason: reason,
    projectId,
    providerMode,
    ...(providerMode === 'groq-free'
      ? { freePlanLimits: GROQ_FREE_PLAN_LIMITS }
      : {}),
    dailyBudgetMicroUsd:
      providerMode === 'groq-paid' && validPaidBudget
        ? Math.floor(budget * 1_000_000)
        : 0,
    allowLocalHttp:
      environment.NODE_ENV !== 'production' &&
      environment.ASSISTANT_ALLOW_LOCAL_HTTP === 'true',
    renderProxy: environment.RENDER === 'true',
  };
}
