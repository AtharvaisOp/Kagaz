import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';

const python = process.env.OCR_PYTHON_PATH ?? 'python3';
const inspector = fileURLToPath(
  new URL('../../native/inspect_pdf.py', import.meta.url),
);
const convertedInspector = fileURLToPath(
  new URL('../../native/inspect_converted_pdf.py', import.meta.url),
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function inspect(doc: PDFDocument, script = inspector, pages = 300) {
  const directory = await mkdtemp(join(tmpdir(), 'kagaz-pdf-safety-'));
  roots.push(directory);
  const input = join(directory, 'input.pdf');
  await writeFile(input, await doc.save());
  const result = spawnSync(python, [script, input, String(pages)], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 16 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function document() {
  const doc = await PDFDocument.create();
  doc.addPage().drawText('Public synthetic safety fixture');
  return doc;
}

describe('bounded shared native PDF safety inspection', () => {
  it.each([
    'JavaScript',
    'URI',
    'Launch',
    'GoToR',
    'Rendition',
    'Movie',
    'ResetForm',
    'RichMediaExecute',
  ])(
    'rejects nested inline %s actions, including indirect object-stream containers',
    async (kind) => {
      const doc = await document();
      doc.catalog.set(
        PDFName.of('SyntheticMetadata'),
        doc.context.obj({
          Children: [{ S: kind }],
        }),
      );
      expect(await inspect(doc)).toEqual({
        exitCode: 2,
        stdout: '',
        stderr: '',
      });
    },
  );

  it('inspects stream dictionaries and unused indirect objects', async () => {
    const doc = await document();
    doc.context.register(
      doc.context.stream(new Uint8Array(), {
        Type: 'EmbeddedFile',
        Nested: { JS: PDFString.of('synthetic fixture') },
      }),
    );
    expect(await inspect(doc)).toEqual({ exitCode: 2, stdout: '', stderr: '' });
  });

  it.each([
    'AcroForm',
    'XFA',
    'ByteRange',
    'JS',
    'EmbeddedFiles',
    'EF',
    'AF',
    'AA',
  ])(
    'rejects inline %s structures even without an action subtype',
    async (key) => {
      const doc = await document();
      doc.catalog.set(
        PDFName.of('SyntheticMetadata'),
        doc.context.obj({ [key]: [] }),
      );
      expect(await inspect(doc)).toEqual({
        exitCode: 2,
        stdout: '',
        stderr: '',
      });
    },
  );

  it('rejects external-file streams and multimedia annotations', async () => {
    const external = await document();
    external.context.register(
      external.context.stream(new Uint8Array(), {
        F: PDFString.of('/synthetic/private/path'),
      }),
    );
    expect((await inspect(external)).exitCode).toBe(2);
    const reference = await document();
    reference.context.register(
      reference.context.stream(new Uint8Array(), {
        Type: 'XObject',
        Subtype: 'Form',
        Ref: { F: PDFString.of('/synthetic/private.pdf'), Page: 0 },
      }),
    );
    expect((await inspect(reference)).exitCode).toBe(2);
    const multimedia = await document();
    multimedia
      .getPage(0)
      .node.set(
        PDFName.of('Annots'),
        multimedia.context.obj([{ Subtype: 'Screen', Rect: [0, 0, 100, 100] }]),
      );
    expect((await inspect(multimedia)).exitCode).toBe(2);
    const attachment = await document();
    attachment
      .getPage(0)
      .node.set(
        PDFName.of('Annots'),
        attachment.context.obj([{ Subtype: 'FileAttachment' }]),
      );
    expect((await inspect(attachment)).exitCode).toBe(2);
  });

  it('fails closed on unknown open actions and unsafe chained actions', async () => {
    const unknown = await document();
    unknown.catalog.set(
      PDFName.of('OpenAction'),
      unknown.context.obj({ S: 'UnknownAction' }),
    );
    expect((await inspect(unknown)).exitCode).toBe(2);
    const chained = await document();
    chained.catalog.set(
      PDFName.of('OpenAction'),
      chained.context.obj({
        S: 'GoTo',
        D: [chained.getPage(0).ref, 'Fit'],
        Next: { S: 'URI', URI: PDFString.of('https://example.invalid') },
      }),
    );
    expect((await inspect(chained)).exitCode).toBe(2);
  });

  it('rejects cyclic and acyclic local GoTo action chains while preserving outline links', async () => {
    const cyclic = await document();
    const localAction = cyclic.context.obj({
      S: 'GoTo',
      D: [cyclic.getPage(0).ref, 'Fit'],
    });
    const actionRef = cyclic.context.register(localAction);
    localAction.set(PDFName.of('Next'), actionRef);
    cyclic.catalog.set(PDFName.of('OpenAction'), actionRef);
    expect((await inspect(cyclic)).exitCode).toBe(2);
    const acyclic = await document();
    acyclic.catalog.set(
      PDFName.of('OpenAction'),
      acyclic.context.obj({
        S: 'GoTo',
        D: [acyclic.getPage(0).ref, 'Fit'],
        Next: { S: 'GoTo', D: [acyclic.getPage(0).ref, 'Fit'] },
      }),
    );
    expect((await inspect(acyclic)).exitCode).toBe(2);
    const outline = await document();
    outline.catalog.set(
      PDFName.of('SyntheticMetadata'),
      outline.context.obj({
        Title: PDFString.of('First outline entry'),
        Next: {
          Title: PDFString.of('Second outline entry'),
          Dest: [outline.getPage(0).ref, 'Fit'],
        },
      }),
    );
    expect((await inspect(outline)).exitCode).toBe(0);
  });

  it.each(['direct', 'form'])(
    'rejects %s PostScript XObjects without decoding executable stream content',
    async (kind) => {
      const doc = await document();
      doc.context.register(
        doc.context.stream(new Uint8Array(), {
          Type: 'XObject',
          Subtype: kind === 'direct' ? 'PS' : 'Form',
          ...(kind === 'form' ? { Subtype2: 'PS' } : {}),
        }),
      );
      expect(await inspect(doc)).toEqual({
        exitCode: 2,
        stdout: '',
        stderr: '',
      });
    },
  );

  it('rejects external reference streams with spoofed structure-element types and preserves local structure references', async () => {
    const doc = await document();
    doc.context.register(
      doc.context.stream(new Uint8Array(), {
        Type: 'StructElem',
        Subtype: 'Form',
        Ref: { F: PDFString.of('/synthetic/private.pdf'), Page: 0 },
      }),
    );
    expect((await inspect(doc)).exitCode).toBe(2);
    const spoofedAnnotation = await document();
    spoofedAnnotation.getPage(0).node.set(
      PDFName.of('Annots'),
      spoofedAnnotation.context.obj([
        {
          Type: 'StructElem',
          Subtype: 'Link',
          Rect: [0, 0, 100, 100],
          A: { S: 'UnknownAction' },
        },
      ]),
    );
    expect((await inspect(spoofedAnnotation)).exitCode).toBe(2);
    const safe = await document();
    const target = safe.context.register(
      safe.context.obj({ Type: 'StructElem', S: 'P' }),
    );
    safe.catalog.set(
      PDFName.of('SyntheticMetadata'),
      safe.context.obj({ Type: 'StructElem', S: 'P', Ref: [target] }),
    );
    expect((await inspect(safe)).exitCode).toBe(0);
  });

  it.each(['direct', 'goto', 'named'])(
    'retains a legitimate %s local open destination in shared and conversion output inspection',
    async (kind) => {
      const doc = await document();
      const target =
        kind === 'named'
          ? PDFString.of('local-bookmark')
          : doc.context.obj([doc.getPage(0).ref, 'XYZ', null, null, 0]);
      doc.catalog.set(
        PDFName.of('OpenAction'),
        kind === 'goto' ? doc.context.obj({ S: 'GoTo', D: target }) : target,
      );
      for (const script of [inspector, convertedInspector]) {
        const result = await inspect(doc, script);
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ pages: 1 });
        expect(result.stderr).toBe('');
      }
    },
  );

  it('retains local link annotations and passive tagged-PDF attributes', async () => {
    const doc = await document();
    const page = doc.getPage(0);
    page.node.set(
      PDFName.of('Annots'),
      doc.context.obj([
        {
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [0, 0, 100, 100],
          A: { S: 'GoTo', D: [page.ref, 'Fit'] },
        },
      ]),
    );
    doc.catalog.set(
      PDFName.of('SyntheticMetadata'),
      doc.context.obj({ Type: 'StructElem', S: 'P', A: { O: 'Layout' } }),
    );
    expect((await inspect(doc)).exitCode).toBe(0);
  });

  it('rejects invalid destinations, excessive inline nesting and operation page limits', async () => {
    const invalid = await document();
    invalid.catalog.set(
      PDFName.of('OpenAction'),
      invalid.context.obj([invalid.getPage(0).ref, 'FitR', 0]),
    );
    expect((await inspect(invalid)).exitCode).toBe(2);
    const deep = await document();
    let nested = deep.context.obj({ Safe: 1 });
    for (let depth = 0; depth < 70; depth++)
      nested = deep.context.obj({ Nested: nested });
    deep.catalog.set(PDFName.of('SyntheticMetadata'), nested);
    expect((await inspect(deep)).exitCode).toBe(2);
    const large = await document();
    large.addPage();
    expect((await inspect(large, inspector, 1)).exitCode).toBe(2);
  });
});
