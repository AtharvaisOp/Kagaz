import type {
  AssistantAnswerRequest,
  AssistantAnswerResponse,
} from '@kagaz/shared-types';
import {
  buildExplicitContextShareRequest,
  type ExplicitContextShareInput,
  type ExplicitContextShareRequest,
} from '../retrieval/contextSharing';

export interface ContextReview {
  readonly revision: string;
  readonly context: ExplicitContextShareRequest;
}

/** A preview is not permission to send. Only the final approval builds a request. */
export function reviewContext(
  input: Omit<ExplicitContextShareInput, 'explicitConsent'>,
  revision: string,
): ContextReview | null {
  const context = buildExplicitContextShareRequest({
    ...input,
    explicitConsent: true,
  });
  return context ? { revision, context } : null;
}

export function approveReviewedContext(
  review: ContextReview,
  current: ContextReview | null,
  requestId: string,
  reviewedAt: string,
): AssistantAnswerRequest | null {
  if (
    !current ||
    review.revision !== current.revision ||
    JSON.stringify(review.context) !== JSON.stringify(current.context)
  )
    return null;
  return {
    requestId,
    consent: { approved: true, reviewedAt },
    context: review.context,
  };
}

export function belongsToReviewedContext(
  response: AssistantAnswerResponse,
  request: AssistantAnswerRequest,
): boolean {
  const ids = new Set(request.context.selectedPassageIds);
  return (
    response.requestId === request.requestId &&
    response.answer.citations.every((id) => ids.has(id)) &&
    (response.answer.status === 'answered'
      ? response.answer.citations.length > 0
      : response.answer.citations.length === 0)
  );
}
