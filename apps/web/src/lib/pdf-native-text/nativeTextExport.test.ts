import { describe, expect, it } from 'vitest';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  degrees,
} from 'pdf-lib';

import { exportWorkspace } from '../pdf-export/exportWorkspace';
import type { ExportSource } from '../pdf-export/types';
import {
  createNativeTextEditHistory,
  nativeTextEditReducer,
  snapshotNativeTextEdits,
} from '../../features/pdf-native-text/model/reducer';
import type {
  NativeTextEdit,
  NativeTextSelectionProof,
  NativeTextVisualRun,
} from './types';
import { parseStrictNativeTextRuns } from './contentStream';
import {
  MAX_NATIVE_TEXT_SOURCE_BYTES,
  assertNativeTextDocumentWithinLimits,
  assertNativeTextSourceBytesWithinLimit,
  resolveNativeTextSelection,
} from './nativeTextContent';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

interface SourceRun {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fontSize?: number;
}

type PdfLiteral =
  | string
  | number
  | boolean
  | null
  | undefined
  | PdfLiteralObject
  | PdfLiteral[];

interface PdfLiteralObject {
  [name: string]: PdfLiteral;
}

function sourcePage(
  id: string,
  sourceDocumentId: string,
  sourcePageIndex: number,
  rotationDelta: 0 | 90 | 180 | 270 = 0,
) {
  return { id, sourceDocumentId, sourcePageIndex, rotationDelta } as const;
}

function plainForms(...sourceDocumentIds: readonly string[]) {
  return {
    sources: [...new Set(sourceDocumentIds)].map((sourceDocumentId) => ({
      sourceDocumentId,
      capability: 'plain' as const,
      fields: [],
    })),
    hasChangedTextDraft: false,
  };
}

function source(id: string, file: File): ExportSource {
  return { id, file, fileName: file.name };
}

function toFile(bytes: Uint8Array, name: string): File {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new File([copy], name, { type: 'application/pdf' });
}

async function fileFingerprint(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}

function isPdfJsTextItem(item: unknown): item is TextItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof item.str === 'string' &&
    'transform' in item &&
    Array.isArray(item.transform)
  );
}

function visualRunFromPdfJsItem(item: TextItem): NativeTextVisualRun {
  if (
    item.transform.length !== 6 ||
    !item.transform.every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )
  )
    throw new Error('Expected a finite six-value PDF.js text transform.');
  return {
    text: item.str,
    transform: [
      item.transform[0] as number,
      item.transform[1] as number,
      item.transform[2] as number,
      item.transform[3] as number,
      item.transform[4] as number,
      item.transform[5] as number,
    ],
  };
}

/** Builds the same complete TextItem proof that the editor passes to the resolver. */
async function selectionProofForText(
  file: File,
  text: string,
  pageIndex = 0,
  occurrence?: number,
): Promise<NativeTextSelectionProof> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  try {
    const document = await task.promise;
    const content = await (
      await document.getPage(pageIndex + 1)
    ).getTextContent({
      includeMarkedContent: true,
      disableNormalization: true,
    });
    const runs = content.items
      .filter(isPdfJsTextItem)
      .filter((item) => item.str.length > 0)
      .map(visualRunFromPdfJsItem);
    const selected = runs
      .map((run, index) => (run.text === text ? index : -1))
      .filter((index) => index >= 0);
    if (occurrence === undefined && selected.length !== 1) {
      throw new Error(`Expected exactly one PDF.js text item for ${text}.`);
    }
    const selectedRunIndex =
      occurrence === undefined ? selected[0] : selected[occurrence];
    if (selectedRunIndex === undefined) {
      throw new Error('Expected a selected PDF.js text item.');
    }
    return { selectedRunIndex, runs };
  } finally {
    await task.destroy();
  }
}

function proofForText(text: string): NativeTextSelectionProof {
  return {
    selectedRunIndex: 0,
    runs: [{ text, transform: [12, 0, 0, 12, 40, 40] }],
  };
}

function pageContent(runs: readonly SourceRun[]): string {
  return runs
    .map(
      (run) =>
        `BT\n/F1 ${run.fontSize ?? 12} Tf\n1 0 0 1 ${run.x} ${run.y} Tm\n(${run.text}) Tj\nET\n`,
    )
    .join('');
}

async function createSimpleSource(
  runs: readonly SourceRun[],
  rotation: 0 | 90 | 180 | 270 = 0,
  includeAcroForm = false,
  userUnit = 1,
): Promise<File> {
  const document = await PDFDocument.create();
  const font = document.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: 'WinAnsiEncoding',
  });
  const fontRef = document.context.register(font);
  const page = document.addPage([300, 400]);
  page.setRotation(degrees(rotation));
  if (userUnit !== 1)
    page.node.set(PDFName.of('UserUnit'), document.context.obj(userUnit));
  page.node.set(
    PDFName.Resources,
    document.context.obj({ Font: { F1: fontRef } }),
  );
  const stream = document.context.flateStream(pageContent(runs));
  page.node.set(PDFName.Contents, document.context.register(stream));
  if (includeAcroForm) {
    const formPage = document.addPage([300, 400]);
    const field = document.getForm().createTextField('unsafe-form-field');
    field.addToPage(formPage, { x: 20, y: 20, width: 120, height: 24 });
  }
  return toFile(
    await document.save({ useObjectStreams: false }),
    'eligible-source.pdf',
  );
}

async function createMultiPageSource(
  pages: readonly (readonly SourceRun[])[],
): Promise<File> {
  const document = await PDFDocument.create();
  const font = document.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: 'WinAnsiEncoding',
  });
  const fontRef = document.context.register(font);
  for (const runs of pages) {
    const page = document.addPage([300, 400]);
    page.node.set(
      PDFName.Resources,
      document.context.obj({ Font: { F1: fontRef } }),
    );
    page.node.set(
      PDFName.Contents,
      document.context.register(
        document.context.flateStream(pageContent(runs)),
      ),
    );
  }
  return toFile(
    await document.save({ useObjectStreams: false }),
    'eligible-multipage-source.pdf',
  );
}

async function createRawContentSource(
  content: Uint8Array,
  font: PdfLiteralObject = {
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'Helvetica',
    Encoding: 'WinAnsiEncoding',
  },
): Promise<File> {
  const document = await PDFDocument.create();
  const fontRef = document.context.register(document.context.obj(font));
  const page = document.addPage([300, 400]);
  page.node.set(
    PDFName.Resources,
    document.context.obj({ Font: { F1: fontRef } }),
  );
  page.node.set(
    PDFName.Contents,
    document.context.register(document.context.stream(content)),
  );
  return toFile(
    await document.save({ useObjectStreams: false }),
    'raw-content-source.pdf',
  );
}

async function resolveEdit(
  file: File,
  originalText: string,
  replacementText: string,
  translationX = 0,
  translationY = 0,
  pageId = 'edited',
  sourcePageIndex = 0,
): Promise<NativeTextEdit> {
  const { identity } = await resolveNativeTextSelection(
    file,
    sourcePageIndex,
    await selectionProofForText(file, originalText, sourcePageIndex),
  );
  return {
    id: `edit-${pageId}`,
    workspacePageId: pageId,
    sourceDocumentId: 'source',
    sourcePageIndex,
    identity,
    replacementText,
    translationX,
    translationY,
  };
}

async function exportEdit(
  file: File,
  edit: NativeTextEdit,
  pages = [sourcePage(edit.workspacePageId, 'source', 0)],
): Promise<Uint8Array> {
  return exportWorkspace({
    pages,
    sources: new Map([['source', source('source', file)]]),
    forms: plainForms('source'),
    annotationsByPage: new Map(),
    imageAssets: new Map(),
    nativeTextEdits: [edit],
  });
}

async function extractText(bytes: Uint8Array): Promise<readonly string[]> {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const document = await task.promise;
    const text: string[] = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent({ disableNormalization: true });
      text.push(
        content.items
          .filter((item) => 'str' in item)
          .map((item) => ('str' in item ? item.str : ''))
          .join(''),
      );
      page.cleanup();
    }
    return text;
  } finally {
    await task.destroy();
  }
}

async function decodedOutputStreams(bytes: Uint8Array): Promise<string[]> {
  const document = await PDFDocument.load(bytes, {
    throwOnInvalidObject: true,
  });
  return document.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : [],
    );
}

async function pageRuns(
  bytes: Uint8Array,
  pageIndex = 0,
): Promise<ReturnType<typeof parseStrictNativeTextRuns>> {
  const document = await PDFDocument.load(bytes, {
    throwOnInvalidObject: true,
  });
  const page = document.getPage(pageIndex);
  const contents = page.node.get(PDFName.Contents);
  if (!(contents && !(contents instanceof PDFDict)))
    throw new Error('Expected a direct content reference.');
  const stream = document.context.lookup(contents);
  if (!(stream instanceof PDFRawStream))
    throw new Error('Expected a raw page content stream.');
  return parseStrictNativeTextRuns(decodePDFRawStream(stream).decode());
}

describe('native source-text export', () => {
  it.each([
    ['shorter', 'NATIVE-OLD-ALPHA', 'NEW'],
    ['longer', 'NATIVE-OLD-BETA', 'NATIVE-REPLACEMENT-BETA-LONG'],
  ])(
    'genuinely replaces a %s verified Tj operand without retaining the old stream',
    async (_label, original, replacement) => {
      const file = await createSimpleSource([
        { text: original, x: 48, y: 260 },
      ]);
      const edit = await resolveEdit(file, original, replacement);
      const bytes = await exportEdit(file, edit);

      expect(await extractText(bytes)).toEqual([replacement]);
      expect((await decodedOutputStreams(bytes)).join('\n')).not.toContain(
        original,
      );
      const [run] = await pageRuns(bytes);
      expect(run?.text).toBe(replacement);
      expect(run?.textMatrix).toEqual([1, 0, 0, 1, 48, 260]);
    },
  );

  it('retains a verified non-12pt Standard-14 font while replacing its operand', async () => {
    const original = 'FONT18-OLD';
    const replacement = 'FONT18-NEW';
    const file = await createSimpleSource([
      { text: original, x: 48, y: 260, fontSize: 18 },
    ]);
    const edit = await resolveEdit(file, original, replacement);
    const bytes = await exportEdit(file, edit);

    expect(edit.identity.fontSize).toBe(18);
    expect(await extractText(bytes)).toEqual([replacement]);
    expect((await decodedOutputStreams(bytes)).join('\n')).not.toContain(
      original,
    );
    expect((await pageRuns(bytes))[0]?.fontSize).toBe(18);
  });

  it('changes only the verified page occurrence and its Tm translation', async () => {
    const original = 'NATIVE-MOVE-ORIGINAL';
    const replacement = 'NATIVE-MOVE-REPLACED';
    const file = await createSimpleSource([
      { text: original, x: 40, y: 180 },
      { text: 'UNCHANGED-SECOND-RUN', x: 40, y: 140 },
    ]);
    const edit = await resolveEdit(file, original, replacement, 35, -20);
    const bytes = await exportEdit(file, edit);

    expect(await extractText(bytes)).toEqual([
      `${replacement}UNCHANGED-SECOND-RUN`,
    ]);
    const runs = await pageRuns(bytes);
    expect(runs.map((run) => [run.text, run.textMatrix])).toEqual([
      [replacement, [1, 0, 0, 1, 75, 160]],
      ['UNCHANGED-SECOND-RUN', [1, 0, 0, 1, 40, 140]],
    ]);
  });

  it('atomically rewrites multiple independently verified runs on one page', async () => {
    const file = await createSimpleSource([
      { text: 'NATIVE-FIRST-OLD', x: 40, y: 180 },
      { text: 'NATIVE-SECOND-OLD', x: 40, y: 140 },
    ]);
    const first = await resolveEdit(
      file,
      'NATIVE-FIRST-OLD',
      'NATIVE-FIRST-NEW',
      10,
      0,
    );
    const second = await resolveEdit(
      file,
      'NATIVE-SECOND-OLD',
      'NATIVE-SECOND-NEW',
      0,
      -15,
    );
    const bytes = await exportWorkspace({
      pages: [sourcePage('edited', 'source', 0)],
      sources: new Map([['source', source('source', file)]]),
      forms: plainForms('source'),
      annotationsByPage: new Map(),
      imageAssets: new Map(),
      nativeTextEdits: [first, second],
    });

    expect(await extractText(bytes)).toEqual([
      'NATIVE-FIRST-NEWNATIVE-SECOND-NEW',
    ]);
    expect((await decodedOutputStreams(bytes)).join('\n')).not.toContain(
      'NATIVE-FIRST-OLD',
    );
    expect((await decodedOutputStreams(bytes)).join('\n')).not.toContain(
      'NATIVE-SECOND-OLD',
    );
    expect(
      (await pageRuns(bytes)).map((run) => [run.text, run.textMatrix]),
    ).toEqual([
      ['NATIVE-FIRST-NEW', [1, 0, 0, 1, 50, 180]],
      ['NATIVE-SECOND-NEW', [1, 0, 0, 1, 40, 125]],
    ]);
  });

  it('never resolves a partial visual selection to another source run with the same suffix', async () => {
    const file = await createSimpleSource([
      { text: 'PrefixSuffix', x: 40, y: 180 },
      { text: 'Suffix', x: 180, y: 140 },
    ]);
    const fullPrefixProof = await selectionProofForText(file, 'PrefixSuffix');
    const firstVisualRun = fullPrefixProof.runs[0];
    if (!firstVisualRun)
      throw new Error('Expected the PrefixSuffix visual run.');
    const partialSuffixProof: NativeTextSelectionProof = {
      selectedRunIndex: 0,
      runs: [
        { ...firstVisualRun, text: 'Suffix' },
        ...fullPrefixProof.runs.slice(1),
      ],
    };

    await expect(
      resolveNativeTextSelection(file, 0, partialSuffixProof),
    ).rejects.toMatchObject({ code: 'invalid-selection' });

    const prefix = await resolveNativeTextSelection(file, 0, fullPrefixProof);
    const suffix = await resolveNativeTextSelection(
      file,
      0,
      await selectionProofForText(file, 'Suffix'),
    );
    expect(prefix.identity.runOrdinal).toBe(0);
    expect(suffix.identity.runOrdinal).toBe(1);
  });

  it('rejects repeated source literals before staging a replacement it cannot prove removed', async () => {
    const repeated = 'NATIVE-REPEATED-LITERAL';
    const file = await createSimpleSource([
      { text: repeated, x: 40, y: 180 },
      { text: repeated, x: 180, y: 140 },
    ]);

    await expect(
      resolveNativeTextSelection(
        file,
        0,
        await selectionProofForText(file, repeated, 0, 0),
      ),
    ).rejects.toMatchObject({ code: 'ambiguous-run' });
  });

  it.each([0, 90, 180, 270] as const)(
    'preserves intrinsic rotation %s while moving source text',
    async (rotation) => {
      const original = `NATIVE-ROTATE-${rotation}`;
      const replacement = `NATIVE-ROTATE-NEW-${rotation}`;
      const file = await createSimpleSource(
        [{ text: original, x: 50, y: 210 }],
        rotation,
      );
      const edit = await resolveEdit(file, original, replacement, 10, 15);
      const bytes = await exportEdit(file, edit);
      const document = await PDFDocument.load(bytes, {
        throwOnInvalidObject: true,
      });

      expect(document.getPage(0).getRotation().angle).toBe(rotation);
      expect(await extractText(bytes)).toEqual([replacement]);
      const [run] = await pageRuns(bytes);
      expect(run?.textMatrix).toEqual([1, 0, 0, 1, 60, 225]);
    },
  );

  it('rejects non-default PDF user units rather than mislabeling movement as points', async () => {
    const original = 'NATIVE-USER-UNIT-OLD';
    const file = await createSimpleSource(
      [{ text: original, x: 50, y: 210 }],
      0,
      false,
      2,
    );

    await expect(
      resolveNativeTextSelection(
        file,
        0,
        await selectionProofForText(file, original),
      ),
    ).rejects.toMatchObject({ code: 'unsupported-content' });
  });

  it.each([0, 90, 180, 270] as const)(
    'preserves the workspace rotation delta %s after a native text edit',
    async (rotationDelta) => {
      const original = `NATIVE-WORKSPACE-ROTATE-${rotationDelta}`;
      const replacement = `NATIVE-WORKSPACE-ROTATE-NEW-${rotationDelta}`;
      const file = await createSimpleSource([
        { text: original, x: 50, y: 210 },
      ]);
      const edit = await resolveEdit(file, original, replacement, 10, 15);
      const bytes = await exportEdit(file, edit, [
        sourcePage(edit.workspacePageId, 'source', 0, rotationDelta),
      ]);
      const document = await PDFDocument.load(bytes, {
        throwOnInvalidObject: true,
      });

      expect(document.getPage(0).getRotation().angle).toBe(rotationDelta);
      expect(await extractText(bytes)).toEqual([replacement]);
      expect((await pageRuns(bytes))[0]?.textMatrix).toEqual([
        1, 0, 0, 1, 60, 225,
      ]);
    },
  );

  it('keeps a duplicate source page occurrence independent', async () => {
    const original = 'NATIVE-DUPLICATE-OLD';
    const replacement = 'NATIVE-DUPLICATE-NEW';
    const file = await createSimpleSource([{ text: original, x: 60, y: 230 }]);
    const edit = await resolveEdit(file, original, replacement, 0, 0, 'edited');
    const bytes = await exportEdit(file, edit, [
      sourcePage('edited', 'source', 0),
      sourcePage('untouched-copy', 'source', 0),
    ]);

    expect(await extractText(bytes)).toEqual([replacement, original]);
    const firstPage = await pageRuns(bytes, 0);
    const secondPage = await pageRuns(bytes, 1);
    expect(firstPage[0]?.text).toBe(replacement);
    expect(secondPage[0]?.text).toBe(original);
  });

  it('keeps a verified edit with its workspace page while pages are reordered', async () => {
    const firstOriginal = 'NATIVE-REORDER-FIRST-OLD';
    const secondOriginal = 'NATIVE-REORDER-SECOND-UNCHANGED';
    const replacement = 'NATIVE-REORDER-FIRST-NEW';
    const file = await createMultiPageSource([
      [{ text: firstOriginal, x: 60, y: 230 }],
      [{ text: secondOriginal, x: 60, y: 230 }],
    ]);
    const edit = await resolveEdit(
      file,
      firstOriginal,
      replacement,
      0,
      0,
      'first-workspace-page',
      0,
    );
    const bytes = await exportWorkspace({
      pages: [
        sourcePage('second-workspace-page', 'source', 1),
        sourcePage('first-workspace-page', 'source', 0),
      ],
      sources: new Map([['source', source('source', file)]]),
      forms: plainForms('source'),
      annotationsByPage: new Map(),
      imageAssets: new Map(),
      nativeTextEdits: [edit],
    });

    expect(await extractText(bytes)).toEqual([secondOriginal, replacement]);
    expect((await pageRuns(bytes, 0))[0]?.text).toBe(secondOriginal);
    expect((await pageRuns(bytes, 1))[0]?.text).toBe(replacement);
  });

  it('exports exactly the native source-text snapshot selected by undo or redo', async () => {
    const original = 'NATIVE-HISTORY-OLD';
    const file = await createSimpleSource([{ text: original, x: 50, y: 90 }]);
    const first = await resolveEdit(
      file,
      original,
      'NATIVE-HISTORY-FIRST',
      0,
      0,
      'history-page',
    );
    const second = { ...first, replacementText: 'NATIVE-HISTORY-SECOND' };
    let history = nativeTextEditReducer(createNativeTextEditHistory(), {
      type: 'COMMIT',
      edit: first,
    });
    history = nativeTextEditReducer(history, { type: 'COMMIT', edit: second });
    history = nativeTextEditReducer(history, { type: 'UNDO' });
    const undone = await exportWorkspace({
      pages: [sourcePage('history-page', 'source', 0)],
      sources: new Map([['source', source('source', file)]]),
      forms: plainForms('source'),
      annotationsByPage: new Map(),
      imageAssets: new Map(),
      nativeTextEdits: snapshotNativeTextEdits(
        history,
        new Set(['history-page']),
      ),
    });
    history = nativeTextEditReducer(history, { type: 'REDO' });
    const redone = await exportWorkspace({
      pages: [sourcePage('history-page', 'source', 0)],
      sources: new Map([['source', source('source', file)]]),
      forms: plainForms('source'),
      annotationsByPage: new Map(),
      imageAssets: new Map(),
      nativeTextEdits: snapshotNativeTextEdits(
        history,
        new Set(['history-page']),
      ),
    });

    expect(await extractText(undone)).toEqual(['NATIVE-HISTORY-FIRST']);
    expect(await extractText(redone)).toEqual(['NATIVE-HISTORY-SECOND']);
    expect((await decodedOutputStreams(undone)).join('\n')).not.toContain(
      original,
    );
    expect((await decodedOutputStreams(redone)).join('\n')).not.toContain(
      original,
    );
  });

  it('rejects a changed source file before it can alter another document', async () => {
    const original = 'NATIVE-SOURCE-A';
    const first = await createSimpleSource([{ text: original, x: 50, y: 90 }]);
    const edit = await resolveEdit(first, original, 'NATIVE-SOURCE-NEW');
    const second = await createSimpleSource([
      { text: 'NATIVE-SOURCE-B', x: 50, y: 90 },
    ]);

    await expect(exportEdit(second, edit)).rejects.toMatchObject({
      code: 'identity-mismatch',
    });
  });

  it('rejects an actual AcroForm even when stale metadata says the source is plain', async () => {
    const original = 'NATIVE-FORM-ORIGINAL';
    const file = await createSimpleSource(
      [{ text: original, x: 50, y: 90 }],
      0,
      true,
    );
    await expect(
      resolveNativeTextSelection(file, 0, proofForText(original)),
    ).rejects.toMatchObject({ code: 'form-conflict' });
    const edit: NativeTextEdit = {
      id: 'form-edit',
      workspacePageId: 'edited',
      sourceDocumentId: 'source',
      sourcePageIndex: 0,
      identity: {
        sourceFileFingerprint: await fileFingerprint(file),
        streamFingerprint: 'unreached-on-form-conflict',
        runOrdinal: 0,
        originalText: original,
        fontResourceName: 'F1',
        fontBaseName: 'Helvetica',
        fontSize: 12,
        textMatrix: [1, 0, 0, 1, 50, 90],
      },
      replacementText: 'NATIVE-FORM-REPLACED',
      translationX: 0,
      translationY: 0,
    };
    await expect(exportEdit(file, edit)).rejects.toMatchObject({
      code: 'form-conflict',
    });
  });

  it('rejects a native edit that shares a page with a pending redaction', async () => {
    const original = 'NATIVE-REDACTION-ORIGINAL';
    const file = await createSimpleSource([{ text: original, x: 50, y: 90 }]);
    const edit = await resolveEdit(file, original, 'NATIVE-REDACTION-NEW');

    await expect(
      exportWorkspace({
        pages: [sourcePage('edited', 'source', 0)],
        sources: new Map([['source', source('source', file)]]),
        forms: plainForms('source'),
        annotationsByPage: new Map(),
        imageAssets: new Map(),
        nativeTextEdits: [edit],
        redactionsByPage: new Map([
          [
            'edited',
            [
              {
                id: 'redaction',
                pageId: 'edited',
                box: { x: 40, y: 80, width: 30, height: 20 },
              },
            ],
          ],
        ]),
      }),
    ).rejects.toMatchObject({ code: 'redaction-conflict' });
  });

  it('rejects signed or signature-like PDF structures before source selection', async () => {
    const original = 'NATIVE-SIGNED-ORIGINAL';
    const unsigned = await createSimpleSource([
      { text: original, x: 50, y: 90 },
    ]);
    const document = await PDFDocument.load(await unsigned.arrayBuffer(), {
      throwOnInvalidObject: true,
    });
    document.context.register(
      document.context.obj({ Type: 'Sig', ByteRange: [0, 10, 20, 30] }),
    );
    const signed = toFile(
      await document.save({ useObjectStreams: false }),
      'signature-like.pdf',
    );

    await expect(
      resolveNativeTextSelection(signed, 0, proofForText(original)),
    ).rejects.toMatchObject({ code: 'unsupported-content' });
  });

  it('rejects comments rather than allowing recoverable original text', () => {
    expect(() =>
      parseStrictNativeTextRuns(
        new TextEncoder().encode(
          '% NATIVE-COMMENT-ORIGINAL\nBT\n/F1 12 Tf\n1 0 0 1 40 40 Tm\n(NATIVE-COMMENT-ORIGINAL) Tj\nET\n',
        ),
      ),
    ).toThrow(/comments/u);
  });

  it('rejects Type0 and custom embedded font dictionaries before rewriting text', async () => {
    const content = new TextEncoder().encode(
      'BT\n/F1 12 Tf\n1 0 0 1 40 40 Tm\n(UNSAFE-FONT) Tj\nET\n',
    );
    const type0 = await createRawContentSource(content, {
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'Unsafe-CID-Font',
      Encoding: 'Identity-H',
    });
    const embedded = await createRawContentSource(content, {
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: 'Helvetica',
      Encoding: 'WinAnsiEncoding',
      FontDescriptor: { Type: 'FontDescriptor', FontName: 'Helvetica' },
    });

    await expect(
      resolveNativeTextSelection(type0, 0, proofForText('UNSAFE-FONT')),
    ).rejects.toMatchObject({ code: 'unsupported-font' });
    await expect(
      resolveNativeTextSelection(embedded, 0, proofForText('UNSAFE-FONT')),
    ).rejects.toMatchObject({ code: 'unsupported-font' });
  });

  it('rejects malformed and oversized hostile source streams before changing a workspace', async () => {
    const malformed = await createRawContentSource(
      new TextEncoder().encode(
        'BT\n/F1 12 Tf\n1 0 0 1 40 40 Tm\n(MALFORMED-OPERAND Tj\nET\n',
      ),
    );
    const oversized = await createRawContentSource(
      new Uint8Array(256 * 1024 + 1).fill(0x20),
    );

    await expect(
      resolveNativeTextSelection(
        malformed,
        0,
        proofForText('MALFORMED-OPERAND'),
      ),
    ).rejects.toMatchObject({ code: 'unsupported-content' });
    await expect(
      resolveNativeTextSelection(oversized, 0, proofForText('ANY')),
    ).rejects.toMatchObject({ code: 'resource-limit' });
    expect(() =>
      assertNativeTextSourceBytesWithinLimit(
        new Uint8Array(MAX_NATIVE_TEXT_SOURCE_BYTES + 1),
      ),
    ).toThrow(/too large/u);
  });

  it('bounds indirect-object inspection before signature or ownership traversal', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    for (let index = 0; index <= 10_000; index += 1)
      document.context.register(document.context.obj({}));

    expect(() => assertNativeTextDocumentWithinLimits(document)).toThrow(
      /too many objects/u,
    );
  });

  it('bounds a direct array incrementally instead of expanding it before rejection', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    const directArray = document.context.obj(
      Array.from({ length: 50_001 }, () => PDFName.of('LimitProbe')),
    );
    document.catalog.set(PDFName.of('KagazLimitProbe'), directArray);

    expect(() => assertNativeTextDocumentWithinLimits(document)).toThrow(
      /object graph/u,
    );
  });

  it('rejects an oversized native-export File before reading its ArrayBuffer', async () => {
    const oversizedFile = {
      name: 'too-large.pdf',
      size: MAX_NATIVE_TEXT_SOURCE_BYTES + 1,
      arrayBuffer: () =>
        Promise.reject(
          new Error('The bounded native export must not read this file.'),
        ),
    } as unknown as File;
    const syntheticEdit: NativeTextEdit = {
      id: 'oversized-export-edit',
      workspacePageId: 'edited',
      sourceDocumentId: 'source',
      sourcePageIndex: 0,
      identity: {
        sourceFileFingerprint: 'unreached',
        streamFingerprint: 'unreached',
        runOrdinal: 0,
        originalText: 'UNREACHED',
        fontResourceName: 'F1',
        fontBaseName: 'Helvetica',
        fontSize: 12,
        textMatrix: [1, 0, 0, 1, 40, 40],
      },
      replacementText: 'REPLACED',
      translationX: 0,
      translationY: 0,
    };

    await expect(
      exportWorkspace({
        pages: [sourcePage('edited', 'source', 0)],
        sources: new Map([['source', source('source', oversizedFile)]]),
        forms: plainForms('source'),
        annotationsByPage: new Map(),
        imageAssets: new Map(),
        nativeTextEdits: [syntheticEdit],
      }),
    ).rejects.toMatchObject({ code: 'resource-limit' });
  });

  it('rejects TJ arrays and shared source streams without modifying a PDF', async () => {
    const document = await PDFDocument.create();
    const font = document.context.obj({
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: 'Helvetica',
      Encoding: 'WinAnsiEncoding',
    });
    const fontRef = document.context.register(font);
    const resources = document.context.obj({ Font: { F1: fontRef } });
    const tjStream = document.context.register(
      document.context.flateStream(
        'BT\n/F1 12 Tf\n1 0 0 1 40 40 Tm\n[(UNSAFE) 20] TJ\nET\n',
      ),
    );
    const first = document.addPage([300, 400]);
    first.node.set(PDFName.Resources, resources);
    first.node.set(PDFName.Contents, tjStream);
    const tjFile = toFile(
      await document.save({ useObjectStreams: false }),
      'tj-unsafe.pdf',
    );
    await expect(
      resolveNativeTextSelection(tjFile, 0, proofForText('UNSAFE')),
    ).rejects.toMatchObject({ code: 'unsupported-content' });

    const sharedDocument = await PDFDocument.create();
    const sharedFont = sharedDocument.context.obj({
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: 'Helvetica',
      Encoding: 'WinAnsiEncoding',
    });
    const sharedResources = sharedDocument.context.obj({
      Font: { F1: sharedDocument.context.register(sharedFont) },
    });
    const sharedStream = sharedDocument.context.register(
      sharedDocument.context.flateStream(
        'BT\n/F1 12 Tf\n1 0 0 1 40 40 Tm\n(SHARED-UNSAFE) Tj\nET\n',
      ),
    );
    const second = sharedDocument.addPage([300, 400]);
    const third = sharedDocument.addPage([300, 400]);
    for (const page of [second, third]) {
      page.node.set(PDFName.Resources, sharedResources);
      page.node.set(PDFName.Contents, sharedStream);
    }
    const unsafeFile = toFile(
      await sharedDocument.save({ useObjectStreams: false }),
      'shared-unsafe.pdf',
    );

    await expect(
      resolveNativeTextSelection(unsafeFile, 0, proofForText('SHARED-UNSAFE')),
    ).rejects.toMatchObject({ code: 'unsupported-content' });
  });
});
