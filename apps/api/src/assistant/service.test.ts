import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { AssistantService } from './service.js';
import { AssistantLedger } from './ledger.js';
import { AssistantError } from './errors.js';
import { ProviderError } from './provider.js';
import type { AssistantProvider } from './provider.js';
import type { AssistantAnswerRequest } from '@kagaz/shared-types';

const NOW = Date.parse('2026-10-18T12:00:00Z');
function body(): AssistantAnswerRequest {
  return {
    requestId: randomUUID(),
    consent: { approved: true, reviewedAt: new Date(NOW).toISOString() },
    context: {
      question: 'When?',
      selectedPassageIds: ['p1'],
      passages: [
        {
          passageId: 'p1',
          text: 'Tomorrow.',
          citation: { workspacePageId: 'page1', pageNumber: 1 },
        },
      ],
      contextCharacters: 9,
      documentTextTrust: 'untrusted_document_data',
      privacyDisclosure: 'Share these passages and question.',
    },
  };
}
function fixture(
  options: {
    enabled?: boolean;
    localHttp?: boolean;
    renderProxy?: boolean;
  } = {},
) {
  const ledger = new AssistantLedger(
    { transaction: () => Promise.reject(new Error('Unexpected store access')) },
    3_000_000,
    6_530,
  );
  const reservation = {
    userKey: 'hashed-user',
    requestId: 'accepted',
    day: '2026-10-18',
    expiresAtMs: NOW + 120_000,
    reservedMicroUsd: 6_530,
  };
  const reserve = vi.spyOn(ledger, 'reserve').mockResolvedValue(reservation);
  const dispatch = vi.spyOn(ledger, 'markDispatched').mockResolvedValue();
  const settle = vi.spyOn(ledger, 'settle').mockResolvedValue(true);
  const usage = vi.spyOn(ledger, 'usage').mockResolvedValue({
    dailyLimit: 5,
    remaining: 4,
    resetAt: '2026-10-19T00:00:00Z',
    available: true,
    active: false,
  });
  const generate = vi.fn<AssistantProvider['generate']>().mockResolvedValue({
    answer: { status: 'answered', text: 'Tomorrow.', citations: ['p1'] },
    usage: { inputTokens: 1_000, outputTokens: 100 },
  });
  const authenticate = vi
    .fn()
    .mockResolvedValue({ uid: 'server-verified-uid' });
  const service = new AssistantService({
    auth: { authenticate },
    ledger,
    provider: { generate },
    enabled: options.enabled ?? true,
    unavailableReason: 'Live AI is disabled.',
    allowLocalHttp: options.localHttp ?? true,
    renderProxy: options.renderProxy,
    now: () => NOW,
  });
  return {
    service,
    ledger,
    reserve,
    dispatch,
    settle,
    usage,
    generate,
    authenticate,
  };
}

let server: Server | undefined;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
  server = undefined;
  vi.restoreAllMocks();
});
async function start(service: AssistantService) {
  server = createApp(['http://localhost:5173'], undefined, service).listen(
    0,
    '127.0.0.1',
  );
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  return `http://127.0.0.1:${address.port}`;
}

describe('billable generation admission and settlement', () => {
  it('sends only the reviewed context once after the shared reservation and dispatch commit', async () => {
    const { service, reserve, dispatch, generate, settle } = fixture();
    const request = body();
    const result = await service.answer(
      'server-verified-uid',
      request,
      new AbortController().signal,
    );
    expect(reserve).toHaveBeenCalledWith(
      'server-verified-uid',
      request.requestId,
    );
    expect(generate).toHaveBeenCalledWith(
      request.context,
      expect.any(AbortSignal),
    );
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(
      dispatch.mock.invocationCallOrder[0] ?? 0,
    );
    expect(dispatch.mock.invocationCallOrder[0]).toBeLessThan(
      generate.mock.invocationCallOrder[0] ?? 0,
    );
    expect(settle).toHaveBeenCalledWith(expect.anything(), {
      billing: 'known',
      costMicroUsd: 132,
    });
    expect(result).toMatchObject({
      requestId: request.requestId,
      usage: { remaining: 4 },
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it.each([
    'daily-limit',
    'burst-limit',
    'generation-active',
    'budget-exhausted',
    'request-replayed',
    'quota-unavailable',
  ] as const)(
    'prevents provider access when %s admission fails',
    async (code) => {
      const { service, reserve, generate } = fixture();
      reserve.mockRejectedValue(new AssistantError(code, 429, 'Denied'));
      await expect(
        service.answer('verified', body(), new AbortController().signal),
      ).rejects.toMatchObject({ code });
      expect(generate).not.toHaveBeenCalled();
    },
  );
  it('prevents provider access when marking dispatch fails', async () => {
    const { service, dispatch, generate, settle } = fixture();
    dispatch.mockRejectedValue(
      new AssistantError('quota-unavailable', 503, 'Unavailable'),
    );
    await expect(
      service.answer('uid', body(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'quota-unavailable' });
    expect(generate).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(expect.anything(), { billing: 'none' });
  });
  it('does not refund an uncertain provider failure or retry it', async () => {
    const { service, generate, settle } = fixture();
    generate.mockRejectedValue(
      new ProviderError('provider-timeout', 'The request timed out.'),
    );
    await expect(
      service.answer('uid', body(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'provider-timeout' });
    expect(settle).toHaveBeenCalledWith(expect.anything(), {
      billing: 'uncertain',
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('refunds a known unbilled provider rejection and a cancellation before dispatch', async () => {
    const { service, generate, settle } = fixture();
    generate.mockRejectedValue(
      new ProviderError(
        'provider-unauthorized',
        'Provider rejected credentials.',
        'none',
      ),
    );
    await expect(
      service.answer('uid', body(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'provider-unauthorized' });
    expect(settle).toHaveBeenLastCalledWith(expect.anything(), {
      billing: 'none',
    });
    generate.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.answer('uid', body(), controller.signal),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(generate).not.toHaveBeenCalled();
  });
  it('keeps the maximum reservation when provider usage is missing', async () => {
    const { service, generate, settle } = fixture();
    generate.mockResolvedValue({
      answer: { status: 'answered', text: 'Tomorrow.', citations: ['p1'] },
      usage: null,
    });
    await service.answer('uid', body(), new AbortController().signal);
    expect(settle).toHaveBeenCalledWith(expect.anything(), {
      billing: 'uncertain',
    });
  });
  it('does not return a result if final Firestore settlement cannot be committed', async () => {
    const { service, settle } = fixture();
    settle.mockRejectedValue(
      new AssistantError('quota-unavailable', 503, 'Settlement unavailable.'),
    );
    await expect(
      service.answer('uid', body(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'quota-unavailable' });
  });
  it('validates review before reserving and keeps disabled AI inaccessible', async () => {
    const { service, reserve } = fixture({ enabled: false });
    await expect(
      service.answer('uid', body(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'assistant-unavailable' });
    await expect(
      service.answer(
        'uid',
        { ...body(), uid: 'client-uid' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    expect(reserve).not.toHaveBeenCalled();
    expect(await service.usage('uid')).toMatchObject({
      remaining: 4,
      available: false,
      unavailableReason: 'Live AI is disabled.',
    });
  });
});

describe('assistant HTTP boundary', () => {
  it('requires authentication for usage and answers without affecting health', async () => {
    const { service, generate } = fixture();
    const url = await start(service);
    for (const path of ['usage', 'answer']) {
      const response = await fetch(`${url}/assistant/${path}`, {
        method: path === 'usage' ? 'GET' : 'POST',
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect((await fetch(`${url}/health`)).status).toBe(200);
    expect(generate).not.toHaveBeenCalled();
  });
  it('derives UID from authentication and returns uncached server usage', async () => {
    const { service, reserve, authenticate } = fixture();
    const url = await start(service);
    const request = body();
    const response = await fetch(`${url}/assistant/answer`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith('Bearer token');
    expect(reserve).toHaveBeenCalledWith(
      'server-verified-uid',
      request.requestId,
    );
  });
  it('rejects HTTP and spoofed forwarding headers outside Render', async () => {
    const { service, authenticate } = fixture({ localHttp: false });
    const url = await start(service);
    const response = await fetch(`${url}/assistant/usage`, {
      headers: { Authorization: 'Bearer token', 'X-Forwarded-Proto': 'https' },
    });
    expect(response.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
  });
  it('allows the explicit Render TLS ingress policy', async () => {
    const { service } = fixture({ localHttp: false, renderProxy: true });
    const url = await start(service);
    expect(
      (
        await fetch(`${url}/assistant/usage`, {
          headers: {
            Authorization: 'Bearer token',
            'X-Forwarded-Proto': 'https',
          },
        })
      ).status,
    ).toBe(200);
  });
  it.each([
    { type: 'multipart/form-data', value: 'pdf-data' },
    { type: 'application/json', value: '{broken' },
    {
      type: 'application/json',
      value: JSON.stringify({ ...body(), secret: 'x'.repeat(70_000) }),
    },
  ])(
    'rejects files, invalid JSON and oversized input %#',
    async ({ type, value }) => {
      const { service, generate, reserve } = fixture();
      const url = await start(service);
      const response = await fetch(`${url}/assistant/answer`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token', 'Content-Type': type },
        body: value,
      });
      expect(response.status).toBe(400);
      expect(reserve).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
    },
  );
});
