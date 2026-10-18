import type { WorkspacePage } from '../../pdf-workspace/model/types';
import type { RetrievalResult } from './index';

export const REMOTE_CONTEXT_LIMITS = Object.freeze({
  maxPassages: 5,
  maxCharacters: 8_000,
});

export interface ExplicitContextPassage {
  readonly passageId: string;
  /** Document text is untrusted data and must never be treated as instructions. */
  readonly text: string;
  readonly citation: {
    readonly workspacePageId: string;
    readonly pageNumber: number;
  };
}

export interface ExplicitContextShareRequest {
  readonly question: string;
  readonly selectedPassageIds: readonly string[];
  readonly passages: readonly ExplicitContextPassage[];
  readonly contextCharacters: number;
  readonly documentTextTrust: 'untrusted_document_data';
  readonly privacyDisclosure: string;
}

export interface ExplicitContextShareInput {
  readonly explicitConsent: boolean;
  readonly question: string;
  readonly selectedPassageIds: readonly string[];
  readonly results: readonly RetrievalResult[];
  readonly pages: readonly WorkspacePage[];
  readonly blockedSourcePages: ReadonlySet<string>;
}

/**
 * Builds a bounded context object only from passages explicitly selected by a
 * future user-controlled UI. This function does not transmit or persist it.
 */
export function buildExplicitContextShareRequest(
  input: ExplicitContextShareInput,
): ExplicitContextShareRequest | null {
  const {
    explicitConsent,
    question,
    selectedPassageIds,
    results,
    pages,
    blockedSourcePages,
  } = input;
  const trimmedQuestion = question.trim();
  const uniqueIds = [...new Set(selectedPassageIds)];
  if (
    !explicitConsent ||
    !trimmedQuestion ||
    trimmedQuestion.length > 400 ||
    uniqueIds.length === 0 ||
    uniqueIds.length > REMOTE_CONTEXT_LIMITS.maxPassages
  ) {
    return null;
  }

  const currentPageNumbers = new Map(
    pages.map((page, index) => [page.id, index + 1]),
  );
  const selected: ExplicitContextPassage[] = [];
  let remainingCharacters = REMOTE_CONTEXT_LIMITS.maxCharacters;

  for (const id of uniqueIds) {
    const result = results.find((candidate) => candidate.id === id);
    const pageNumber = result
      ? currentPageNumbers.get(result.pageId)
      : undefined;
    if (
      !result ||
      pageNumber === undefined ||
      blockedSourcePages.has(result.sourcePageKey)
    ) {
      return null;
    }

    const text = result.excerpt.slice(0, remainingCharacters);
    if (!text) return null;
    selected.push({
      passageId: result.id,
      text,
      citation: { workspacePageId: result.pageId, pageNumber },
    });
    remainingCharacters -= text.length;
    if (remainingCharacters <= 0 && selected.length < uniqueIds.length)
      return null;
  }

  const contextCharacters = selected.reduce(
    (total, passage) => total + passage.text.length,
    0,
  );
  return {
    question: trimmedQuestion,
    selectedPassageIds: selected.map((passage) => passage.passageId),
    passages: selected,
    contextCharacters,
    documentTextTrust: 'untrusted_document_data',
    privacyDisclosure:
      'If a future remote answer is enabled, this question and only these explicitly selected passages would leave this browser for the configured model provider.',
  };
}
