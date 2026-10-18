import { describe, expect, it } from 'vitest';
import {
  approveReviewedContext,
  belongsToReviewedContext,
  reviewContext,
} from './consent';
import type { AssistantAnswerResponse } from '@kagaz/shared-types';
import type { WorkspacePage } from '../../pdf-workspace/model/types';
import { sourcePageKey, type RetrievalResult } from '../retrieval/index';

const pages: readonly WorkspacePage[] = [
  {
    id: 'page-a',
    sourceDocumentId: 'never-share-this-filename.pdf',
    sourcePageIndex: 0,
    rotationDelta: 0,
  },
];
const result: RetrievalResult = {
  id: 'passage-a',
  pageId: 'page-a',
  sourcePageKey: sourcePageKey(pages[0]!),
  provenance: 'source-pdf',
  chunkIndex: 0,
  excerpt: 'Payment is due within thirty days.',
  matchReason: 'matched',
  matchedTerms: ['payment'],
  score: 1,
};
const input = {
  question: 'When is payment due?',
  selectedPassageIds: ['passage-a'],
  results: [result],
  pages,
  blockedSourcePages: new Set<string>(),
};
const review = reviewContext(input, 'revision-1')!;
const request = approveReviewedContext(
  review,
  review,
  '6b7b619a-7603-448e-a168-cbcd9f1a89c4',
  '2026-10-19T00:00:00.000Z',
)!;
const usage = {
  dailyLimit: 5 as const,
  remaining: 4,
  available: true,
  active: false,
  resetAt: '2026-10-20T00:00:00.000Z',
};
const answer: AssistantAnswerResponse = {
  requestId: request.requestId,
  answer: {
    status: 'answered',
    text: 'Within thirty days.',
    citations: ['passage-a'],
  },
  usage,
};

describe('per-request AI passage consent', () => {
  it('builds a review without approval and copies the exact reviewed context on deliberate approval', () => {
    expect(review).not.toHaveProperty('consent');
    expect(request.context).toBe(review.context);
    expect(request.consent).toEqual({
      approved: true,
      reviewedAt: '2026-10-19T00:00:00.000Z',
    });
    expect(Object.keys(request)).toEqual(['requestId', 'consent', 'context']);
    expect(JSON.stringify(request)).not.toContain('never-share-this-filename');
    expect(JSON.stringify(request)).not.toContain('sourcePageKey');
  });

  it.each([
    'page order changed',
    'committed form changed',
    'index generation changed',
    'Start Over',
    'redaction added',
  ])('rejects stale approval when %s', (revision) => {
    expect(
      approveReviewedContext(
        review,
        reviewContext(input, revision),
        request.requestId,
        request.consent.reviewedAt,
      ),
    ).toBeNull();
  });

  it('rejects a changed question, passage text or selected passages even with an unchanged revision', () => {
    for (const next of [
      { ...input, question: 'Summarize payment obligations' },
      {
        ...input,
        results: [{ ...result, excerpt: 'Payment is due within sixty days.' }],
      },
      { ...input, selectedPassageIds: [] },
    ])
      expect(
        approveReviewedContext(
          review,
          reviewContext(next, review.revision),
          request.requestId,
          request.consent.reviewedAt,
        ),
      ).toBeNull();
  });

  it('rejects hidden pending-redaction text and deleted workspace citations', () => {
    expect(
      reviewContext(
        { ...input, blockedSourcePages: new Set([result.sourcePageKey]) },
        'redacted',
      ),
    ).toBeNull();
    expect(reviewContext({ ...input, pages: [] }, 'deleted')).toBeNull();
  });

  it('shares only selected passages and respects the existing 8,000-character review bound', () => {
    const context = reviewContext(
      {
        ...input,
        results: [
          { ...result, excerpt: 'a'.repeat(10_000) },
          {
            ...result,
            id: 'not-selected',
            excerpt: 'private unselected passage',
          },
        ],
      },
      'revision',
    )!.context;
    expect(context.contextCharacters).toBe(8_000);
    expect(context.passages[0]?.text.length).toBe(8_000);
    expect(context.passages).toHaveLength(1);
    expect(JSON.stringify(context)).not.toContain('private unselected passage');
  });

  it('accepts owned citations and rejects invented citations, wrong requests and uncited conclusions', () => {
    expect(belongsToReviewedContext(answer, request)).toBe(true);
    expect(
      belongsToReviewedContext(
        { ...answer, answer: { ...answer.answer, status: 'refused' } },
        request,
      ),
    ).toBe(false);
    expect(
      belongsToReviewedContext(
        {
          ...answer,
          answer: { ...answer.answer, status: 'insufficient-evidence' },
        },
        request,
      ),
    ).toBe(false);
    expect(
      belongsToReviewedContext(
        { ...answer, requestId: 'another-request' },
        request,
      ),
    ).toBe(false);
    expect(
      belongsToReviewedContext(
        {
          ...answer,
          answer: { ...answer.answer, citations: ['fabricated-page'] },
        },
        request,
      ),
    ).toBe(false);
    expect(
      belongsToReviewedContext(
        { ...answer, answer: { ...answer.answer, citations: [] } },
        request,
      ),
    ).toBe(false);
    expect(
      belongsToReviewedContext(
        {
          ...answer,
          answer: {
            status: 'insufficient-evidence',
            text: 'No deadline is present in these excerpts.',
            citations: [],
          },
        },
        request,
      ),
    ).toBe(true);
  });
});
