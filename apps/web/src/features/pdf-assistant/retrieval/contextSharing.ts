import type { WorkspacePage } from '../../pdf-workspace/model/types';
import type { RetrievalResult } from './index';
import type {
  ExplicitContextPassage,
  ExplicitContextShareRequest,
} from '@kagaz/shared-types';

export type {
  ExplicitContextPassage,
  ExplicitContextShareRequest,
} from '@kagaz/shared-types';

export const REMOTE_CONTEXT_LIMITS = Object.freeze({
  maxPassages: 5,
  maxCharacters: 8_000,
});

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
 * user-controlled review UI. This function does not transmit or persist it.
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
      'This question and only these explicitly selected passages will leave this browser for Kagaz’s server and Groq. Original PDF files, filenames and conversation history are not included.',
  };
}
