import type { WorkspacePage } from '../../pdf-workspace/model/types';
import type { CommittedFormPassage } from './formPassages';

export const RETRIEVAL_LIMITS = Object.freeze({
  maxWorkspacePageOccurrences: 1_500,
  maxUniqueSourcePages: 1_000,
  maxCharactersPerSourcePage: 24_000,
  maxWorkspaceCharacters: 2_000_000,
  maxCommittedFormPassages: 500,
  maxCommittedFormCharacters: 100_000,
  maxCommittedFormValueCharacters: 2_000,
  maxChunks: 10_000,
  maxChunkCharacters: 1_100,
  // Keep any supported quoted phrase intact when a long passage crosses a
  // chunk boundary.
  chunkOverlapCharacters: 260,
  maxQueryCharacters: 400,
  maxExactPhraseCharacters: 240,
  maxExcerptCharacters: 420,
  maxSearchResults: 100,
  initialVisibleResults: 20,
});

const STOP_WORDS = new Set([
  'a',
  'about',
  'according',
  'an',
  'and',
  'are',
  'be',
  'can',
  'could',
  'do',
  'does',
  'document',
  'every',
  'find',
  'for',
  'give',
  'in',
  'is',
  'it',
  'me',
  'mention',
  'mentions',
  'of',
  'on',
  'or',
  'paragraph',
  'page',
  'pages',
  'please',
  'search',
  'show',
  'tell',
  'that',
  'the',
  'this',
  'to',
  'what',
  'when',
  'where',
  'which',
  'who',
  'with',
  'would',
]);

export interface PageTextExtraction {
  readonly text: string;
  readonly truncated: boolean;
}

export type PageTextExtractor = (
  page: WorkspacePage,
  maximumCharacters: number,
  signal: AbortSignal,
) => Promise<PageTextExtraction>;

interface IndexedChunk {
  readonly index: number;
  readonly text: string;
  readonly normalizedText: string;
}

interface IndexedSourcePage {
  readonly key: string;
  readonly text: string;
  readonly truncated: boolean;
  readonly failed: boolean;
  chunks: readonly IndexedChunk[];
}

export interface RetrievalIndexStats {
  readonly generation: number;
  readonly uniqueSourcePages: number;
  readonly searchableSourcePages: number;
  readonly emptySourcePages: number;
  readonly failedSourcePages: number;
  readonly truncatedSourcePages: number;
  readonly indexedFormPassages: number;
  readonly omittedFormPassages: number;
  readonly formCharacters: number;
  readonly characters: number;
  readonly chunks: number;
  readonly chunkLimitReached: boolean;
}

export interface RetrievalIndexProgress {
  readonly completedPages: number;
  readonly totalPages: number;
  readonly characters: number;
}

export interface RetrievalIndexSummary extends RetrievalIndexStats {
  readonly workspacePages: number;
  readonly excludedPages: number;
  readonly unindexedPages: number;
  readonly partial: boolean;
}

export interface RetrievalQuery {
  readonly raw: string;
  readonly normalizedPhrase: string | null;
  readonly terms: readonly string[];
  readonly pageNumber: number | null;
}

export interface RetrievalResult {
  /** Stable to the logical workspace page and passage, including duplicates. */
  readonly id: string;
  readonly pageId: string;
  readonly sourcePageKey: string;
  readonly provenance: 'source-pdf' | 'committed-form-value';
  readonly fieldLabel?: string;
  readonly chunkIndex: number;
  readonly excerpt: string;
  readonly matchReason: string;
  readonly matchedTerms: readonly string[];
  readonly score: number;
}

export interface RetrievalSearchResponse {
  readonly results: readonly RetrievalResult[];
  readonly totalMatches: number;
  readonly limited: boolean;
}

export type RetrievalQueryError =
  | 'empty'
  | 'too-long'
  | 'no-search-terms'
  | 'invalid-page-filter'
  | 'phrase-too-long';

export function sourcePageKey(page: WorkspacePage): string {
  return JSON.stringify([page.sourceDocumentId, page.sourcePageIndex]);
}

export function normalizeSearchText(value: string): string {
  return value
    .replace(/([\p{L}\p{N}])-[\t ]*\r?\n[\t ]*(?=[\p{L}\p{N}])/gu, '$1')
    .replace(/[\r\n\t]+/gu, ' ')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined') window.setTimeout(resolve, 0);
    else setTimeout(resolve, 0);
  });
}

export function parseRetrievalQuery(input: string):
  | { readonly ok: true; readonly query: RetrievalQuery }
  | {
      readonly ok: false;
      readonly reason: RetrievalQueryError;
    } {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'empty' };
  if (raw.length > RETRIEVAL_LIMITS.maxQueryCharacters)
    return { ok: false, reason: 'too-long' };

  const pageFilterSource = raw.replace(/["“][^"”]*["”]/gu, (phrase) =>
    ' '.repeat(phrase.length),
  );
  const pageFilters = [
    ...pageFilterSource.matchAll(/\b(?:page|p\.)\s*#?\s*(\d+)\b/giu),
  ];
  const numbers = new Set(pageFilters.map((match) => Number(match[1])));
  if (numbers.size > 1 || [...numbers].some((number) => number < 1))
    return { ok: false, reason: 'invalid-page-filter' };
  const pageNumber = numbers.values().next().value ?? null;

  const exactMatch = raw.match(/["“]([^"”]+)["”]/u);
  const exactRaw = exactMatch?.[1]?.trim() ?? null;
  if (exactRaw && exactRaw.length > RETRIEVAL_LIMITS.maxExactPhraseCharacters) {
    return { ok: false, reason: 'phrase-too-long' };
  }

  let withoutPageFilter = raw;
  for (const match of [...pageFilters].reverse()) {
    const index = match.index;
    if (index === undefined) continue;
    withoutPageFilter = `${withoutPageFilter.slice(0, index)} ${withoutPageFilter.slice(index + match[0].length)}`;
  }
  const phraseSource = exactRaw ?? withoutPageFilter;
  const phraseWithoutQuotes = phraseSource.replace(/["“”]/gu, ' ');
  const normalizedPhrase = exactRaw ? normalizeSearchText(exactRaw) : null;
  const terms = Array.from(
    new Set(
      tokenize(normalizeSearchText(phraseWithoutQuotes)).filter(
        (term) => !STOP_WORDS.has(term),
      ),
    ),
  );

  if (terms.length === 0 && !normalizedPhrase)
    return { ok: false, reason: 'no-search-terms' };

  return {
    ok: true,
    query: { raw, normalizedPhrase, terms, pageNumber },
  };
}

function splitLongSegment(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < value.length) {
    const maximum = Math.min(
      value.length,
      start + RETRIEVAL_LIMITS.maxChunkCharacters,
    );
    let end = maximum;
    if (maximum < value.length) {
      const boundary = Math.max(
        value.lastIndexOf(' ', maximum),
        value.lastIndexOf('\n', maximum),
      );
      if (boundary > start + 160) end = boundary;
    }
    const part = value.slice(start, end).trim();
    if (part) parts.push(part);
    if (end >= value.length) break;

    const overlapStart = Math.max(
      start + 1,
      end - RETRIEVAL_LIMITS.chunkOverlapCharacters,
    );
    const remainder = value.slice(overlapStart);
    const nextBoundary = remainder.search(/\s/u);
    start = nextBoundary < 0 ? overlapStart : overlapStart + nextBoundary + 1;
  }
  return parts;
}

function makeChunks(text: string, remaining: number): readonly IndexedChunk[] {
  if (remaining <= 0) return [];
  const paragraphs = text
    .split(/\n\s*\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: IndexedChunk[] = [];

  for (const paragraph of paragraphs) {
    const sentences = paragraph
      .split(/(?<=[.!?])\s+(?=[\p{L}\p{N}])/gu)
      .flatMap(splitLongSegment);
    let current = '';
    for (const sentence of sentences) {
      if (
        current &&
        current.length + sentence.length + 1 >
          RETRIEVAL_LIMITS.maxChunkCharacters
      ) {
        chunks.push({
          index: chunks.length,
          text: current,
          normalizedText: normalizeSearchText(current),
        });
        if (chunks.length >= remaining) return chunks;
        current = '';
      }
      current = current ? `${current} ${sentence}` : sentence;
    }
    if (current) {
      chunks.push({
        index: chunks.length,
        text: current,
        normalizedText: normalizeSearchText(current),
      });
      if (chunks.length >= remaining) return chunks;
    }
  }
  return chunks;
}

function headerFooterLines(pages: readonly IndexedSourcePage[]): Set<string> {
  if (pages.length < 3) return new Set();
  const counts = new Map<string, number>();
  for (const page of pages) {
    const lines = page.text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length >= 3 && line.length <= 100);
    const edgeLines = new Set([...lines.slice(0, 2), ...lines.slice(-2)]);
    for (const line of edgeLines) {
      const normalized = normalizeSearchText(line);
      if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  const minimum = Math.max(3, Math.ceil(pages.length * 0.6));
  return new Set(
    [...counts].filter(([, count]) => count >= minimum).map(([line]) => line),
  );
}

function stripHeaderFooterLines(
  text: string,
  repeatedLines: ReadonlySet<string>,
): string {
  if (repeatedLines.size === 0) return text;
  return text
    .split(/\r?\n/u)
    .filter((line) => !repeatedLines.has(normalizeSearchText(line.trim())))
    .join('\n');
}

function excerptAroundMatch(
  text: string,
  terms: readonly string[],
  maximum: number,
): string {
  if (text.length <= maximum) return text;
  let matchStart: number | null = null;
  const tokenPattern = /[\p{L}\p{N}\p{M}]+/gu;
  for (const match of text.matchAll(tokenPattern)) {
    const token = normalizeSearchText(match[0]);
    if (terms.some((term) => token === term || token.startsWith(term))) {
      matchStart = match.index ?? null;
      break;
    }
  }

  let start = Math.max(0, (matchStart ?? 0) - Math.floor(maximum * 0.32));
  if (start > 0) {
    const wordBoundary = text.indexOf(' ', start);
    if (wordBoundary >= 0 && wordBoundary < start + 40)
      start = wordBoundary + 1;
  }
  let end = Math.min(text.length, start + maximum);
  if (end < text.length) {
    const wordBoundary = text.lastIndexOf(' ', end);
    if (wordBoundary > end - 40) end = wordBoundary;
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

interface CandidateSearchStats {
  readonly tokenCount: number;
  readonly termFrequencies: ReadonlyMap<string, number>;
  readonly proximityScore: number;
}

function candidateSearchStats(
  normalizedText: string,
  terms: readonly string[],
): CandidateSearchStats {
  const termIndexes = new Map(terms.map((term, index) => [term, index]));
  const frequencies = new Map<string, number>();
  const latestStartByPrefix = Array<number>(terms.length).fill(-1);
  const tokens = tokenize(normalizedText);
  let bestSpan = Number.POSITIVE_INFINITY;

  for (let position = 0; position < tokens.length; position += 1) {
    const token = tokens[position];
    if (token === undefined) continue;
    const termIndex = termIndexes.get(token);
    if (termIndex === undefined) continue;

    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    if (termIndex === 0) {
      latestStartByPrefix[0] = position;
    } else {
      const previousStart = latestStartByPrefix[termIndex - 1] ?? -1;
      if (previousStart >= 0) {
        latestStartByPrefix[termIndex] = Math.max(
          latestStartByPrefix[termIndex] ?? -1,
          previousStart,
        );
      }
    }

    if (termIndex === terms.length - 1 && terms.length > 1) {
      const start = latestStartByPrefix[termIndex] ?? -1;
      if (start >= 0) bestSpan = Math.min(bestSpan, position - start + 1);
    }
  }

  const proximityScore = Number.isFinite(bestSpan)
    ? Math.max(0, 2.5 - Math.max(0, bestSpan - terms.length) * 0.18)
    : 0;
  return {
    tokenCount: tokens.length,
    termFrequencies: frequencies,
    proximityScore,
  };
}

interface Candidate {
  readonly id: string;
  readonly pageId: string;
  readonly pageNumber: number;
  readonly sourcePageKey: string;
  readonly chunkIndex: number;
  readonly provenance: RetrievalResult['provenance'];
  readonly fieldLabel?: string;
  readonly text: string;
  readonly normalizedText: string;
  readonly tokenCount: number;
  readonly termFrequencies: ReadonlyMap<string, number>;
  readonly proximityScore: number;
}

interface IndexedFormChunk extends IndexedChunk {
  readonly passageId: string;
  readonly pageId: string;
  readonly sourcePageKey: string;
  readonly fieldLabel: string;
}

interface FormIndexProjection {
  readonly chunks: readonly IndexedFormChunk[];
  readonly characters: number;
  readonly passageCount: number;
  readonly omittedPassages: number;
  readonly chunkLimitReached: boolean;
}

export class LocalPdfRetrievalIndex {
  private readonly sourcePages = new Map<string, IndexedSourcePage>();
  private readonly committedFormPassages = new Map<
    string,
    CommittedFormPassage
  >();
  private formInputOmittedPassages = 0;
  private blockedSourcePages = new Set<string>();
  private generation = 1;
  private chunkLimitReached = false;

  getStats(): RetrievalIndexStats {
    const pages = [...this.sourcePages.values()];
    const sourceCharacters = this.sourceCharacterCount();
    const formProjection = this.projectCommittedForms();
    return {
      generation: this.generation,
      uniqueSourcePages: pages.length,
      searchableSourcePages: pages.filter((page) => page.chunks.length > 0)
        .length,
      emptySourcePages: pages.filter(
        (page) => !page.failed && page.text.length === 0,
      ).length,
      failedSourcePages: pages.filter((page) => page.failed).length,
      truncatedSourcePages: pages.filter((page) => page.truncated).length,
      indexedFormPassages: formProjection.passageCount,
      omittedFormPassages:
        this.formInputOmittedPassages + formProjection.omittedPassages,
      formCharacters: formProjection.characters,
      characters: sourceCharacters + formProjection.characters,
      chunks:
        pages.reduce((total, page) => total + page.chunks.length, 0) +
        formProjection.chunks.length,
      chunkLimitReached:
        this.chunkLimitReached || formProjection.chunkLimitReached,
    };
  }

  clear(): void {
    this.sourcePages.clear();
    this.committedFormPassages.clear();
    this.formInputOmittedPassages = 0;
    this.blockedSourcePages.clear();
    this.chunkLimitReached = false;
    this.generation += 1;
  }

  syncWorkspace(
    pages: readonly WorkspacePage[],
    blockedSourcePages: ReadonlySet<string>,
  ): void {
    const desired = new Set(pages.map(sourcePageKey));
    const currentPageKeys = new Map(
      pages.map((page) => [page.id, sourcePageKey(page)]),
    );
    let changed = false;
    for (const key of this.sourcePages.keys()) {
      if (!desired.has(key) || blockedSourcePages.has(key)) {
        this.sourcePages.delete(key);
        changed = true;
      }
    }
    for (const [id, passage] of this.committedFormPassages) {
      const currentKey = currentPageKeys.get(passage.pageId);
      if (
        currentKey !== passage.sourcePageKey ||
        blockedSourcePages.has(passage.sourcePageKey)
      ) {
        this.committedFormPassages.delete(id);
        changed = true;
      }
    }
    this.blockedSourcePages = new Set(blockedSourcePages);
    if (changed) {
      this.rebuildChunks();
      this.generation += 1;
    }
  }

  setCommittedFormPassages(passages: readonly CommittedFormPassage[]): void {
    const next = new Map<string, CommittedFormPassage>();
    let characters = 0;
    let omitted = 0;
    for (const passage of passages) {
      if (next.size >= RETRIEVAL_LIMITS.maxCommittedFormPassages) {
        omitted += 1;
        continue;
      }
      if (this.blockedSourcePages.has(passage.sourcePageKey)) {
        omitted += 1;
        continue;
      }
      const remaining =
        RETRIEVAL_LIMITS.maxCommittedFormCharacters - characters;
      if (remaining <= 0) {
        omitted += 1;
        continue;
      }
      const text = passage.text.slice(0, remaining);
      if (text.length < passage.text.length) omitted += 1;
      characters += text.length;
      next.set(passage.id, { ...passage, text });
    }
    const previous = [...this.committedFormPassages.values()];
    const current = [...next.values()];
    if (
      JSON.stringify(previous) !== JSON.stringify(current) ||
      omitted !== this.formInputOmittedPassages
    ) {
      this.committedFormPassages.clear();
      for (const [id, passage] of next)
        this.committedFormPassages.set(id, passage);
      this.formInputOmittedPassages = omitted;
      this.generation += 1;
    }
  }

  async ensureIndexed(
    pages: readonly WorkspacePage[],
    blockedSourcePages: ReadonlySet<string>,
    extractPageText: PageTextExtractor,
    signal: AbortSignal,
    onProgress?: (progress: RetrievalIndexProgress) => void,
  ): Promise<RetrievalIndexSummary> {
    this.syncWorkspace(pages, blockedSourcePages);
    const boundedPages = pages.slice(
      0,
      RETRIEVAL_LIMITS.maxWorkspacePageOccurrences,
    );
    const firstPageBySource = new Map<string, WorkspacePage>();
    for (const page of boundedPages) {
      const key = sourcePageKey(page);
      if (!blockedSourcePages.has(key) && !firstPageBySource.has(key)) {
        firstPageBySource.set(key, page);
      }
    }

    const requested = [...firstPageBySource];
    const totalPages = requested.length;
    let completedPages = requested.filter(([key]) =>
      this.sourcePages.has(key),
    ).length;
    let sourceCharacters = this.sourceCharacterCount();
    let addedPage = false;
    let limitReached = pages.length > boundedPages.length;
    const failedKeys = new Set<string>();

    onProgress?.({
      completedPages,
      totalPages,
      characters: this.getStats().characters,
    });

    for (const [key, page] of requested) {
      if (signal.aborted)
        throw new DOMException('Search cancelled.', 'AbortError');
      if (this.sourcePages.has(key)) continue;
      if (this.sourcePages.size >= RETRIEVAL_LIMITS.maxUniqueSourcePages) {
        limitReached = true;
        break;
      }
      const remainingCharacters =
        RETRIEVAL_LIMITS.maxWorkspaceCharacters - sourceCharacters;
      if (remainingCharacters <= 0) {
        limitReached = true;
        break;
      }

      const maximumCharacters = Math.min(
        RETRIEVAL_LIMITS.maxCharactersPerSourcePage,
        remainingCharacters,
      );
      let extracted: PageTextExtraction = { text: '', truncated: false };
      let failed = false;
      try {
        extracted = await extractPageText(page, maximumCharacters, signal);
      } catch (error) {
        if (
          signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          throw new DOMException('Search cancelled.', 'AbortError');
        }
        failed = true;
        failedKeys.add(key);
      }
      if (signal.aborted)
        throw new DOMException('Search cancelled.', 'AbortError');

      const text = extracted.text.slice(0, maximumCharacters);
      this.sourcePages.set(key, {
        key,
        text,
        truncated:
          extracted.truncated || extracted.text.length > maximumCharacters,
        failed,
        chunks: [],
      });
      sourceCharacters += text.length;
      completedPages += 1;
      addedPage = true;
      onProgress?.({
        completedPages,
        totalPages,
        characters: this.getStats().characters,
      });

      // PDF.js streams from its worker, but yield between pages so a large
      // workspace never becomes one long UI task.
      await yieldToBrowser();
      if (signal.aborted)
        throw new DOMException('Search cancelled.', 'AbortError');
    }

    if (addedPage) {
      this.rebuildChunks();
      this.generation += 1;
    }

    const stats = this.getStats();
    const includedOccurrences = pages.filter((page) =>
      this.sourcePages.has(sourcePageKey(page)),
    ).length;
    const excludedPages = pages.filter((page) =>
      blockedSourcePages.has(sourcePageKey(page)),
    ).length;
    const eligibleOccurrences = pages.length - excludedPages;
    const unindexedPages = Math.max(
      0,
      eligibleOccurrences - includedOccurrences,
    );
    return {
      ...stats,
      workspacePages: pages.length,
      excludedPages,
      unindexedPages,
      partial:
        limitReached ||
        unindexedPages > 0 ||
        failedKeys.size > 0 ||
        stats.failedSourcePages > 0 ||
        stats.truncatedSourcePages > 0 ||
        stats.omittedFormPassages > 0 ||
        stats.chunkLimitReached ||
        pages.length > RETRIEVAL_LIMITS.maxWorkspacePageOccurrences,
    };
  }

  search(
    input: string,
    pages: readonly WorkspacePage[],
    blockedSourcePages: ReadonlySet<string>,
  ):
    | { readonly ok: true; readonly response: RetrievalSearchResponse }
    | {
        readonly ok: false;
        readonly reason: RetrievalQueryError;
      } {
    const parsed = parseRetrievalQuery(input);
    if (!parsed.ok) return parsed;
    const query = parsed.query;
    if (query.pageNumber !== null && query.pageNumber > pages.length) {
      return { ok: false, reason: 'invalid-page-filter' };
    }

    this.syncWorkspace(pages, blockedSourcePages);
    const candidates: Candidate[] = [];
    let projectionLimited = false;
    pageProjection: for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      if (!page) continue;
      const sourceKey = sourcePageKey(page);
      if (blockedSourcePages.has(sourceKey)) continue;
      const indexed = this.sourcePages.get(sourceKey);
      if (!indexed || indexed.failed) continue;
      const pageNumber = index + 1;
      if (query.pageNumber !== null && query.pageNumber !== pageNumber)
        continue;
      for (const chunk of indexed.chunks) {
        if (candidates.length >= RETRIEVAL_LIMITS.maxChunks) {
          projectionLimited = true;
          break pageProjection;
        }
        if (!chunk.normalizedText) continue;
        const stats = candidateSearchStats(chunk.normalizedText, query.terms);
        candidates.push({
          id: `${page.id}:source:${chunk.index}`,
          pageId: page.id,
          pageNumber,
          sourcePageKey: sourceKey,
          chunkIndex: chunk.index,
          provenance: 'source-pdf',
          text: chunk.text,
          normalizedText: chunk.normalizedText,
          ...stats,
        });
      }
    }

    const pageNumbers = new Map(
      pages.map((page, index) => [page.id, index + 1]),
    );
    for (const chunk of this.projectCommittedForms().chunks) {
      const pageNumber = pageNumbers.get(chunk.pageId);
      if (
        pageNumber === undefined ||
        blockedSourcePages.has(chunk.sourcePageKey) ||
        (query.pageNumber !== null && query.pageNumber !== pageNumber)
      ) {
        continue;
      }
      if (candidates.length >= RETRIEVAL_LIMITS.maxChunks) {
        projectionLimited = true;
        break;
      }
      const stats = candidateSearchStats(chunk.normalizedText, query.terms);
      candidates.push({
        id: `${chunk.pageId}:form:${chunk.passageId}:${chunk.index}`,
        pageId: chunk.pageId,
        pageNumber,
        sourcePageKey: chunk.sourcePageKey,
        chunkIndex: chunk.index,
        provenance: 'committed-form-value',
        fieldLabel: chunk.fieldLabel,
        text: chunk.text,
        normalizedText: chunk.normalizedText,
        ...stats,
      });
    }

    const documentFrequency = new Map<string, number>();
    for (const candidate of candidates) {
      for (const term of query.terms) {
        if (candidate.termFrequencies.has(term))
          documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }
    const averageLength =
      candidates.length > 0
        ? candidates.reduce((sum, candidate) => sum + candidate.tokenCount, 0) /
          candidates.length
        : 1;

    const ranked = candidates.flatMap((candidate) => {
      const matchedTerms = query.terms.filter((term) =>
        candidate.termFrequencies.has(term),
      );
      const exactPhraseMatched = Boolean(
        query.normalizedPhrase &&
        candidate.normalizedText.includes(query.normalizedPhrase),
      );
      if (matchedTerms.length === 0 && !exactPhraseMatched) return [];
      if (query.normalizedPhrase && !exactPhraseMatched) return [];

      let score = 0;
      for (const term of matchedTerms) {
        const frequency = candidate.termFrequencies.get(term) ?? 0;
        const documentCount = documentFrequency.get(term) ?? 0;
        const inverseFrequency = Math.log(
          1 + (candidates.length - documentCount + 0.5) / (documentCount + 0.5),
        );
        const lengthRatio = candidate.tokenCount / averageLength;
        score +=
          inverseFrequency *
          ((frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * lengthRatio)));
      }
      score +=
        query.terms.length > 0
          ? (matchedTerms.length / query.terms.length) * 2
          : 0;
      score += candidate.proximityScore;
      if (query.normalizedPhrase) score += 8;

      const reason = query.normalizedPhrase
        ? 'Exact phrase matched'
        : matchedTerms.length === query.terms.length && matchedTerms.length > 1
          ? `All ${matchedTerms.length} search terms matched`
          : matchedTerms.length > 1
            ? `Matched ${matchedTerms.length} of ${query.terms.length} search terms`
            : `Matched “${matchedTerms[0] ?? 'phrase'}”`;
      return [
        {
          id: candidate.id,
          pageId: candidate.pageId,
          sourcePageKey: candidate.sourcePageKey,
          chunkIndex: candidate.chunkIndex,
          provenance: candidate.provenance,
          ...(candidate.fieldLabel ? { fieldLabel: candidate.fieldLabel } : {}),
          excerpt: excerptAroundMatch(
            candidate.text,
            query.terms,
            RETRIEVAL_LIMITS.maxExcerptCharacters,
          ),
          matchReason: reason,
          matchedTerms,
          score,
          pageNumber: candidate.pageNumber,
        },
      ];
    });

    ranked.sort(
      (left, right) =>
        right.score - left.score ||
        left.pageNumber - right.pageNumber ||
        left.chunkIndex - right.chunkIndex ||
        left.pageId.localeCompare(right.pageId) ||
        left.id.localeCompare(right.id),
    );
    const totalMatches = ranked.length;
    const bounded = ranked.slice(0, RETRIEVAL_LIMITS.maxSearchResults);
    return {
      ok: true,
      response: {
        results: bounded.map(
          ({ pageNumber: _pageNumber, ...result }) => result,
        ),
        totalMatches,
        limited: totalMatches > bounded.length || projectionLimited,
      },
    };
  }

  private rebuildChunks(): void {
    const pages = [...this.sourcePages.values()];
    const repeatedLines = headerFooterLines(pages);
    let remaining = RETRIEVAL_LIMITS.maxChunks;
    this.chunkLimitReached = false;
    for (const page of pages) {
      const bodyText = stripHeaderFooterLines(page.text, repeatedLines);
      const chunks = makeChunks(bodyText, remaining + 1);
      page.chunks = chunks.slice(0, remaining);
      if (chunks.length > remaining) this.chunkLimitReached = true;
      remaining -= page.chunks.length;
    }
  }

  private sourceCharacterCount(): number {
    return [...this.sourcePages.values()].reduce(
      (total, page) => total + page.text.length,
      0,
    );
  }

  private projectCommittedForms(): FormIndexProjection {
    const sourcePages = [...this.sourcePages.values()];
    let remainingCharacters = Math.max(
      0,
      RETRIEVAL_LIMITS.maxWorkspaceCharacters - this.sourceCharacterCount(),
    );
    let remainingChunks = Math.max(
      0,
      RETRIEVAL_LIMITS.maxChunks -
        sourcePages.reduce((total, page) => total + page.chunks.length, 0),
    );
    let characters = 0;
    let passageCount = 0;
    let omittedPassages = 0;
    let chunkLimitReached = false;
    const chunks: IndexedFormChunk[] = [];

    for (const passage of this.committedFormPassages.values()) {
      if (this.blockedSourcePages.has(passage.sourcePageKey)) {
        omittedPassages += 1;
        continue;
      }
      if (remainingCharacters <= 0 || remainingChunks <= 0) {
        omittedPassages += 1;
        chunkLimitReached ||= remainingChunks <= 0;
        continue;
      }
      const text = passage.text.slice(0, remainingCharacters);
      const projected = makeChunks(text, remainingChunks + 1);
      const accepted = projected.slice(0, remainingChunks);
      if (
        text.length < passage.text.length ||
        projected.length > accepted.length
      ) {
        omittedPassages += 1;
        chunkLimitReached ||= projected.length > accepted.length;
      }
      if (accepted.length === 0) {
        omittedPassages += 1;
        continue;
      }
      passageCount += 1;
      for (const chunk of accepted) {
        chunks.push({
          ...chunk,
          passageId: passage.id,
          pageId: passage.pageId,
          sourcePageKey: passage.sourcePageKey,
          fieldLabel: passage.fieldLabel,
        });
      }
      characters += text.length;
      remainingCharacters -= text.length;
      remainingChunks -= accepted.length;
    }

    return {
      chunks,
      characters,
      passageCount,
      omittedPassages,
      chunkLimitReached,
    };
  }
}
