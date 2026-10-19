import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistantAnswerRequest } from '@kagaz/shared-types';
import {
  AssistantClientError,
  fetchAssistantUsage,
  generateAssistantAnswer,
  readAnswer,
  readUsage,
} from './assistantClient';

const usage = {
  dailyLimit: 5,
  remaining: 4,
  available: true,
  active: false,
  resetAt: '2026-10-20T00:00:00.000Z',
};
const request: AssistantAnswerRequest = {
  requestId: '6b7b619a-7603-448e-a168-cbcd9f1a89c4',
  consent: { approved: true, reviewedAt: '2026-10-19T00:00:00.000Z' },
  context: {
    question: 'When is payment due?',
    selectedPassageIds: ['p1'],
    passages: [
      {
        passageId: 'p1',
        text: 'Payment is due in 30 days.',
        citation: { workspacePageId: 'page1', pageNumber: 1 },
      },
    ],
    contextCharacters: 26,
    documentTextTrust: 'untrusted_document_data',
    privacyDisclosure: 'Only these passages leave this browser.',
  },
};
const answer = {
  requestId: request.requestId,
  answer: { status: 'answered', text: 'In 30 days.', citations: ['p1'] },
  usage,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('authenticated AI network boundary', () => {
  it('explains shared Free Plan exhaustion without suggesting a paid fallback', () => {
    const error = new AssistantClientError('provider-rate-limited');
    expect(error.message).toContain('shared Groq Free Plan allowance');
    expect(error.message).toContain('will not switch to a paid service');
    expect(new AssistantClientError('free-limit-exhausted').message).toContain(
      'Local editing and Ask PDF remain available',
    );
  });

  it('transmits exactly the approved JSON without PDF bytes, history, filenames, cookies or a client UID', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:5173' } });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(answer), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      generateAssistantAnswer(
        request,
        'firebase-id-token',
        new AbortController().signal,
      ),
    ).resolves.toEqual(answer);
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/assistant/answer');
    expect(options.body).toBe(JSON.stringify(request));
    expect(options.headers).toEqual({
      Authorization: 'Bearer firebase-id-token',
      'Content-Type': 'application/json',
    });
    expect(options).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (typeof options.body !== 'string')
      throw new Error('Expected a JSON body');
    expect(JSON.parse(options.body)).not.toHaveProperty('uid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches only the server usage status and never synthesizes quota', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:5173' } });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(usage)));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchAssistantUsage('token', new AbortController().signal),
    ).resolves.toEqual(usage);
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/assistant/usage');
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
  });

  it.each([0, -1, 6, 1.5, '5'])(
    'rejects untrusted quota shape with dailyLimit %s',
    (dailyLimit) => {
      expect(readUsage({ ...usage, dailyLimit })).toBeNull();
    },
  );

  it.each([-1, 6, 0.5, '4', null])(
    'rejects untrusted remaining count %s',
    (remaining) => {
      expect(readUsage({ ...usage, remaining })).toBeNull();
    },
  );

  it('rejects malformed, oversized, duplicated or forged answer citations before display', () => {
    for (const value of [
      null,
      { ...answer, usage: {} },
      { ...answer, requestId: 'other' },
      { ...answer, answer: { ...answer.answer, text: '' } },
      { ...answer, answer: { ...answer.answer, text: 'a'.repeat(2_401) } },
      { ...answer, answer: { ...answer.answer, citations: ['p1', 'p1'] } },
      { ...answer, answer: { ...answer.answer, citations: ['p99'] } },
      { ...answer, answer: { ...answer.answer, status: 'run-command' } },
      { ...answer, answer: { ...answer.answer, status: ['answered'] } },
      {
        ...answer,
        answer: { ...answer.answer, status: { toString: () => 'answered' } },
      },
    ])
      expect(readAnswer(value, request)).toBeNull();
  });

  it('does not automatically retry a possibly billed provider failure or expose its raw response', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:5173' } });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'provider-timeout',
            message: 'private prompt or infrastructure data',
          },
        }),
        { status: 504 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      generateAssistantAnswer(request, 'token', new AbortController().signal),
    ).rejects.toThrow('A generation attempt may have been counted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects insecure remote origins before transmitting a bearer token', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:5173' } });
    vi.stubEnv('VITE_API_URL', 'http://example.com');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      generateAssistantAnswer(request, 'token', new AbortController().signal),
    ).rejects.toThrow('HTTPS');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
