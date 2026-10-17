import { findSnapshotPage } from './snapshot';
import type { AssistantOperation, AssistantWorkspaceSnapshot } from './types';

const MAX_ROTATED_PAGES = 10;
const MAX_ANNOTATION_TEXT = 240;
const MAX_WATERMARK_TEXT = 200;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && keys.every((key) => actual.includes(key))
  );
}

function isPageId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 120 &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

/** Assistant text is deliberately limited to printable ASCII in this phase. */
function isSafeAssistantText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    /^[\x20-\x7e]+$/u.test(value)
  );
}

function fail(message: string): ValidationResult {
  return { ok: false, message };
}

export type ValidationResult =
  | { readonly ok: true; readonly operation: AssistantOperation }
  | { readonly ok: false; readonly message: string };

/** Revalidates local or remote output against a fresh workspace snapshot. */
export function validateAssistantOperation(
  value: unknown,
  snapshot: AssistantWorkspaceSnapshot,
): ValidationResult {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return fail('The proposed action is malformed and was not applied.');
  }

  switch (value.type) {
    case 'select_page': {
      if (!hasExactKeys(value, ['type', 'pageId']) || !isPageId(value.pageId)) {
        return fail('The page selection proposal is malformed.');
      }
      if (!findSnapshotPage(snapshot, value.pageId)) {
        return fail('That page is no longer in the current workspace.');
      }
      return { ok: true, operation: value as AssistantOperation };
    }
    case 'rotate_pages': {
      if (
        !hasExactKeys(value, ['type', 'pageIds', 'degrees']) ||
        !Array.isArray(value.pageIds) ||
        value.pageIds.length < 1 ||
        value.pageIds.length > MAX_ROTATED_PAGES ||
        !value.pageIds.every(isPageId) ||
        (value.degrees !== 90 && value.degrees !== -90)
      ) {
        return fail('The page rotation proposal is malformed.');
      }
      if (new Set(value.pageIds).size !== value.pageIds.length) {
        return fail('A page can appear only once in a rotation proposal.');
      }
      if (value.pageIds.some((id) => !findSnapshotPage(snapshot, id))) {
        return fail('One or more target pages are no longer in the workspace.');
      }
      return { ok: true, operation: value as AssistantOperation };
    }
    case 'move_page': {
      if (
        !hasExactKeys(value, ['type', 'pageId', 'toIndex']) ||
        !isPageId(value.pageId) ||
        !Number.isInteger(value.toIndex)
      ) {
        return fail('The page move proposal is malformed.');
      }
      const page = findSnapshotPage(snapshot, value.pageId);
      if (!page) return fail('That page is no longer in the workspace.');
      if (
        typeof value.toIndex !== 'number' ||
        value.toIndex < 0 ||
        value.toIndex >= snapshot.pages.length
      ) {
        return fail('The destination is outside the current page order.');
      }
      if (page.pageNumber - 1 === value.toIndex) {
        return fail('That page is already in the requested position.');
      }
      return { ok: true, operation: value as AssistantOperation };
    }
    case 'delete_page': {
      if (!hasExactKeys(value, ['type', 'pageId']) || !isPageId(value.pageId)) {
        return fail('The page deletion proposal is malformed.');
      }
      if (snapshot.pages.length <= 1) {
        return fail('The last page in a workspace cannot be deleted.');
      }
      if (!findSnapshotPage(snapshot, value.pageId)) {
        return fail('That page is no longer in the workspace.');
      }
      return { ok: true, operation: value as AssistantOperation };
    }
    case 'set_text_watermark': {
      if (
        !hasExactKeys(value, ['type', 'text']) ||
        !isSafeAssistantText(value.text, MAX_WATERMARK_TEXT)
      ) {
        return fail(
          'Use printable English characters for a watermark of up to 200 characters.',
        );
      }
      if (snapshot.pages.length === 0) {
        return fail('Open a PDF before setting a watermark.');
      }
      return { ok: true, operation: value as AssistantOperation };
    }
    case 'remove_watermark': {
      if (!hasExactKeys(value, ['type'])) {
        return fail('The watermark removal proposal is malformed.');
      }
      if (!snapshot.watermark.present) {
        return fail('There is no committed watermark to remove.');
      }
      return { ok: true, operation: value as AssistantOperation };
    }
    case 'add_text_annotation': {
      if (
        !hasExactKeys(value, ['type', 'pageId', 'text', 'position']) ||
        !isPageId(value.pageId) ||
        !isSafeAssistantText(value.text, MAX_ANNOTATION_TEXT) ||
        value.position !== 'center'
      ) {
        return fail(
          'Use a centered note with printable English text of up to 240 characters.',
        );
      }
      if (!findSnapshotPage(snapshot, value.pageId)) {
        return fail('That page is no longer in the workspace.');
      }
      return { ok: true, operation: value as AssistantOperation };
    }
    default:
      return fail('That action is not supported by the PDF assistant.');
  }
}
