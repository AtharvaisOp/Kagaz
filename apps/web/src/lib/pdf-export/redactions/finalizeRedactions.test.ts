import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  StandardFonts,
  degrees,
  decodePDFRawStream,
} from 'pdf-lib';
import { exportWorkspace } from '../exportWorkspace';
import type { ExportWorkspaceRequest } from '../types';
import type { RedactionRegion } from '../../../features/pdf-redactions/model/types';
import { rasterizeAppearance } from './rasterizeAppearance';
import {
  appearanceContentFingerprints,
  assertNoOriginalRedactedContent,
  resourceContentFingerprints,
} from './retentionSafety';

vi.mock('./rasterizeAppearance', () => ({ rasterizeAppearance: vi.fn() }));
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
  (value) => value.charCodeAt(0),
);
const proposal: RedactionRegion = {
  id: 'r',
  pageId: 'p0',
  box: { x: 30, y: 80, width: 120, height: 30 },
};

async function requestFrom(
  source: PDFDocument,
  regions: readonly RedactionRegion[] = [proposal],
): Promise<ExportWorkspaceRequest> {
  const saved = await source.save({ useObjectStreams: false });
  const buffer = new ArrayBuffer(saved.byteLength);
  new Uint8Array(buffer).set(saved);
  const file = new File([buffer], 'synthetic.pdf', { type: 'application/pdf' });
  return {
    pages: source.getPages().map((_, index) => ({
      id: `p${index}`,
      sourceDocumentId: 's',
      sourcePageIndex: index,
      rotationDelta: 0,
    })),
    sources: new Map([['s', { id: 's', file, fileName: file.name }]]),
    annotationsByPage: new Map(),
    imageAssets: new Map(),
    forms: {
      sources: [{ sourceDocumentId: 's', capability: 'plain', fields: [] }],
      hasChangedTextDraft: false,
    },
    redactionsByPage: new Map([['p0', regions]]),
  };
}

async function textSource(): Promise<PDFDocument> {
  const source = await PDFDocument.create();
  source
    .addPage([300, 200])
    .drawText('SECRET-TEXT-ALPHA', { x: 30, y: 85, size: 10 });
  source
    .addPage([300, 200])
    .drawText('PUBLIC-BETA', { x: 30, y: 85, size: 10 });
  return source;
}

async function duplicateSourceInstances(
  request: ExportWorkspaceRequest,
): Promise<ExportWorkspaceRequest> {
  const original = request.sources.get('s')!;
  const duplicate = {
    ...original,
    id: 'duplicate',
    file: new File([await original.file.arrayBuffer()], 'duplicate.pdf', {
      type: 'application/pdf',
    }),
  };
  return {
    ...request,
    pages: [
      request.pages[0]!,
      {
        ...request.pages[1]!,
        id: 'duplicate-public',
        sourceDocumentId: 'duplicate',
      },
    ],
    sources: new Map([...request.sources, ['duplicate', duplicate]]),
    forms: {
      ...request.forms,
      sources: [
        ...request.forms.sources,
        {
          sourceDocumentId: 'duplicate',
          capability: 'plain',
          fields: [],
        },
      ],
    },
  };
}

async function extractText(bytes: Uint8Array): Promise<string[]> {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const document = await task.promise;
    const result: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const text = await page.getTextContent();
      result.push(
        text.items
          .filter((item) => 'str' in item)
          .map((item) => ('str' in item ? item.str : ''))
          .join(''),
      );
      page.cleanup();
    }
    return result;
  } finally {
    await task.destroy();
  }
}

beforeEach(() => {
  vi.mocked(rasterizeAppearance).mockReset();
  vi.mocked(rasterizeAppearance).mockResolvedValue({
    png,
    viewBox: [0, 0, 300, 200],
    pixelWidth: 600,
    pixelHeight: 400,
  });
});

describe('destructive redaction output structure', () => {
  it('rebuilds only affected pages without reachable text, source objects, fields or annotations', async () => {
    const request = await requestFrom(await textSource());
    const bytes = await exportWorkspace(request);
    expect(await extractText(bytes)).toEqual(['', 'PUBLIC-BETA']);
    const output = await PDFDocument.load(bytes, {
      throwOnInvalidObject: true,
    });
    const redacted = output.getPage(0);
    expect(redacted.node.Annots()?.size() ?? 0).toBe(0);
    expect(
      redacted.node
        .Resources()
        ?.lookupMaybe(PDFName.of('Font'), PDFDict)
        ?.keys().length ?? 0,
    ).toBe(0);
    expect(output.getForm().getFields()).toHaveLength(0);
    const objects = output.context.enumerateIndirectObjects();
    expect(
      objects.filter(
        ([, object]) =>
          object instanceof PDFDict &&
          object.get(PDFName.of('Type'))?.toString() === '/Page',
      ),
    ).toHaveLength(2);
    const secretHex = Array.from(
      new TextEncoder().encode('SECRET-TEXT-ALPHA'),
      (value) => value.toString(16).padStart(2, '0'),
    )
      .join('')
      .toUpperCase();
    for (const [, object] of objects) {
      if (!(object instanceof PDFRawStream)) continue;
      const text = new TextDecoder().decode(
        decodePDFRawStream(object).decode(),
      );
      expect(text).not.toContain('SECRET-TEXT-ALPHA');
      expect(text).not.toContain(secretHex);
    }
    expect(new TextDecoder().decode(bytes)).not.toContain('SECRET-TEXT-ALPHA');
  });
  it.each([0, 90, 180, 270] as const)(
    'preserves source+workspace rotation %i',
    async (rotation) => {
      const source = await textSource();
      source.getPage(0).setRotation(degrees(rotation));
      const request = await requestFrom(source);
      const bytes = await exportWorkspace({
        ...request,
        pages: request.pages.map((page) => ({ ...page, rotationDelta: 90 })),
      });
      expect(
        (await PDFDocument.load(bytes)).getPage(0).getRotation().angle,
      ).toBe((rotation + 90) % 360);
    },
  );
  it('preserves raw media origin, cropped appearance and UserUnit', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    page.setMediaBox(10, 20, 300, 200);
    page.setCropBox(30, 50, 200, 100);
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
    vi.mocked(rasterizeAppearance).mockResolvedValue({
      png,
      viewBox: [30, 50, 230, 150],
      pixelWidth: 800,
      pixelHeight: 400,
    });
    const output = await PDFDocument.load(
      await exportWorkspace(await requestFrom(source)),
    );
    expect(output.getPage(0).getMediaBox()).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    });
    expect(output.getPage(0).getCropBox()).toEqual({
      x: 30,
      y: 50,
      width: 200,
      height: 100,
    });
    expect(
      output
        .getPage(0)
        .node.lookup(PDFName.of('UserUnit'), PDFNumber)
        .asNumber(),
    ).toBe(2);
  });
  it('uses workspace identities across reordered multi-source extraction', async () => {
    const source = await textSource();
    const request = await requestFrom(source);
    const bytes = await exportWorkspace({
      ...request,
      pages: [request.pages[1]!, request.pages[0]!],
    });
    expect(await extractText(bytes)).toEqual(['PUBLIC-BETA', '']);
    expect(
      await extractText(
        await exportWorkspace({ ...request, pages: [request.pages[0]!] }),
      ),
    ).toEqual(['']);
    expect(
      await extractText(
        await exportWorkspace({ ...request, pages: [request.pages[1]!] }),
      ),
    ).toEqual(['PUBLIC-BETA']);
  });
  it('applies annotation glyph and asset safety before rasterization', async () => {
    const request = await requestFrom(await textSource());
    const text = {
      id: 'text',
      workspacePageId: 'p0',
      kind: 'text' as const,
      box: {
        origin: { x: 30, y: 80 },
        width: 100,
        height: 30,
        rotation: 0 as const,
      },
      text: '🔥',
      fontFamily: 'helvetica' as const,
      fontSizeUserUnits: 12,
      lineHeight: 1.2,
      align: 'left' as const,
      color: { r: 0, g: 0, b: 0 },
      opacity: 1,
    };
    await expect(
      exportWorkspace({
        ...request,
        annotationsByPage: new Map([['p0', [text]]]),
      }),
    ).rejects.toMatchObject({ code: 'unsupported-text-font' });
    const image = {
      id: 'image',
      workspacePageId: 'p0',
      kind: 'signature' as const,
      box: text.box,
      assetId: 'missing',
      opacity: 1,
      method: 'draw' as const,
    };
    await expect(
      exportWorkspace({
        ...request,
        annotationsByPage: new Map([['p0', [image]]]),
      }),
    ).rejects.toMatchObject({ code: 'missing-signature-asset' });
    expect(rasterizeAppearance).not.toHaveBeenCalled();
  });
  it('fails closed on raster failure and allows a later independent export', async () => {
    const request = await requestFrom(await textSource());
    vi.mocked(rasterizeAppearance).mockRejectedValueOnce(
      new Error('failed renderer'),
    );
    await expect(exportWorkspace(request)).rejects.toBeDefined();
    expect(await extractText(await exportWorkspace(request))).toEqual([
      '',
      'PUBLIC-BETA',
    ]);
  });
  it('aborts without publishing partial output after raster completion', async () => {
    const request = await requestFrom(await textSource());
    const abort = new AbortController();
    vi.mocked(rasterizeAppearance).mockImplementationOnce(() => {
      abort.abort();
      return Promise.resolve({
        png,
        viewBox: [0, 0, 300, 200],
        pixelWidth: 600,
        pixelHeight: 400,
      });
    });
    await expect(
      exportWorkspace(request, { signal: abort.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
  it('rejects huge physical pages before invoking renderer', async () => {
    const source = await PDFDocument.create();
    source.addPage([100_000, 100_000]);
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-too-large' });
    expect(rasterizeAppearance).not.toHaveBeenCalled();
  });
  it('rejects duplicate region IDs and wrong page association', async () => {
    const source = await textSource();
    await expect(
      exportWorkspace(await requestFrom(source, [proposal, proposal])),
    ).rejects.toMatchObject({ code: 'redaction-invalid' });
    await expect(
      exportWorkspace(
        await requestFrom(source, [{ ...proposal, pageId: 'wrong' }]),
      ),
    ).rejects.toMatchObject({ code: 'redaction-invalid' });
  });
  it.each(['Metadata', 'PieceInfo', 'Thumb', 'PresSteps', 'AF'])(
    'rejects hidden %s alternate representations on preserved pages',
    async (key) => {
      const source = await textSource();
      source
        .getPage(1)
        .node.set(
          PDFName.of(key),
          source.context.obj({ Contents: PDFString.of('SECRET-TEXT-ALPHA') }),
        );
      await expect(
        exportWorkspace(await requestFrom(source)),
      ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
    },
  );
  it('rejects preserved source annotations including comments and cross-page destinations', async () => {
    const source = await textSource();
    const annotation = source.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [1, 1, 10, 10],
      Contents: PDFString.of('SECRET-TEXT-ALPHA'),
      Dest: [source.getPage(0).ref, 'Fit'],
    });
    source.getPage(1).node.addAnnot(source.context.register(annotation));
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
  });
  it('detects detached original page objects even outside the output page tree', async () => {
    const output = await PDFDocument.create();
    const source = await textSource();
    output.addPage([300, 200]);
    await output.copyPages(source, [0]);
    await expect(
      assertNoOriginalRedactedContent(output, new Set()),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
  });
  it('rejects shared CMap or auxiliary streams carrying alternate secret text', async () => {
    const source = await textSource();
    await source.flush();
    const alternate = source.context.register(
      source.context.flateStream('/SECRET-TEXT-ALPHA beginbfchar'),
    );
    for (const page of source.getPages()) {
      const fonts = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
      for (const [, font] of fonts.entries())
        source.context
          .lookup(font, PDFDict)
          .set(PDFName.of('ToUnicode'), alternate);
    }
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
  });
  it('rejects original image streams reused by an unaffected page', async () => {
    const source = await textSource();
    const image = await source.embedPng(png);
    for (const page of source.getPages())
      page.drawImage(image, { x: 30, y: 80, width: 100, height: 30 });
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
  });
  it('permits information-free graphics wrappers shared across pages', async () => {
    const source = await textSource();
    const controls = source.context.register(
      source.context.flateStream('q\nQ\nn\n'),
    );
    for (const page of source.getPages()) page.node.addContentStream(controls);
    expect(
      await extractText(await exportWorkspace(await requestFrom(source))),
    ).toEqual(['', 'PUBLIC-BETA']);
  });
  it('does not mistake image sample bytes q/Q/n for control-only page wrappers', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 200]);
    const image = source.context.register(
      source.context.flateStream('q', {
        Type: 'XObject',
        Subtype: 'Image',
        Width: 1,
        Height: 1,
        ColorSpace: 'DeviceGray',
        BitsPerComponent: 8,
      }),
    );
    source
      .getPage(0)
      .node.Resources()!
      .set(PDFName.of('XObject'), source.context.obj({ Tiny: image }));
    const fingerprints = await appearanceContentFingerprints(source);
    expect(
      [...fingerprints].filter((value) => !value.includes(':')),
    ).toHaveLength(1);
  });
  it('rejects shared nonstream alternate secret strings in resource dictionaries', async () => {
    const source = await textSource();
    const hidden = source.context.register(
      source.context.obj({ SecretText: PDFString.of('SECRET-TEXT-ALPHA') }),
    );
    for (const page of source.getPages())
      page.node.Resources()!.set(PDFName.of('HiddenRepresentation'), hidden);
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
  });
  it('rejects unknown preserved resource categories even if they contain only names or numbers', async () => {
    const source = await textSource();
    source
      .getPage(1)
      .node.Resources()!
      .set(
        PDFName.of('HiddenRepresentation'),
        source.context.obj({ EncodedSecret: [83, 69, 67, 82, 69, 84] }),
      );
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
  });
  it('rejects unknown nested font fields carrying numeric alternate content', async () => {
    const source = await textSource();
    await source.flush();
    const fonts = source
      .getPage(1)
      .node.Resources()!
      .lookup(PDFName.of('Font'), PDFDict);
    const font = source.context.lookup(fonts.values()[0], PDFDict);
    font.set(
      PDFName.of('PrivateOriginalText'),
      source.context.obj([83, 69, 67, 82, 69, 84]),
    );
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
  });
  it('rejects invalid named-resource value kinds carrying alternate numeric content', async () => {
    const source = await textSource();
    const fonts = source
      .getPage(1)
      .node.Resources()!
      .lookup(PDFName.of('Font'), PDFDict);
    fonts.set(
      PDFName.of('UnusedHiddenEntry'),
      source.context.obj([83, 69, 67, 82, 69, 84]),
    );
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
  });
  it('rejects shared material font names representing hidden original information', async () => {
    const source = await textSource();
    await source.flush();
    for (const page of source.getPages()) {
      const fonts = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
      for (const [, font] of fonts.entries())
        source.context
          .lookup(font, PDFDict)
          .set(PDFName.of('BaseFont'), PDFName.of('SECRET-TEXT-ALPHA'));
    }
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
  });
  it('rejects secret resource dictionary keys shared with a preserved page', async () => {
    const source = await textSource();
    await source.flush();
    const firstFonts = source
      .getPage(0)
      .node.Resources()!
      .lookup(PDFName.of('Font'), PDFDict);
    const validFont = firstFonts.values()[0]!;
    for (const page of source.getPages()) {
      const fonts = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
      // Retain all actual content mappings; add a valid but unused alias.
      fonts.set(PDFName.of('SECRET-TEXT-ALPHA'), validFont);
    }
    const request = await requestFrom(source);
    await expect(exportWorkspace(request)).rejects.toMatchObject({
      code: 'redaction-unsafe-retention',
    });
    // Redacted-only extraction has no source resource graph in final output.
    expect(
      await extractText(
        await exportWorkspace({ ...request, pages: [request.pages[0]!] }),
      ),
    ).toEqual(['']);
  });
  it('preserves nine ordinary pages when one page of a ten-page source is redacted', async () => {
    const source = await PDFDocument.create();
    for (let index = 0; index < 10; index += 1)
      source
        .addPage([300, 200])
        .drawText(index === 0 ? 'SECRET-TEXT-ALPHA' : `PUBLIC-PAGE-${index}`, {
          x: 30,
          y: 85,
          size: 10,
        });
    const bytes = await exportWorkspace(await requestFrom(source));
    expect(await extractText(bytes)).toEqual([
      '',
      ...Array.from({ length: 9 }, (_, index) => `PUBLIC-PAGE-${index + 1}`),
    ]);
    expect(rasterizeAppearance).toHaveBeenCalledTimes(1);
  });
  it('fails closed for unrelated sources with identical generated resource aliases, and supports genuinely different font families', async () => {
    const secretSource = await PDFDocument.create();
    secretSource
      .addPage([300, 200])
      .drawText('SECRET-TEXT-ALPHA', { x: 30, y: 85, size: 10 });
    const publicSource = await PDFDocument.create();
    publicSource
      .addPage([300, 200])
      .drawText('PUBLIC-ONLY', { x: 30, y: 85, size: 10 });
    const secretRequest = await requestFrom(secretSource);
    const publicRequest = await requestFrom(publicSource);
    const publicPage = {
      ...publicRequest.pages[0]!,
      id: 'public',
      sourceDocumentId: 'public-source',
    };
    const publicRuntime = publicRequest.sources.get('s')!;
    const mixedRequest = {
      ...secretRequest,
      pages: [secretRequest.pages[0]!, publicPage],
      sources: new Map([
        ...secretRequest.sources,
        ['public-source', { ...publicRuntime, id: 'public-source' }],
      ]),
      forms: {
        ...secretRequest.forms,
        sources: [
          ...secretRequest.forms.sources,
          {
            sourceDocumentId: 'public-source',
            capability: 'plain' as const,
            fields: [],
          },
        ],
      },
    };
    await expect(exportWorkspace(mixedRequest)).rejects.toMatchObject({
      code: 'redaction-unsafe-retention',
    });
    const distinctSource = await PDFDocument.create();
    const font = await distinctSource.embedFont(StandardFonts.TimesRoman);
    distinctSource
      .addPage([300, 200])
      .drawText('PUBLIC-ONLY', { font, x: 30, y: 85, size: 10 });
    const distinctRuntime = (await requestFrom(distinctSource)).sources.get(
      's',
    )!;
    const output = await exportWorkspace({
      ...mixedRequest,
      sources: new Map([
        ...secretRequest.sources,
        ['public-source', { ...distinctRuntime, id: 'public-source' }],
      ]),
    });
    expect(await extractText(output)).toEqual(['', 'PUBLIC-ONLY']);
  });
  it('rejects numeric original information carried by a legitimate font alias suffix', async () => {
    const source = await PDFDocument.create();
    source
      .addPage([300, 200])
      .drawText('ACCOUNT-123456', { x: 30, y: 85, size: 10 });
    source
      .addPage([300, 200])
      .drawText('PUBLIC-ONLY', { x: 30, y: 85, size: 10 });
    await source.flush();
    const firstFonts = source
      .getPage(0)
      .node.Resources()!
      .lookup(PDFName.of('Font'), PDFDict);
    const font = firstFonts.values()[0]!;
    for (const page of source.getPages())
      page.node
        .Resources()!
        .lookup(PDFName.of('Font'), PDFDict)
        .set(PDFName.of('Helvetica-123456'), font);
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
  });
  it('rejects shared standard-font numeric arrays containing alternate original information', async () => {
    const generated = await textSource();
    // Change the parsed dictionary after embedFont has written its definition.
    const source = await PDFDocument.load(await generated.save());
    const firstFonts = source
      .getPage(0)
      .node.Resources()!
      .lookup(PDFName.of('Font'), PDFDict);
    const sharedFont = firstFonts.values()[0]!;
    const font = source.context.lookup(sharedFont, PDFDict);
    const secret = Array.from(new TextEncoder().encode('SECRET-TEXT-ALPHA'));
    font.set(PDFName.of('FirstChar'), PDFNumber.of(0));
    font.set(PDFName.of('LastChar'), PDFNumber.of(secret.length - 1));
    font.set(PDFName.of('Widths'), source.context.obj(secret));
    const secondFonts = source
      .getPage(1)
      .node.Resources()!
      .lookup(PDFName.of('Font'), PDFDict);
    for (const key of secondFonts.keys()) secondFonts.set(key, sharedFont);
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
    expect(rasterizeAppearance).not.toHaveBeenCalled();
  });
  it('rejects shared graphics-state dictionaries containing numeric original information', async () => {
    const source = await textSource();
    const shared = source.context.register(
      source.context.obj({ Type: 'ExtGState', LW: 123456 }),
    );
    for (const [index, page] of source.getPages().entries())
      page.node
        .Resources()!
        .set(
          PDFName.of('ExtGState'),
          source.context.obj({ [`Graphics${index}`]: shared }),
        );
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
    expect(rasterizeAppearance).not.toHaveBeenCalled();
  });
  it('preserves ten-page sources that share only a closed Standard 14 font definition', async () => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    for (let index = 0; index < 10; index += 1)
      source
        .addPage([300, 200])
        .drawText(index === 0 ? 'SECRET-TEXT-ALPHA' : `PUBLIC-PAGE-${index}`, {
          font,
          x: 30,
          y: 85,
          size: 10,
        });
    const bytes = await exportWorkspace(await requestFrom(source));
    expect(await extractText(bytes)).toEqual([
      '',
      ...Array.from({ length: 9 }, (_, index) => `PUBLIC-PAGE-${index + 1}`),
    ]);
    expect(rasterizeAppearance).toHaveBeenCalledTimes(1);
  });
  it('preserves ordinary text and rectangle annotations with repeated generated CA/ca states', async () => {
    const source = await PDFDocument.create();
    for (let index = 0; index < 10; index += 1)
      source
        .addPage([300, 200])
        .drawText(index === 0 ? 'SECRET-TEXT-ALPHA' : `PUBLIC-PAGE-${index}`, {
          x: 30,
          y: 85,
          size: 10,
        });
    const request = await requestFrom(source);
    const text = {
      id: 'secret-text',
      workspacePageId: 'p0',
      kind: 'text' as const,
      box: {
        origin: { x: 30, y: 80 },
        width: 160,
        height: 30,
        rotation: 0 as const,
      },
      text: 'SECRET-TEXT-BETA',
      fontFamily: 'helvetica' as const,
      fontSizeUserUnits: 10,
      lineHeight: 1.2,
      align: 'left' as const,
      color: { r: 0, g: 0, b: 0 },
      opacity: 1,
    };
    const rectangle = {
      id: 'secret-rectangle',
      workspacePageId: 'p0',
      kind: 'rectangle' as const,
      box: {
        origin: { x: 30, y: 20 },
        width: 140,
        height: 40,
        rotation: 0 as const,
      },
      stroke: {
        color: { r: 0.2, g: 0.6, b: 0.9 },
        widthUserUnits: 2,
        opacity: 1,
      },
      fill: null,
    };
    const bytes = await exportWorkspace({
      ...request,
      annotationsByPage: new Map([
        ['p0', [text, rectangle]],
        [
          'p1',
          [
            {
              ...text,
              id: 'public-text',
              workspacePageId: 'p1',
              text: 'PUBLIC ANNOTATION',
            },
            { ...rectangle, id: 'public-rectangle', workspacePageId: 'p1' },
          ],
        ],
      ]),
    });
    const extracted = await extractText(bytes);
    expect(extracted[0]).toBe('');
    expect(extracted[1]).toContain('PUBLIC ANNOTATION');
    expect(rasterizeAppearance).toHaveBeenCalledTimes(1);
  });
  it('still fingerprints nonresource appearance dictionary keys after generated aliases are excluded', async () => {
    const source = await PDFDocument.create();
    source
      .addPage([300, 200])
      .node.set(PDFName.of('SECRET-TEXT-ALPHA'), PDFNumber.of(123));
    const fingerprints = await appearanceContentFingerprints(
      source,
      () => undefined,
      false,
    );
    const output = await PDFDocument.create();
    const page = output.addPage([300, 200]);
    page.node.Resources()!.set(
      PDFName.of('Font'),
      output.context.obj({
        'SECRET-TEXT-ALPHA': {
          Type: 'Font',
          Subtype: 'Type1',
          BaseFont: 'Helvetica',
        },
      }),
    );
    await expect(
      assertNoOriginalRedactedContent(output, fingerprints),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
  });
  it.each([
    { widths: Array.from(new TextEncoder().encode('SECRET-TEXT-ALPHA')) },
    { widths: [123456] },
  ])(
    'rejects original numeric Widths arrays across duplicate source instances: %j',
    async ({ widths }) => {
      const source = await PDFDocument.load(await (await textSource()).save());
      const firstFonts = source
        .getPage(0)
        .node.Resources()!
        .lookup(PDFName.of('Font'), PDFDict);
      const sharedFont = firstFonts.values()[0]!;
      const font = source.context.lookup(sharedFont, PDFDict);
      font.set(PDFName.of('FirstChar'), PDFNumber.of(0));
      font.set(PDFName.of('LastChar'), PDFNumber.of(widths.length - 1));
      font.set(PDFName.of('Widths'), source.context.obj(widths));
      const secondFonts = source
        .getPage(1)
        .node.Resources()!
        .lookup(PDFName.of('Font'), PDFDict);
      for (const key of secondFonts.keys()) secondFonts.set(key, sharedFont);
      await expect(
        exportWorkspace(
          await duplicateSourceInstances(await requestFrom(source)),
        ),
      ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
      expect(rasterizeAppearance).not.toHaveBeenCalled();
    },
  );
  it('rejects scalar graphics-state payloads across duplicate source instances', async () => {
    const source = await textSource();
    const shared = source.context.register(
      source.context.obj({ Type: 'ExtGState', LW: 123456 }),
    );
    for (const [index, page] of source.getPages().entries())
      page.node
        .Resources()!
        .set(
          PDFName.of('ExtGState'),
          source.context.obj({ [`Graphics${index}`]: shared }),
        );
    await expect(
      exportWorkspace(
        await duplicateSourceInstances(await requestFrom(source)),
      ),
    ).rejects.toMatchObject({ code: 'redaction-unsafe-retention' });
    expect(rasterizeAppearance).not.toHaveBeenCalled();
  });
  it('canonicalizes resource key order and indirect primitive references', async () => {
    const first = await PDFDocument.create();
    first.addPage([300, 200]);
    first
      .getPage(0)
      .node.Resources()!
      .set(
        PDFName.of('ExtGState'),
        first.context.obj({ First: { Type: 'ExtGState', LW: 123456 } }),
      );
    const second = await PDFDocument.create();
    second.addPage([300, 200]);
    const value = second.context.register(PDFNumber.of(123456));
    second
      .getPage(0)
      .node.Resources()!
      .set(
        PDFName.of('ExtGState'),
        second.context.obj({ Other: { LW: value, Type: 'ExtGState' } }),
      );
    const hashes = await resourceContentFingerprints(first, [0]);
    const other = await resourceContentFingerprints(second, [0]);
    expect([...hashes].some((hash) => other.has(hash))).toBe(true);
  });
  it('fails closed on cyclic resources and excessive resource nesting', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 200]);
    const resources = source.getPage(0).node.Resources()!;
    resources.set(PDFName.of('ExtGState'), resources);
    await expect(
      resourceContentFingerprints(source, [0]),
    ).rejects.toMatchObject({
      code: 'redaction-unsafe-retention',
    });
    let nested = source.context.obj([123456]);
    for (let depth = 0; depth < 129; depth += 1)
      nested = source.context.obj([nested]);
    resources.set(
      PDFName.of('ExtGState'),
      source.context.obj({ Nested: nested }),
    );
    await expect(
      resourceContentFingerprints(source, [0]),
    ).rejects.toMatchObject({
      code: 'redaction-unsafe-retention',
    });
  });
  it('checks image limits when the Subtype name is an indirect reference', async () => {
    const source = await textSource();
    const subtype = source.context.register(PDFName.of('Image'));
    const image = source.context.register(
      source.context.flateStream(new Uint8Array([1]), {
        Subtype: subtype,
        Width: 100_000,
        Height: 100_000,
      }),
    );
    source
      .getPage(0)
      .node.Resources()!
      .set(PDFName.of('XObject'), source.context.obj({ Large: image }));
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-too-large' });
    expect(rasterizeAppearance).not.toHaveBeenCalled();
  });
  it('rejects oversized input image dimensions before browser decoding', async () => {
    const source = await textSource();
    const image = source.context.register(
      source.context.flateStream(new Uint8Array([255]), {
        Type: 'XObject',
        Subtype: 'Image',
        Width: 100_000,
        Height: 100_000,
        ColorSpace: 'DeviceGray',
        BitsPerComponent: 8,
      }),
    );
    source
      .getPage(0)
      .node.Resources()!
      .set(PDFName.of('XObject'), source.context.obj({ LargeImage: image }));
    await expect(
      exportWorkspace(await requestFrom(source)),
    ).rejects.toMatchObject({ code: 'redaction-too-large' });
    expect(rasterizeAppearance).not.toHaveBeenCalled();
  });
  it('retains signed-source and executable-action blocking with pending redactions', async () => {
    const signed = await textSource();
    signed.context.register(
      signed.context.obj({
        Type: 'Sig',
        ByteRange: [0, 1, 2, 3],
        Contents: PDFString.of('signature-value'),
      }),
    );
    await expect(
      exportWorkspace(await requestFrom(signed)),
    ).rejects.toMatchObject({ code: 'existing-digital-signature' });
    const active = await textSource();
    active.catalog.set(
      PDFName.of('OpenAction'),
      active.context.obj({ S: 'JavaScript', JS: PDFString.of('void(0)') }),
    );
    await expect(
      exportWorkspace(await requestFrom(active)),
    ).rejects.toMatchObject({ code: 'unsupported-source' });
    expect(rasterizeAppearance).not.toHaveBeenCalled();
  });
});
