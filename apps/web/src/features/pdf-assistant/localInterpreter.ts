import { validateAssistantOperation } from './validation';

import type {
  AssistantOperation,
  AssistantWorkspaceSnapshot,
  InterpretationResult,
} from './types';

const MAX_PROMPT_LENGTH = 500;

function pageIdAt(
  snapshot: AssistantWorkspaceSnapshot,
  pageNumber: number,
): string | null {
  return (
    snapshot.pages.find((page) => page.pageNumber === pageNumber)?.id ?? null
  );
}

function proposal(
  operation: AssistantOperation,
  snapshot: AssistantWorkspaceSnapshot,
): InterpretationResult {
  const validation = validateAssistantOperation(operation, snapshot);
  return validation.ok
    ? { kind: 'proposal', operation: validation.operation }
    : { kind: 'invalid', message: validation.message };
}

function parsePageNumbers(expression: string): number[] | null {
  const normalized = expression
    .replace(/\bpages?\b/giu, '')
    .replace(/\band\b/giu, ',')
    .trim();
  if (!/^\d+(?:\s*,\s*\d+)*$/u.test(normalized)) return null;
  const values = normalized.split(',').map((value) => Number(value.trim()));
  return values.every((value) => Number.isSafeInteger(value) && value > 0)
    ? values
    : null;
}

function resolvePageIds(
  pageNumbers: readonly number[],
  snapshot: AssistantWorkspaceSnapshot,
): string[] | null {
  const ids = pageNumbers.map((number) => pageIdAt(snapshot, number));
  return ids.every((id): id is string => id !== null) ? ids : null;
}

function stripFinalPeriod(value: string): string {
  return value.trim().replace(/\.$/u, '').trim();
}

function parseWatermarkText(prompt: string): string | null {
  const patterns = [
    /^(?:add|set|change|edit)\s+(?:a\s+|the\s+)?(?:text\s+)?(.+?)\s+watermark\s+(?:to|for)\s+(?:every|all)\s+pages?\.?$/iu,
    /^(?:set|change|edit)\s+(?:the\s+)?watermark\s+to\s+(?:"([^"]+)"|'([^']+)'|(.+?))\s+on\s+(?:every|all)\s+pages?\.?$/iu,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const text = stripFinalPeriod(
      match[1] ?? match[2] ?? match[3] ?? match[4] ?? '',
    );
    if (text.length > 0) return text;
  }
  return null;
}

/**
 * A deliberately small offline grammar. It never evaluates text and only
 * produces allowlisted, typed proposals that are independently validated.
 */
export function interpretLocalCommand(
  rawPrompt: string,
  snapshot: AssistantWorkspaceSnapshot,
): InterpretationResult {
  if (typeof rawPrompt !== 'string' || rawPrompt.trim().length === 0) {
    return { kind: 'ambiguous', message: 'Enter a PDF editing request.' };
  }
  if (rawPrompt.length > MAX_PROMPT_LENGTH) {
    return {
      kind: 'invalid',
      message: 'Keep a local command under 500 characters.',
    };
  }
  const prompt = rawPrompt.trim().replace(/[.!?]+$/u, '');

  const selectMatch = prompt.match(
    /^(?:take me to|go to|jump to|navigate to|select|show) page (\d+)$/iu,
  );
  if (selectMatch) {
    const pageNumber = Number(selectMatch[1]);
    const pageId = pageIdAt(snapshot, pageNumber);
    return pageId
      ? proposal({ type: 'select_page', pageId }, snapshot)
      : {
          kind: 'invalid',
          message: 'Page ' + pageNumber + ' is outside the current workspace.',
        };
  }
  if (
    /\b(?:take me to|go to|jump to|navigate to|select|show)\b/iu.test(prompt)
  ) {
    return {
      kind: 'ambiguous',
      message: 'Name one page number, for example: take me to page 5.',
    };
  }

  const rotateMatch = prompt.match(
    /^(?:rotate|turn) (?:pages?|the pages?) (.+?) (clockwise|counterclockwise|anticlockwise)(?: by 90 degrees?)?$/iu,
  );
  if (rotateMatch) {
    const pageNumbers = parsePageNumbers(rotateMatch[1] ?? '');
    if (!pageNumbers || pageNumbers.length > 10) {
      return {
        kind: 'ambiguous',
        message:
          'List up to 10 page numbers, such as: rotate pages 2 and 4 clockwise.',
      };
    }
    const pageIds = resolvePageIds(pageNumbers, snapshot);
    if (!pageIds) {
      return {
        kind: 'invalid',
        message: 'One or more page numbers are outside the current workspace.',
      };
    }
    return proposal(
      {
        type: 'rotate_pages',
        pageIds,
        degrees: rotateMatch[2]?.toLowerCase() === 'clockwise' ? 90 : -90,
      },
      snapshot,
    );
  }
  if (/^(?:rotate|turn)\b/iu.test(prompt)) {
    return {
      kind: 'ambiguous',
      message:
        'Specify page numbers and a direction, for example: rotate page 2 clockwise.',
    };
  }

  const moveMatch = prompt.match(
    /^move (?:the )?(last|page \d+|\d+(?:st|nd|rd|th)?)(?: page)? to (?:the )?(beginning|start|front|first|end|last|page \d+|position \d+|\d+(?:st|nd|rd|th)?)(?: page)?$/iu,
  );
  if (moveMatch) {
    const source = moveMatch[1] ?? '';
    const destination = moveMatch[2] ?? '';
    const sourceNumber =
      source.toLowerCase() === 'last'
        ? snapshot.pages.length
        : Number(source.match(/\d+/u)?.[0]);
    const sourceId = pageIdAt(snapshot, sourceNumber);
    if (!sourceId) {
      return {
        kind: 'invalid',
        message: 'The source page is outside the current workspace.',
      };
    }
    const toIndex = /^(?:beginning|start|front|first)$/iu.test(destination)
      ? 0
      : /^(?:end|last)$/iu.test(destination)
        ? snapshot.pages.length - 1
        : Number(destination.match(/\d+/u)?.[0]) - 1;
    if (
      !Number.isInteger(toIndex) ||
      toIndex < 0 ||
      toIndex >= snapshot.pages.length
    ) {
      return {
        kind: 'invalid',
        message: 'The destination is outside the current workspace.',
      };
    }
    return proposal({ type: 'move_page', pageId: sourceId, toIndex }, snapshot);
  }
  if (/^move\b/iu.test(prompt)) {
    return {
      kind: 'ambiguous',
      message:
        'Name the source and destination, for example: move the last page to the beginning.',
    };
  }

  const deleteMatch = prompt.match(
    /^(?:delete|remove|discard) (?:the )?page (\d+)$/iu,
  );
  if (deleteMatch) {
    const pageNumber = Number(deleteMatch[1]);
    const pageId = pageIdAt(snapshot, pageNumber);
    return pageId
      ? proposal({ type: 'delete_page', pageId }, snapshot)
      : {
          kind: 'invalid',
          message: 'Page ' + pageNumber + ' is outside the current workspace.',
        };
  }

  if (/^remove (?:the )?(?:existing )?watermark$/iu.test(prompt)) {
    return proposal({ type: 'remove_watermark' }, snapshot);
  }
  const watermarkText = parseWatermarkText(prompt);
  if (watermarkText !== null) {
    return proposal(
      { type: 'set_text_watermark', text: watermarkText },
      snapshot,
    );
  }
  if (/\bwatermark\b/iu.test(prompt)) {
    return {
      kind: 'ambiguous',
      message:
        'Specify the watermark text and say that it applies to every page.',
    };
  }

  const noteMatch = prompt.match(
    /^(?:add|put|place) (?:a )?(?:text )?(?:note|annotation) ["“]([^"”]+)["”] (?:in|at) (?:the )?(?:center|centre) of page (\d+)$/iu,
  );
  if (noteMatch) {
    const pageNumber = Number(noteMatch[2]);
    const pageId = pageIdAt(snapshot, pageNumber);
    return pageId
      ? proposal(
          {
            type: 'add_text_annotation',
            pageId,
            text: noteMatch[1] ?? '',
            position: 'center',
          },
          snapshot,
        )
      : {
          kind: 'invalid',
          message: 'Page ' + pageNumber + ' is outside the current workspace.',
        };
  }
  if (/\b(?:note|annotation)\b/iu.test(prompt)) {
    return {
      kind: 'ambiguous',
      message:
        'Quote the note text and name a page, for example: put a text note "Reviewed" in the center of page 1.',
    };
  }

  return {
    kind: 'unsupported',
    message:
      'That request is outside the assistant’s supported commands. Try page selection, rotation, reordering, deletion, a text watermark, or a centered text note.',
  };
}
