import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';

import {
  asSupportedNativeTextFont,
  assertValidNativeReplacementText,
  encodeReplacementMatrix,
  escapePdfLiteralString,
  parseStrictNativeTextRuns,
  replaceContentRanges,
  type ParsedNativeTextRun,
} from './contentStream';
import {
  NativeTextEditError,
  type NativeTextEdit,
  type NativeTextRunIdentity,
  type NativeTextSelectionProof,
  type NativeTextSelectionResult,
  type NativeTextVisualRun,
  type SupportedNativeTextFont,
} from './types';

const MAX_COMPRESSED_CONTENT_BYTES = 256 * 1024;
const MAX_DECODED_CONTENT_BYTES = 1_000_000;
const INFLATE_TIMEOUT_MS = 5_000;
const INPUT_CHUNK_BYTES = 1024;
export const MAX_NATIVE_TEXT_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_NATIVE_TEXT_INDIRECT_OBJECTS = 10_000;
const MAX_NATIVE_TEXT_GRAPH_NODES = 50_000;
const MAX_NATIVE_TEXT_REFERENCE_SCAN_NODES = 100_000;
const MAX_SELECTION_PROOF_RUNS = 1_000;
const PDF_JS_TRANSFORM_EPSILON = 0.001;

interface InspectedRun extends ParsedNativeTextRun {
  readonly fontBaseName: SupportedNativeTextFont;
}

interface InspectedPage {
  readonly streamRef: PDFRef;
  readonly decodedBytes: Uint8Array;
  readonly streamFingerprint: string;
  readonly runs: readonly InspectedRun[];
}

function unsupported(message: string): never {
  throw new NativeTextEditError('unsupported-content', message);
}

function resourceLimit(message: string): never {
  throw new NativeTextEditError('resource-limit', message);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new NativeTextEditError(
      'aborted',
      'Source-text verification was cancelled.',
    );
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

async function fingerprint(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)));
}

function isSameReference(left: PDFRef, right: PDFRef): boolean {
  return left.tag === right.tag;
}

/** Keeps native inspection bounded even when a caller bypasses the UI. */
export function assertNativeTextSourceBytesWithinLimit(
  bytes: Uint8Array,
): void {
  if (bytes.byteLength > MAX_NATIVE_TEXT_SOURCE_BYTES) {
    resourceLimit(
      'This PDF is too large for Kagaz’s bounded source-text editing inspection.',
    );
  }
}

/** Allows export to reject a large File before materializing its ArrayBuffer. */
export function assertNativeTextSourceFileWithinLimit(sourceFile: File): void {
  if (sourceFile.size > MAX_NATIVE_TEXT_SOURCE_BYTES) {
    resourceLimit(
      'This PDF is too large for Kagaz’s bounded source-text editing inspection.',
    );
  }
}

function resolveDict(
  document: PDFDocument,
  value: PDFObject | undefined,
): PDFDict | null {
  if (value instanceof PDFDict) return value;
  if (value instanceof PDFRef)
    return document.context.lookupMaybe(value, PDFDict) ?? null;
  return null;
}

function resolveName(
  document: PDFDocument,
  value: PDFObject | undefined,
): PDFName | null {
  if (value instanceof PDFName) return value;
  if (value instanceof PDFRef)
    return document.context.lookupMaybe(value, PDFName) ?? null;
  return null;
}

function resolveNumber(
  document: PDFDocument,
  value: PDFObject | undefined,
): PDFNumber | null {
  if (value instanceof PDFNumber) return value;
  if (value instanceof PDFRef)
    return document.context.lookupMaybe(value, PDFNumber) ?? null;
  return null;
}

function assertDefaultPageUserUnit(document: PDFDocument, page: PDFPage): void {
  const userUnit = page.node.get(PDFName.of('UserUnit'));
  if (!userUnit) return;
  const value = resolveNumber(document, userUnit)?.asNumber();
  if (value !== 1) {
    unsupported(
      'This page uses non-default PDF user units, so Kagaz cannot safely express text movement in points.',
    );
  }
}

interface TraversalBudget {
  nodes: number;
  readonly limit: number;
  readonly limitMessage: string;
}

function enqueueTraversalObject(
  pending: PDFObject[],
  object: PDFObject,
  budget: TraversalBudget,
): void {
  budget.nodes += 1;
  if (budget.nodes > budget.limit) resourceLimit(budget.limitMessage);
  pending.push(object);
}

/**
 * Add children incrementally. Never spread a PDFArray into `pending`: a
 * malicious direct array could otherwise allocate or hit an argument limit
 * before the graph budget has a chance to reject it.
 */
function appendDirectChildren(
  object: PDFObject,
  pending: PDFObject[],
  budget: TraversalBudget,
): void {
  if (object instanceof PDFArray) {
    for (const child of object.asArray())
      enqueueTraversalObject(pending, child, budget);
    return;
  }
  const dictionary = object instanceof PDFRawStream ? object.dict : object;
  if (dictionary instanceof PDFDict) {
    for (const [, value] of dictionary.entries())
      enqueueTraversalObject(pending, value, budget);
  }
}

/**
 * Reject oversized object graphs before any native-edit signature, action, or
 * content-ownership traversal. Export calls this again because its public
 * boundary can be invoked without first resolving a browser selection.
 */
export function assertNativeTextDocumentWithinLimits(
  document: PDFDocument,
  signal?: AbortSignal,
): void {
  const pending: PDFObject[] = [];
  const budget: TraversalBudget = {
    nodes: 0,
    limit: MAX_NATIVE_TEXT_GRAPH_NODES,
    limitMessage:
      'This PDF has an object graph that is too complex for safe source-text editing.',
  };
  let indirectObjects = 0;
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    indirectObjects += 1;
    if (indirectObjects > MAX_NATIVE_TEXT_INDIRECT_OBJECTS) {
      resourceLimit(
        'This PDF has too many objects for safe source-text editing inspection.',
      );
    }
    enqueueTraversalObject(pending, object, budget);
  }
  const visited = new Set<PDFObject>();
  while (pending.length > 0) {
    if (budget.nodes % 256 === 0) throwIfAborted(signal);
    const object = pending.pop();
    if (!object || object instanceof PDFRef || visited.has(object)) continue;
    visited.add(object);
    appendDirectChildren(object, pending, budget);
  }
}

function countReferencesInObject(
  object: PDFObject,
  target: PDFRef,
  scanBudget: TraversalBudget,
): number {
  const pending: PDFObject[] = [];
  enqueueTraversalObject(pending, object, scanBudget);
  const visited = new Set<PDFObject>();
  let references = 0;
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate) continue;
    if (candidate instanceof PDFRef) {
      if (isSameReference(candidate, target)) references += 1;
      continue;
    }
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    appendDirectChildren(candidate, pending, scanBudget);
  }
  return references;
}

/** Reject reusable content streams before selecting any source operand. */
function assertStreamHasSingleReference(
  document: PDFDocument,
  target: PDFRef,
): void {
  let references = 0;
  const scanBudget: TraversalBudget = {
    nodes: 0,
    limit: MAX_NATIVE_TEXT_REFERENCE_SCAN_NODES,
    limitMessage:
      'This PDF is too complex to prove source-text stream ownership safely.',
  };
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    references += countReferencesInObject(object, target, scanBudget);
    if (references > 1) {
      throw new NativeTextEditError(
        'unsupported-content',
        'This page shares its source content with another PDF object, so Kagaz will not edit it.',
      );
    }
  }
  if (references !== 1) {
    throw new NativeTextEditError(
      'unsupported-content',
      'Kagaz could not prove that this source text belongs to one page.',
    );
  }
}

function filterName(stream: PDFRawStream): string | null {
  const filter = stream.dict.get(PDFName.of('Filter'));
  if (!filter) return null;
  if (!(filter instanceof PDFName)) {
    unsupported(
      'This PDF uses a content-stream filter that Kagaz cannot safely inspect.',
    );
  }
  return filter.decodeText();
}

function assertSupportedStreamEncoding(stream: PDFRawStream): void {
  const filter = filterName(stream);
  if (filter !== null && filter !== 'FlateDecode') {
    unsupported(
      'This PDF uses a content-stream filter that Kagaz cannot safely inspect.',
    );
  }
  if (stream.dict.has(PDFName.of('DecodeParms'))) {
    unsupported(
      'This PDF uses content-stream decode parameters that Kagaz cannot safely inspect.',
    );
  }
  if (stream.getContentsSize() > MAX_COMPRESSED_CONTENT_BYTES) {
    throw new NativeTextEditError(
      'resource-limit',
      'This page content is too large for safe source-text editing.',
    );
  }
}

async function decodeFlateBounded(
  compressed: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  if (typeof DecompressionStream === 'undefined') {
    unsupported(
      'This browser cannot safely inspect compressed PDF text content.',
    );
  }
  let offset = 0;
  const input = new ReadableStream<BufferSource>({
    pull(controller) {
      if (offset >= compressed.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + INPUT_CHUNK_BYTES, compressed.length);
      controller.enqueue(compressed.slice(offset, end));
      offset = end;
    },
  });
  const reader = input
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader();
  const cancelOnAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', cancelOnAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, INFLATE_TIMEOUT_MS);
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      if (timedOut) {
        throw new NativeTextEditError(
          'resource-limit',
          'This PDF content took too long to inspect safely.',
        );
      }
      if (done) break;
      length += value.byteLength;
      if (length > MAX_DECODED_CONTENT_BYTES) {
        throw new NativeTextEditError(
          'resource-limit',
          'This PDF content expands beyond Kagaz’s safe source-text editing limit.',
        );
      }
      chunks.push(Uint8Array.from(value));
    }
  } catch (error) {
    if (error instanceof NativeTextEditError) throw error;
    throwIfAborted(signal);
    unsupported('This PDF contains invalid compressed text content.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancelOnAbort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const decoded = new Uint8Array(length);
  let destination = 0;
  for (const chunk of chunks) {
    decoded.set(chunk, destination);
    destination += chunk.length;
  }
  return decoded;
}

async function decodedStreamBytes(
  stream: PDFRawStream,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  assertSupportedStreamEncoding(stream);
  const encoded = Uint8Array.from(stream.getContents());
  return filterName(stream) === 'FlateDecode'
    ? decodeFlateBounded(encoded, signal)
    : encoded;
}

function requireDirectPageResources(page: PDFPage): PDFObject {
  const resources = page.node.get(PDFName.Resources);
  if (!resources) {
    unsupported(
      'This page inherits resources, so its source text cannot be safely edited.',
    );
  }
  return resources;
}

function supportedFontForRun(
  document: PDFDocument,
  resources: PDFDict,
  run: ParsedNativeTextRun,
): SupportedNativeTextFont {
  const resourceKeys = new Set(resources.keys().map((key) => key.decodeText()));
  for (const key of resourceKeys) {
    if (key !== 'Font' && key !== 'ProcSet') {
      unsupported(
        'This page has non-text resources that Kagaz will not rewrite in source-text mode.',
      );
    }
  }
  const fontResources = resolveDict(document, resources.get(PDFName.Font));
  if (!fontResources) {
    throw new NativeTextEditError(
      'unsupported-font',
      'Kagaz could not verify the source font for this text.',
    );
  }
  const font = resolveDict(
    document,
    fontResources.get(PDFName.of(run.fontResourceName)),
  );
  if (!font) {
    throw new NativeTextEditError(
      'unsupported-font',
      'Kagaz could not verify the source font for this text.',
    );
  }
  const subtype = resolveName(
    document,
    font.get(PDFName.of('Subtype')),
  )?.decodeText();
  const baseFont = resolveName(
    document,
    font.get(PDFName.of('BaseFont')),
  )?.decodeText();
  const supported = baseFont ? asSupportedNativeTextFont(baseFont) : null;
  if (subtype !== 'Type1' || !supported) {
    throw new NativeTextEditError(
      'unsupported-font',
      'Only verified Standard-14 Latin source fonts can be edited in this version of Kagaz.',
    );
  }
  if (
    font.has(PDFName.of('ToUnicode')) ||
    font.has(PDFName.of('FontDescriptor')) ||
    font.has(PDFName.of('Widths')) ||
    font.has(PDFName.of('FirstChar')) ||
    font.has(PDFName.of('LastChar'))
  ) {
    throw new NativeTextEditError(
      'unsupported-font',
      'This source font has custom glyph data or Unicode mapping that Kagaz cannot safely rewrite.',
    );
  }
  const encoding = font.get(PDFName.of('Encoding'));
  const encodingName = resolveName(document, encoding)?.decodeText() ?? null;
  if (
    encoding !== undefined &&
    encodingName !== 'WinAnsiEncoding' &&
    encodingName !== 'StandardEncoding' &&
    encodingName !== 'MacRomanEncoding'
  ) {
    throw new NativeTextEditError(
      'unsupported-font',
      'This source font uses an unverified character encoding.',
    );
  }
  return supported;
}

async function inspectPage(
  document: PDFDocument,
  sourcePageIndex: number,
  signal?: AbortSignal,
): Promise<InspectedPage> {
  throwIfAborted(signal);
  if (
    !Number.isInteger(sourcePageIndex) ||
    sourcePageIndex < 0 ||
    sourcePageIndex >= document.getPageCount()
  ) {
    throw new NativeTextEditError(
      'identity-mismatch',
      'The selected source page is no longer available.',
    );
  }
  const page = document.getPage(sourcePageIndex);
  assertDefaultPageUserUnit(document, page);
  const contents = page.node.get(PDFName.Contents);
  if (!(contents instanceof PDFRef)) {
    unsupported(
      'This page does not have one independently addressable source content stream.',
    );
  }
  const streamObject = document.context.lookup(contents);
  if (!(streamObject instanceof PDFRawStream)) {
    unsupported('This page does not have one editable PDF content stream.');
  }
  const stream = streamObject;
  assertStreamHasSingleReference(document, contents);
  const resources = resolveDict(document, requireDirectPageResources(page));
  if (!resources) {
    unsupported(
      'This page resources cannot be safely verified for source-text editing.',
    );
  }
  const decodedBytes = await decodedStreamBytes(stream, signal);
  throwIfAborted(signal);
  const parsedRuns = parseStrictNativeTextRuns(decodedBytes);
  const runs = parsedRuns.map((run) => ({
    ...run,
    fontBaseName: supportedFontForRun(document, resources, run),
  }));
  return {
    streamRef: contents,
    decodedBytes,
    streamFingerprint: await fingerprint(decodedBytes),
    runs,
  };
}

function matricesMatch(
  left: readonly [number, number, number, number, number, number],
  right: readonly [number, number, number, number, number, number],
): boolean {
  return left.every((value, index) => value === right[index]);
}

function identityFor(
  page: InspectedPage,
  run: InspectedRun,
  sourceFileFingerprint: string,
): NativeTextRunIdentity {
  const textMatrix: NativeTextRunIdentity['textMatrix'] = [...run.textMatrix];
  return Object.freeze({
    sourceFileFingerprint,
    streamFingerprint: page.streamFingerprint,
    runOrdinal: run.ordinal,
    originalText: run.text,
    fontResourceName: run.fontResourceName,
    fontBaseName: run.fontBaseName,
    fontSize: run.fontSize,
    textMatrix: Object.freeze(textMatrix),
  });
}

function findIdentityRun(
  page: InspectedPage,
  identity: NativeTextRunIdentity,
): InspectedRun {
  if (page.streamFingerprint !== identity.streamFingerprint) {
    throw new NativeTextEditError(
      'identity-mismatch',
      'The selected source text changed before export, so Kagaz did not modify it.',
    );
  }
  const run = page.runs[identity.runOrdinal];
  if (
    !run ||
    run.text !== identity.originalText ||
    run.fontResourceName !== identity.fontResourceName ||
    run.fontBaseName !== identity.fontBaseName ||
    run.fontSize !== identity.fontSize ||
    !matricesMatch(run.textMatrix, identity.textMatrix)
  ) {
    throw new NativeTextEditError(
      'identity-mismatch',
      'Kagaz could not verify the original source text operand before export.',
    );
  }
  return run;
}

function approximatelyEqual(left: number, right: number): boolean {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <=
      PDF_JS_TRANSFORM_EPSILON * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validVisualRun(value: unknown): value is NativeTextVisualRun {
  if (!isRecord(value) || typeof value.text !== 'string' || !value.text)
    return false;
  const transform = value.transform;
  return (
    Array.isArray(transform) &&
    transform.length === 6 &&
    transform.every(
      (entry) => typeof entry === 'number' && Number.isFinite(entry),
    )
  );
}

function validVisualRunList(
  value: unknown,
): value is readonly NativeTextVisualRun[] {
  return Array.isArray(value) && value.every(validVisualRun);
}

/**
 * Our strict grammar has one Tj per independent BT/ET object. PDF.js must
 * expose the same complete sequence, in source user space, or no source
 * operand is safe to identify from a browser selection.
 */
function resolveVisualProofRun(
  page: InspectedPage,
  selection: NativeTextSelectionProof,
): InspectedRun {
  const selectionRuns: unknown = selection.runs;
  if (
    !Number.isInteger(selection?.selectedRunIndex) ||
    !validVisualRunList(selectionRuns) ||
    selectionRuns.length === 0 ||
    selectionRuns.length > MAX_SELECTION_PROOF_RUNS ||
    selectionRuns.length !== page.runs.length ||
    selection.selectedRunIndex < 0 ||
    selection.selectedRunIndex >= selectionRuns.length
  ) {
    throw new NativeTextEditError(
      'invalid-selection',
      'Select one complete rendered source-text run to edit it.',
    );
  }
  for (const [index, visual] of selectionRuns.entries()) {
    const run = page.runs[index];
    if (!run) {
      throw new NativeTextEditError(
        'invalid-selection',
        'Kagaz could not verify the selected rendered source-text run.',
      );
    }
    const [a, b, c, d, e, f] = visual.transform;
    const [, , , , x, y] = run.textMatrix;
    if (
      visual.text !== run.text ||
      !approximatelyEqual(a, run.fontSize) ||
      !approximatelyEqual(b, 0) ||
      !approximatelyEqual(c, 0) ||
      !approximatelyEqual(d, run.fontSize) ||
      !approximatelyEqual(e, x) ||
      !approximatelyEqual(f, y)
    ) {
      throw new NativeTextEditError(
        'invalid-selection',
        'Kagaz could not prove that this rendered selection matches one original source-text run.',
      );
    }
  }
  const selected = page.runs[selection.selectedRunIndex];
  if (!selected) {
    throw new NativeTextEditError(
      'invalid-selection',
      'Kagaz could not resolve this source-text selection.',
    );
  }
  return selected;
}

export async function resolveNativeTextSelection(
  sourceFile: File,
  sourcePageIndex: number,
  selection: NativeTextSelectionProof,
  signal?: AbortSignal,
): Promise<NativeTextSelectionResult> {
  throwIfAborted(signal);
  const selectedText = selection?.runs?.[selection.selectedRunIndex]?.text;
  if (!selectedText || /[^\x20-\x7e]/u.test(selectedText)) {
    throw new NativeTextEditError(
      'invalid-selection',
      'Select one complete printable Latin source-text run to edit it.',
    );
  }
  assertNativeTextSourceFileWithinLimit(sourceFile);
  let document: PDFDocument;
  let sourceBytes: Uint8Array;
  try {
    sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());
  } catch {
    throwIfAborted(signal);
    throw new NativeTextEditError(
      'source-load-failed',
      'Kagaz could not inspect this PDF source text safely.',
    );
  }
  assertNativeTextSourceBytesWithinLimit(sourceBytes);
  throwIfAborted(signal);
  try {
    const { PDFDocument } = await import('pdf-lib');
    document = await PDFDocument.load(sourceBytes, {
      throwOnInvalidObject: true,
      ignoreEncryption: true,
    });
  } catch {
    throwIfAborted(signal);
    throw new NativeTextEditError(
      'source-load-failed',
      'Kagaz could not inspect this PDF source text safely.',
    );
  }
  if (document.isEncrypted) {
    throw new NativeTextEditError(
      'unsupported-content',
      'Password-protected PDFs cannot be edited in source-text mode.',
    );
  }
  assertNativeTextDocumentWithinLimits(document, signal);
  throwIfAborted(signal);
  const signatureSafety = await import('../pdf-signatures/signatureSafety');
  try {
    signatureSafety.assertNoDigitalSignature(document);
    signatureSafety.assertNoExecutableActions(document);
  } catch (reason: unknown) {
    throw new NativeTextEditError(
      'unsupported-content',
      reason instanceof Error
        ? reason.message
        : 'Kagaz could not safely inspect this PDF before source-text editing.',
    );
  }
  if (document.catalog.getAcroForm()) {
    throw new NativeTextEditError(
      'form-conflict',
      'Source-text editing is unavailable for PDFs with form structures.',
    );
  }
  const page = await inspectPage(document, sourcePageIndex, signal);
  if (
    page.runs.filter((candidate) => candidate.text === selectedText).length > 1
  ) {
    throw new NativeTextEditError(
      'ambiguous-run',
      'This page contains more than one identical source-text run, so Kagaz cannot prove that a replacement removes the selected original text.',
    );
  }
  const run = resolveVisualProofRun(page, selection);
  return { identity: identityFor(page, run, await fingerprint(sourceBytes)) };
}

/** Verifies that a staged edit still targets the exact bytes selected by the user. */
export async function assertNativeTextEditsMatchSourceBytes(
  edits: readonly NativeTextEdit[],
  sourceBytes: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  assertNativeTextSourceBytesWithinLimit(sourceBytes);
  const sourceFileFingerprint = await fingerprint(sourceBytes);
  throwIfAborted(signal);
  if (
    edits.some(
      (edit) => edit.identity.sourceFileFingerprint !== sourceFileFingerprint,
    )
  ) {
    throw new NativeTextEditError(
      'identity-mismatch',
      'The PDF source changed after the text selection was verified, so Kagaz did not modify it.',
    );
  }
}

interface RewriteTarget {
  readonly edit: NativeTextEdit;
  readonly run: InspectedRun;
  readonly replacementMatrix: NativeTextRunIdentity['textMatrix'];
}

function replacementMatrixFor(
  run: InspectedRun,
  edit: NativeTextEdit,
): NativeTextRunIdentity['textMatrix'] {
  assertValidNativeReplacementText(edit.replacementText);
  if (
    !Number.isFinite(edit.translationX) ||
    !Number.isFinite(edit.translationY)
  ) {
    throw new NativeTextEditError(
      'invalid-replacement',
      'The requested text position is invalid.',
    );
  }
  const [, , , , originalX, originalY] = run.textMatrix;
  return [
    1,
    0,
    0,
    1,
    originalX + edit.translationX,
    originalY + edit.translationY,
  ];
}

function rewriteTargets(
  inspected: InspectedPage,
  edits: readonly NativeTextEdit[],
): readonly RewriteTarget[] {
  if (edits.length === 0) {
    throw new NativeTextEditError(
      'identity-mismatch',
      'Kagaz could not find a staged source-text edit for this page.',
    );
  }
  const targetedRuns = new Set<number>();
  return edits.map((edit) => {
    if (targetedRuns.has(edit.identity.runOrdinal)) {
      throw new NativeTextEditError(
        'identity-mismatch',
        'More than one staged edit targets the same source-text run.',
      );
    }
    targetedRuns.add(edit.identity.runOrdinal);
    const run = findIdentityRun(inspected, edit.identity);
    return {
      edit,
      run,
      replacementMatrix: replacementMatrixFor(run, edit),
    };
  });
}

function assertRewrittenRuns(
  updatedRuns: readonly ParsedNativeTextRun[],
  targets: readonly RewriteTarget[],
): void {
  for (const target of targets) {
    const updated = updatedRuns[target.edit.identity.runOrdinal];
    if (
      !updated ||
      updated.text !== target.edit.replacementText ||
      !matricesMatch(updated.textMatrix, target.replacementMatrix) ||
      (target.edit.replacementText !== target.edit.identity.originalText &&
        updatedRuns.some(
          (candidate) => candidate.text === target.edit.identity.originalText,
        ))
    ) {
      throw new NativeTextEditError(
        'verification-failed',
        'Kagaz could not verify that the original source text was removed.',
      );
    }
  }
}

function isolatedPageIndex(document: PDFDocument, page: PDFPage): number {
  const index = document.getPages().indexOf(page);
  if (index < 0) {
    throw new NativeTextEditError(
      'identity-mismatch',
      'Kagaz could not locate the isolated page for this source-text edit.',
    );
  }
  return index;
}

/**
 * Mutates only a page copied into a private temporary document. All target
 * operands are resolved against one original stream before any bytes change,
 * allowing independent runs on the same workspace page to remain atomic.
 */
export async function applyNativeTextEditsToIsolatedPage(
  document: PDFDocument,
  page: PDFPage,
  edits: readonly NativeTextEdit[],
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const inspected = await inspectPage(
    document,
    isolatedPageIndex(document, page),
    signal,
  );
  const targets = rewriteTargets(inspected, edits);
  const updatedBytes = replaceContentRanges(
    inspected.decodedBytes,
    targets.flatMap((target) => [
      {
        range: target.run.matrixOperandRange,
        bytes: encodeReplacementMatrix(target.replacementMatrix),
      },
      {
        range: target.run.textTokenRange,
        bytes: escapePdfLiteralString(target.edit.replacementText),
      },
    ]),
  );
  throwIfAborted(signal);
  // Reparse before attaching the stream: malformed output never becomes part
  // of the temporary donor page.
  assertRewrittenRuns(parseStrictNativeTextRuns(updatedBytes), targets);
  const streamRef = document.context.register(
    document.context.flateStream(updatedBytes),
  );
  page.node.set(PDFName.Contents, streamRef);
}

/**
 * Verifies the private copied page before annotations or watermarks can append
 * their own content streams. This confirms each original operand is absent
 * from the page that will be copied into the final export.
 */
export async function verifyNativeTextEditsOnCopiedPage(
  document: PDFDocument,
  page: PDFPage,
  edits: readonly NativeTextEdit[],
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const inspected = await inspectPage(
    document,
    isolatedPageIndex(document, page),
    signal,
  );
  const targets = edits.map((edit) => {
    const run = inspected.runs[edit.identity.runOrdinal];
    if (!run) {
      throw new NativeTextEditError(
        'verification-failed',
        'Kagaz could not verify the copied source-text page.',
      );
    }
    const [, , , , originalX, originalY] = edit.identity.textMatrix;
    return {
      edit,
      run,
      replacementMatrix: [
        1,
        0,
        0,
        1,
        originalX + edit.translationX,
        originalY + edit.translationY,
      ] as NativeTextRunIdentity['textMatrix'],
    };
  });
  assertRewrittenRuns(inspected.runs, targets);
}

/** Compatibility wrapper for callers that have exactly one target run. */
export function applyNativeTextEditToIsolatedPage(
  document: PDFDocument,
  page: PDFPage,
  edit: NativeTextEdit,
  signal?: AbortSignal,
): Promise<void> {
  return applyNativeTextEditsToIsolatedPage(document, page, [edit], signal);
}

/** Compatibility wrapper for callers that have exactly one target run. */
export function verifyNativeTextEditOnCopiedPage(
  document: PDFDocument,
  page: PDFPage,
  edit: NativeTextEdit,
  signal?: AbortSignal,
): Promise<void> {
  return verifyNativeTextEditsOnCopiedPage(document, page, [edit], signal);
}
