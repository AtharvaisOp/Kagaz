import { validateAssistantOperation } from './validation';

import type {
  AssistantOperation,
  AssistantWorkspaceSnapshot,
  InterpretationResult,
} from './types';

export interface PlannerContext {
  readonly pageCount: number;
  readonly currentPageNumber: number | null;
  readonly pageRotations: readonly number[];
  readonly watermarkPresent: boolean;
  readonly watermarkKind: 'text' | 'image' | null;
  readonly capabilities: readonly [
    'select_page',
    'rotate_pages',
    'move_page',
    'delete_page',
    'set_text_watermark',
    'remove_watermark',
    'add_text_annotation',
  ];
}

export interface RemotePlannerRequest {
  readonly prompt: string;
  readonly workspace: PlannerContext;
}

/** Provider adapters may return only structured data; they receive no tools. */
export interface RemotePlannerAdapter {
  readonly proposeStructured: (
    request: RemotePlannerRequest,
    signal: AbortSignal,
  ) => Promise<unknown>;
}

export function createPlannerContext(
  snapshot: AssistantWorkspaceSnapshot,
): PlannerContext {
  return {
    pageCount: snapshot.pages.length,
    currentPageNumber:
      snapshot.pages.find((page) => page.id === snapshot.selectedPageId)
        ?.pageNumber ?? null,
    pageRotations: snapshot.pages.map((page) => page.rotationDegrees),
    watermarkPresent: snapshot.watermark.present,
    watermarkKind: snapshot.watermark.kind,
    capabilities: [
      'select_page',
      'rotate_pages',
      'move_page',
      'delete_page',
      'set_text_watermark',
      'remove_watermark',
      'add_text_annotation',
    ],
  };
}

type WireRecord = Record<string, unknown>;

function isRecord(value: unknown): value is WireRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: WireRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && keys.every((key) => actual.includes(key))
  );
}

function pageIdAt(
  snapshot: AssistantWorkspaceSnapshot,
  pageNumber: unknown,
): string | null {
  if (
    typeof pageNumber !== 'number' ||
    !Number.isSafeInteger(pageNumber) ||
    pageNumber < 1
  ) {
    return null;
  }
  return (
    snapshot.pages.find((page) => page.pageNumber === pageNumber)?.id ?? null
  );
}

function wireToOperation(
  value: unknown,
  snapshot: AssistantWorkspaceSnapshot,
): AssistantOperation | null {
  if (!isRecord(value) || typeof value.action !== 'string') return null;
  switch (value.action) {
    case 'select_page': {
      if (!exactKeys(value, ['action', 'page'])) return null;
      const pageId = pageIdAt(snapshot, value.page);
      return pageId ? { type: 'select_page', pageId } : null;
    }
    case 'rotate_pages': {
      if (
        !exactKeys(value, ['action', 'pages', 'direction']) ||
        !Array.isArray(value.pages) ||
        (value.direction !== 'clockwise' &&
          value.direction !== 'counterclockwise')
      ) {
        return null;
      }
      const pageIds = value.pages.map((page) => pageIdAt(snapshot, page));
      if (pageIds.some((id) => id === null)) return null;
      return {
        type: 'rotate_pages',
        pageIds: pageIds as string[],
        degrees: value.direction === 'clockwise' ? 90 : -90,
      };
    }
    case 'move_page': {
      if (!exactKeys(value, ['action', 'page', 'toPosition'])) return null;
      const pageId = pageIdAt(snapshot, value.page);
      const destination = value.toPosition;
      if (
        !pageId ||
        typeof destination !== 'number' ||
        !Number.isSafeInteger(destination)
      ) {
        return null;
      }
      return { type: 'move_page', pageId, toIndex: destination - 1 };
    }
    case 'delete_page': {
      if (!exactKeys(value, ['action', 'page'])) return null;
      const pageId = pageIdAt(snapshot, value.page);
      return pageId ? { type: 'delete_page', pageId } : null;
    }
    case 'set_text_watermark':
      return exactKeys(value, ['action', 'text']) &&
        typeof value.text === 'string'
        ? { type: 'set_text_watermark', text: value.text }
        : null;
    case 'remove_watermark':
      return exactKeys(value, ['action']) ? { type: 'remove_watermark' } : null;
    case 'add_text_annotation': {
      if (
        !exactKeys(value, ['action', 'page', 'text', 'position']) ||
        typeof value.text !== 'string' ||
        value.position !== 'center'
      ) {
        return null;
      }
      const pageId = pageIdAt(snapshot, value.page);
      return pageId
        ? {
            type: 'add_text_annotation',
            pageId,
            text: value.text,
            position: 'center',
          }
        : null;
    }
    default:
      return null;
  }
}

export function parsePlannerResponse(
  value: unknown,
  snapshot: AssistantWorkspaceSnapshot,
): InterpretationResult {
  const operation = wireToOperation(value, snapshot);
  if (!operation) {
    return {
      kind: 'invalid',
      message:
        'The remote planner returned an unsupported or malformed action.',
    };
  }
  const result = validateAssistantOperation(operation, snapshot);
  return result.ok
    ? { kind: 'proposal', operation: result.operation }
    : { kind: 'invalid', message: result.message };
}

export type RemotePlanResult =
  | { readonly kind: 'proposal'; readonly operation: AssistantOperation }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'error'; readonly message: string };

const REMOTE_TIMEOUT_MS = 15_000;
const MAX_REMOTE_PROMPT_LENGTH = 500;

/**
 * Guarded adapter boundary for tests and a future authenticated provider.
 * No live adapter or public billable endpoint is configured in this phase.
 */
export async function requestRemotePlan(
  adapter: RemotePlannerAdapter,
  prompt: string,
  snapshot: AssistantWorkspaceSnapshot,
  signal: AbortSignal,
  timeoutMs = REMOTE_TIMEOUT_MS,
): Promise<RemotePlanResult> {
  if (!prompt.trim() || prompt.length > MAX_REMOTE_PROMPT_LENGTH) {
    return {
      kind: 'error',
      message: 'Remote requests must contain between 1 and 500 characters.',
    };
  }

  const controller = new AbortController();
  let rejectAbort: (() => void) | null = null;
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const cancellation = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new DOMException('Cancelled', 'AbortError'));
  });
  const onAbort = () => {
    controller.abort();
    rejectAbort?.();
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error('Planner request timed out.'));
    }, timeoutMs);
  });

  try {
    const request = {
      prompt,
      workspace: createPlannerContext(snapshot),
    };
    const response = await Promise.race([
      adapter.proposeStructured(request, controller.signal),
      timeout,
      cancellation,
    ]);
    if (signal.aborted) return { kind: 'cancelled' };
    const parsed = parsePlannerResponse(response, snapshot);
    return parsed.kind === 'proposal'
      ? parsed
      : { kind: 'error', message: parsed.message };
  } catch {
    if (signal.aborted) return { kind: 'cancelled' };
    return {
      kind: 'error',
      message: timedOut
        ? 'Remote planning timed out. Use a local command or try again later.'
        : 'Remote planning failed. Use a local command or try again later.',
    };
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    signal.removeEventListener('abort', onAbort);
  }
}
