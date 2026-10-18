import { describe, expect, it } from 'vitest';

import type { WorkspacePage } from '../../pdf-workspace/model/types';
import { sourcePageKey, type RetrievalResult } from './index';
import { buildExplicitContextShareRequest } from './contextSharing';

const pages: readonly WorkspacePage[] = [
  {
    id: 'page-a',
    sourceDocumentId: 'source-a',
    sourcePageIndex: 0,
    rotationDelta: 0,
  },
  {
    id: 'page-b',
    sourceDocumentId: 'source-a',
    sourcePageIndex: 1,
    rotationDelta: 0,
  },
];

const result: RetrievalResult = {
  id: 'page-b:0',
  pageId: 'page-b',
  sourcePageKey: sourcePageKey(pages[1]!),
  provenance: 'source-pdf',
  chunkIndex: 0,
  excerpt:
    'The selected source passage says payment is due within thirty days.',
  matchReason: 'All 2 search terms matched',
  matchedTerms: ['payment', 'days'],
  score: 2.4,
};

describe('future explicit context-sharing contract', () => {
  it('requires explicit consent and selected passages', () => {
    expect(
      buildExplicitContextShareRequest({
        explicitConsent: false,
        question: 'When is payment due?',
        selectedPassageIds: [result.id],
        results: [result],
        pages,
        blockedSourcePages: new Set(),
      }),
    ).toBeNull();
  });

  it('builds a bounded, cited request and marks document text as untrusted data', () => {
    const request = buildExplicitContextShareRequest({
      explicitConsent: true,
      question: 'When is payment due?',
      selectedPassageIds: [result.id],
      results: [result],
      pages: [pages[1]!, pages[0]!],
      blockedSourcePages: new Set(),
    });
    expect(request).toMatchObject({
      question: 'When is payment due?',
      selectedPassageIds: [result.id],
      passages: [
        {
          passageId: result.id,
          text: result.excerpt,
          citation: { workspacePageId: 'page-b', pageNumber: 1 },
        },
      ],
      documentTextTrust: 'untrusted_document_data',
    });
    expect(request?.contextCharacters).toBe(result.excerpt.length);
    expect(request?.privacyDisclosure).toContain('leave this browser');
  });

  it('rejects deleted, stale, redacted, excessive, and empty context selections', () => {
    const base = {
      explicitConsent: true,
      question: 'Summarize this clause',
      selectedPassageIds: [result.id],
      results: [result],
      pages,
      blockedSourcePages: new Set([result.sourcePageKey]),
    };
    expect(buildExplicitContextShareRequest(base)).toBeNull();
    expect(
      buildExplicitContextShareRequest({
        ...base,
        blockedSourcePages: new Set(),
        pages: [pages[0]!],
      }),
    ).toBeNull();
    expect(
      buildExplicitContextShareRequest({
        ...base,
        blockedSourcePages: new Set(),
        selectedPassageIds: [],
      }),
    ).toBeNull();
  });
});
