export type PageRangeError =
  | 'empty'
  | 'invalid-token'
  | 'invalid-page'
  | 'out-of-bounds'
  | 'descending-range'
  | 'invalid-page-count';

export type PageRangeResult =
  | {
      readonly ok: true;
      readonly indexes: readonly number[];
    }
  | {
      readonly ok: false;
      readonly error: PageRangeError;
    };

const RANGE_TOKEN = /^(\d+)(?:\s*-\s*(\d+))?$/;

/** Parse one-based page ranges into unique zero-based indexes. */
export function parsePageRange(
  expression: string,
  pageCount: number,
): PageRangeResult {
  if (!Number.isInteger(pageCount) || pageCount <= 0) {
    return { ok: false, error: 'invalid-page-count' };
  }

  const normalizedExpression = expression.trim();
  if (!normalizedExpression) {
    return { ok: false, error: 'empty' };
  }

  const indexes: number[] = [];
  const seen = new Set<number>();

  for (const rawToken of normalizedExpression.split(',')) {
    const token = rawToken.trim();
    if (!token) {
      return { ok: false, error: 'invalid-token' };
    }

    if (/^-\d+$/.test(token)) {
      return { ok: false, error: 'invalid-page' };
    }

    const match = RANGE_TOKEN.exec(token);
    if (!match) {
      return { ok: false, error: 'invalid-token' };
    }

    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < 1
    ) {
      return { ok: false, error: 'invalid-page' };
    }

    if (end < start) {
      return { ok: false, error: 'descending-range' };
    }

    if (start > pageCount || end > pageCount) {
      return { ok: false, error: 'out-of-bounds' };
    }

    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
      const index = pageNumber - 1;
      if (!seen.has(index)) {
        seen.add(index);
        indexes.push(index);
      }
    }
  }

  return { ok: true, indexes };
}
