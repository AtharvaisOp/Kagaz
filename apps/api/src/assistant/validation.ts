import type { AssistantAnswerRequest } from '@kagaz/shared-types';
import { AssistantError } from './errors.js';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: readonly string[]) {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    !value.includes(String.fromCharCode(0))
  );
}

function validPayload(
  value: unknown,
  now: number,
): value is AssistantAnswerRequest {
  if (
    !object(value) ||
    !keys(value, ['requestId', 'consent', 'context']) ||
    typeof value.requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.requestId,
    )
  )
    return false;
  const consent = value.consent;
  if (
    !object(consent) ||
    !keys(consent, ['approved', 'reviewedAt']) ||
    consent.approved !== true ||
    typeof consent.reviewedAt !== 'string'
  )
    return false;
  const reviewed = Date.parse(consent.reviewedAt);
  // Consent is for this request and expires after five minutes; tolerate 30s clock skew.
  if (
    !Number.isFinite(reviewed) ||
    reviewed > now + 30_000 ||
    now - reviewed > 300_000
  )
    return false;
  const context = value.context;
  if (
    !object(context) ||
    !keys(context, [
      'question',
      'selectedPassageIds',
      'passages',
      'contextCharacters',
      'documentTextTrust',
      'privacyDisclosure',
    ]) ||
    !text(context.question, 400) ||
    !text(context.privacyDisclosure, 1_000) ||
    context.documentTextTrust !== 'untrusted_document_data' ||
    !Array.isArray(context.selectedPassageIds) ||
    !Array.isArray(context.passages) ||
    context.passages.length < 1 ||
    context.passages.length > 5 ||
    context.passages.length !== context.selectedPassageIds.length
  )
    return false;
  let characters = 0;
  const ids = new Set<string>();
  for (let index = 0; index < context.passages.length; index += 1) {
    const passage: unknown = context.passages[index];
    if (
      !object(passage) ||
      !keys(passage, ['passageId', 'text', 'citation']) ||
      !text(passage.passageId, 160) ||
      !text(passage.text, 8_000) ||
      context.selectedPassageIds[index] !== passage.passageId ||
      ids.has(passage.passageId)
    )
      return false;
    const citation = passage.citation;
    if (
      !object(citation) ||
      !keys(citation, ['workspacePageId', 'pageNumber']) ||
      !text(citation.workspacePageId, 160) ||
      !Number.isSafeInteger(citation.pageNumber) ||
      Number(citation.pageNumber) < 1 ||
      Number(citation.pageNumber) > 1_500
    )
      return false;
    characters += passage.text.length;
    ids.add(passage.passageId);
  }
  return characters <= 8_000 && characters === context.contextCharacters;
}

export function validateAnswerRequest(
  value: unknown,
  now = Date.now(),
): AssistantAnswerRequest {
  if (!validPayload(value, now))
    throw new AssistantError(
      'invalid-request',
      400,
      'Review a question of up to 400 characters and one to five current passages (8,000 characters total), then approve sharing again.',
    );
  return value;
}
