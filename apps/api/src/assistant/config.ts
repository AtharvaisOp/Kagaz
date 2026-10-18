export interface AssistantConfig {
  readonly enabled: boolean;
  readonly unavailableReason: string;
  readonly projectId: string;
  readonly dailyBudgetMicroUsd: number;
  readonly allowLocalHttp: boolean;
  readonly renderProxy: boolean;
}

export function readAssistantConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AssistantConfig {
  const projectId = environment.FIREBASE_PROJECT_ID?.trim() ?? '';
  const budget = Number(environment.ASSISTANT_DAILY_BUDGET_USD ?? '0');
  const validBudget = Number.isFinite(budget) && budget > 0 && budget <= 3;
  const productionEmulators =
    environment.NODE_ENV === 'production' &&
    Boolean(
      environment.FIREBASE_AUTH_EMULATOR_HOST ||
      environment.FIRESTORE_EMULATOR_HOST,
    );
  const reason =
    environment.ASSISTANT_ENABLED !== 'true'
      ? 'AI Chat is disabled until the live security checks are complete.'
      : environment.ASSISTANT_BUDGET_CONFIRMED !== 'true' || !validBudget
        ? 'The owner-approved daily budget is not enabled.'
        : !projectId
          ? 'Firebase authentication is not configured.'
          : !environment.GROQ_API_KEY?.trim()
            ? 'The AI provider is not configured.'
            : productionEmulators
              ? 'Production AI Chat cannot use Firebase emulators.'
              : '';
  return {
    enabled: !reason,
    unavailableReason: reason,
    projectId,
    dailyBudgetMicroUsd: validBudget ? Math.floor(budget * 1_000_000) : 0,
    allowLocalHttp:
      environment.NODE_ENV !== 'production' &&
      environment.ASSISTANT_ALLOW_LOCAL_HTTP === 'true',
    renderProxy: environment.RENDER === 'true',
  };
}
