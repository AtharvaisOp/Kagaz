import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  PDFHexString,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import { PdfExportError } from '../types';
import {
  REDACTION_MAX_IMAGE_PIXELS,
  REDACTION_MAX_PIXELS,
} from './rasterPolicy';

const MAX_GRAPH_OBJECTS = 100_000;
const RESOURCE_CATEGORIES = new Set([
  'Font',
  'XObject',
  'ColorSpace',
  'Pattern',
  'Shading',
  'ExtGState',
  'ProcSet',
]);
const STANDARD_FONT_FAMILIES = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Times-BoldItalic',
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
  'Symbol',
  'ZapfDingbats',
]);
// A deliberately narrow standard appearance vocabulary: unknown custom fields
// can carry encoded alternate content and are rejected on preserved pages.
const APPEARANCE_DICTIONARY_KEYS = new Set([
  'Type',
  'Parent',
  'Kids',
  'Count',
  'Subtype',
  'Length',
  'Length1',
  'Length2',
  'Length3',
  'Filter',
  'DecodeParms',
  'DL',
  'Resources',
  'Contents',
  'MediaBox',
  'CropBox',
  'BleedBox',
  'TrimBox',
  'ArtBox',
  'Rotate',
  'UserUnit',
  'Annots',
  'BaseFont',
  'FirstChar',
  'LastChar',
  'Widths',
  'FontDescriptor',
  'Encoding',
  'ToUnicode',
  'DescendantFonts',
  'CIDSystemInfo',
  'CIDToGIDMap',
  'DW',
  'W',
  'DW2',
  'W2',
  'FontBBox',
  'FontMatrix',
  'CharProcs',
  'Name',
  'BaseEncoding',
  'Differences',
  'Registry',
  'Ordering',
  'Supplement',
  'FontName',
  'Flags',
  'ItalicAngle',
  'Ascent',
  'Descent',
  'CapHeight',
  'XHeight',
  'StemV',
  'StemH',
  'AvgWidth',
  'MaxWidth',
  'MissingWidth',
  'FontFile',
  'FontFile2',
  'FontFile3',
  'CharSet',
  'FontFamily',
  'FontStretch',
  'FontWeight',
  'Leading',
  'Width',
  'Height',
  'ColorSpace',
  'BitsPerComponent',
  'Intent',
  'ImageMask',
  'Decode',
  'Interpolate',
  'Mask',
  'SMask',
  'SMaskInData',
  'Matte',
  'FormType',
  'BBox',
  'Matrix',
  'Group',
  'S',
  'CS',
  'I',
  'K',
  'G',
  'BC',
  'LW',
  'LC',
  'LJ',
  'ML',
  'D',
  'RI',
  'OP',
  'op',
  'OPM',
  'Font',
  'BG',
  'BG2',
  'UCR',
  'UCR2',
  'TR',
  'TR2',
  'HT',
  'FL',
  'SM',
  'SA',
  'BM',
  'CA',
  'ca',
  'AIS',
  'TK',
  'N',
  'Alternate',
  'Range',
  'WhitePoint',
  'BlackPoint',
  'Gamma',
  'FunctionType',
  'Domain',
  'Size',
  'BitsPerSample',
  'Order',
  'Encode',
  'C0',
  'C1',
  'Bounds',
  'Functions',
  'PatternType',
  'PaintType',
  'TilingType',
  'XStep',
  'YStep',
  'Shading',
  'ExtGState',
  'ShadingType',
  'Background',
  'AntiAlias',
  'Function',
  'Coords',
  'Extend',
  'BitsPerCoordinate',
  'BitsPerFlag',
  'VerticesPerRow',
  'Predictor',
  'Colors',
  'Columns',
  'EarlyChange',
  'EndOfLine',
  'EncodedByteAlign',
  'Rows',
  'EndOfBlock',
  'BlackIs1',
  'DamagedRowsBeforeError',
  'JBIG2Globals',
]);
// These define drawing semantics, not arbitrary alternate content. Material
// resource identifiers are inspected separately as dictionary keys.
const STANDARD_APPEARANCE_NAMES = new Set([
  'Page',
  'Pages',
  'Font',
  'XObject',
  'ExtGState',
  'Type0',
  'Type1',
  'MMType1',
  'TrueType',
  'Type3',
  'CIDFontType0',
  'CIDFontType2',
  'FontDescriptor',
  'Image',
  'Form',
  'Pattern',
  'Shading',
  'Function',
  'Group',
  'Transparency',
  'DeviceRGB',
  'PDF',
  'Text',
  'ImageB',
  'ImageC',
  'ImageI',
  'DeviceGray',
  'DeviceCMYK',
  'CalRGB',
  'CalGray',
  'Lab',
  'ICCBased',
  'Indexed',
  'Separation',
  'DeviceN',
  'Identity',
  'Identity-H',
  'Identity-V',
  'WinAnsiEncoding',
  'MacRomanEncoding',
  'MacExpertEncoding',
  'StandardEncoding',
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Times-BoldItalic',
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
  'Symbol',
  'ZapfDingbats',
  'FlateDecode',
  'DCTDecode',
  'JPXDecode',
  'CCITTFaxDecode',
  'JBIG2Decode',
  'LZWDecode',
  'RunLengthDecode',
  'ASCIIHexDecode',
  'ASCII85Decode',
  'Normal',
  'Compatible',
  'Multiply',
  'Screen',
  'Overlay',
  'Darken',
  'Lighten',
  'ColorDodge',
  'ColorBurn',
  'HardLight',
  'SoftLight',
  'Difference',
  'Exclusion',
  'Hue',
  'Saturation',
  'Color',
  'Luminosity',
  'Alpha',
  'None',
  'RelativeColorimetric',
  'AbsoluteColorimetric',
  'Perceptual',
  'Saturation',
]);
const unsafeRetention = () =>
  new PdfExportError(
    'redaction-unsafe-retention',
    'This PDF shares original redacted content through another page or hidden reference. Kagaz cannot safely export these redactions. Extract the redacted pages separately.',
  );

async function fingerprint(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}

function graphObjects(
  document: PDFDocument,
  roots: readonly PDFObject[],
): readonly PDFObject[] {
  const found = new Set<PDFObject>();
  const pending = [...roots];
  while (pending.length) {
    const object = document.context.lookup(pending.pop());
    if (!object || found.has(object)) continue;
    found.add(object);
    if (found.size > MAX_GRAPH_OBJECTS) throw unsafeRetention();
    if (object instanceof PDFArray) pending.push(...object.asArray());
    const dictionary =
      object instanceof PDFRawStream
        ? object.dict
        : object instanceof PDFDict
          ? object
          : null;
    if (dictionary)
      pending.push(...dictionary.entries().map(([, value]) => value));
  }
  return [...found];
}

function isClosedStandardFont(dictionary: PDFDict): boolean {
  const keys = dictionary.keys().map((key) => key.decodeText());
  const constantName = (key: string) => {
    const value = dictionary.get(PDFName.of(key));
    return value instanceof PDFName ? value.decodeText() : undefined;
  };
  if (
    keys.some(
      (key) =>
        key !== 'Type' &&
        key !== 'Subtype' &&
        key !== 'BaseFont' &&
        key !== 'Encoding',
    ) ||
    constantName('Type') !== 'Font' ||
    constantName('Subtype') !== 'Type1'
  )
    return false;
  const family = constantName('BaseFont');
  if (!family || !STANDARD_FONT_FAMILIES.has(family)) return false;
  const encoding = constantName('Encoding');
  return (
    !dictionary.has(PDFName.of('Encoding')) ||
    (encoding !== undefined &&
      [
        'WinAnsiEncoding',
        'MacRomanEncoding',
        'MacExpertEncoding',
        'StandardEncoding',
      ].includes(encoding))
  );
}

/**
 * Numeric arrays and dictionaries can be alternate original information too.
 * Reject shared source resource identities before copyPages; only a closed
 * Standard 14 font definition contains exclusively known drawing constants.
 */
export function assertNoSharedRedactedResources(
  source: PDFDocument,
  redactedPageIndices: readonly number[],
  preservedPageIndices: readonly number[],
): void {
  if (!redactedPageIndices.length || !preservedPageIndices.length) return;
  const resourceRoots = (indices: readonly number[]) =>
    indices.flatMap((index) => {
      const resources = source.getPage(index).node.Resources();
      return resources ? [resources] : [];
    });
  const affectedObjects = new Set(
    graphObjects(source, resourceRoots(redactedPageIndices)),
  );
  for (const object of graphObjects(
    source,
    resourceRoots(preservedPageIndices),
  )) {
    if (!affectedObjects.has(object)) continue;
    if (object instanceof PDFRawStream) throw unsafeRetention();
    if (object instanceof PDFArray && object.size() > 0)
      throw unsafeRetention();
    if (
      object instanceof PDFDict &&
      object.keys().length > 0 &&
      !isClosedStandardFont(object)
    )
      throw unsafeRetention();
  }
}

/**
 * Object identities change between duplicate source instances and copyPages.
 * Resolved child hashes detect the same original resource payload regardless
 * of indirect object numbers or dictionary key ordering. Streams stay encoded.
 */
export async function resourceContentFingerprints(
  source: PDFDocument,
  pageIndices: readonly number[],
  checkAbort: () => void = () => undefined,
): Promise<ReadonlySet<string>> {
  const roots = pageIndices.flatMap((index) => {
    const resources = source.getPage(index).node.Resources();
    return resources ? [resources] : [];
  });
  const objects = graphObjects(source, roots);
  const memo = new Map<PDFObject, string>();
  const active = new Set<PDFObject>();
  const encode = (value: string) => new TextEncoder().encode(value);
  const childHash = async (
    entry: PDFObject,
    depth: number,
  ): Promise<string> => {
    checkAbort();
    if (depth > 128) throw unsafeRetention();
    const object = source.context.lookup(entry);
    if (!object || active.has(object)) throw unsafeRetention();
    const existing = memo.get(object);
    if (existing) return existing;
    if (memo.size + active.size >= MAX_GRAPH_OBJECTS) throw unsafeRetention();
    active.add(object);
    let value: string;
    if (object instanceof PDFRawStream) {
      value = JSON.stringify([
        'stream',
        await childHash(object.dict, depth + 1),
        await fingerprint(object.getContents()),
      ]);
    } else if (object instanceof PDFDict) {
      const entries = [...object.entries()].sort(([first], [second]) =>
        first.decodeText() < second.decodeText()
          ? -1
          : first.decodeText() > second.decodeText()
            ? 1
            : 0,
      );
      const children: [string, string][] = [];
      for (const [key, child] of entries)
        children.push([key.decodeText(), await childHash(child, depth + 1)]);
      value = JSON.stringify(['dictionary', children]);
    } else if (object instanceof PDFArray) {
      const children: string[] = [];
      for (const child of object.asArray())
        children.push(await childHash(child, depth + 1));
      value = JSON.stringify(['array', children]);
    } else if (object instanceof PDFString || object instanceof PDFHexString) {
      value = JSON.stringify(['string', await fingerprint(object.asBytes())]);
    } else if (object instanceof PDFName) {
      value = JSON.stringify(['name', object.decodeText()]);
    } else {
      value = JSON.stringify(['scalar', object.toString()]);
    }
    const result = await fingerprint(encode(value));
    active.delete(object);
    memo.set(object, result);
    return result;
  };
  const result = new Set<string>();
  for (const object of objects) {
    checkAbort();
    const dictionary =
      object instanceof PDFRawStream
        ? object.dict
        : object instanceof PDFDict
          ? object
          : null;
    for (const key of dictionary?.keys() ?? []) {
      if (
        !APPEARANCE_DICTIONARY_KEYS.has(key.decodeText()) &&
        !RESOURCE_CATEGORIES.has(key.decodeText())
      )
        result.add('key:' + (await fingerprint(key.asBytes())));
    }
    const material =
      object instanceof PDFRawStream ||
      (object instanceof PDFArray && object.size() > 0) ||
      (object instanceof PDFDict &&
        object.keys().length > 0 &&
        !isClosedStandardFont(object));
    if (material) result.add('resource:' + (await childHash(object, 0)));
  }
  return result;
}

/** Preserve ordinary appearance pages only; unknown alternate representations fail closed. */
export function assertSafePreservedPages(
  source: PDFDocument,
  pageIndices: readonly number[],
): void {
  const allowedPageKeys = new Set([
    'Type',
    'Parent',
    'Resources',
    'Contents',
    'MediaBox',
    'CropBox',
    'BleedBox',
    'TrimBox',
    'ArtBox',
    'Rotate',
    'UserUnit',
    'Annots',
  ]);
  const forbiddenKeys = new Set([
    'Metadata',
    'PieceInfo',
    'Thumb',
    'PresSteps',
    'AF',
    'EmbeddedFiles',
    'Alternates',
    'OPI',
    'ActualText',
    'Alt',
    'Properties',
    'F',
    'FFilter',
    'FDecodeParms',
  ]);
  for (const index of pageIndices) {
    const page = source.getPage(index);
    if (page.node.keys().some((key) => !allowedPageKeys.has(key.decodeText())))
      throw unsafeRetention();
    if ((page.node.Annots()?.size() ?? 0) !== 0) throw unsafeRetention();
    if (
      page.node
        .Resources()
        ?.keys()
        .some((key) => !RESOURCE_CATEGORIES.has(key.decodeText()))
    )
      throw unsafeRetention();
    // Exclude /Parent from traversal: it is not copied by pdf-lib either.
    const roots = page.node
      .entries()
      .filter(([key]) => key.decodeText() !== 'Parent')
      .map(([, value]) => value);
    const objects = graphObjects(source, roots);
    const namedTables = new Set<PDFDict>();
    const resourceDictionaries = new Set<PDFDict>();
    for (const object of [page.node, ...objects]) {
      const dictionary =
        object instanceof PDFRawStream
          ? object.dict
          : object instanceof PDFDict
            ? object
            : null;
      if (!dictionary) continue;
      const resources = dictionary.lookupMaybe(
        PDFName.of('Resources'),
        PDFDict,
      );
      if (resources) {
        resourceDictionaries.add(resources);
        if (
          resources
            .keys()
            .some((key) => !RESOURCE_CATEGORIES.has(key.decodeText()))
        )
          throw unsafeRetention();
        for (const [key, value] of resources.entries()) {
          const category = key.decodeText();
          const resolved = source.context.lookup(value);
          if (category === 'ProcSet') {
            if (
              !(resolved instanceof PDFArray) ||
              resolved
                .asArray()
                .some(
                  (entry) => !(source.context.lookup(entry) instanceof PDFName),
                )
            )
              throw unsafeRetention();
            continue;
          }
          if (!(resolved instanceof PDFDict)) throw unsafeRetention();
          namedTables.add(resolved);
          for (const entry of resolved.values()) {
            const item = source.context.lookup(entry);
            const valid =
              category === 'ColorSpace'
                ? item instanceof PDFName || item instanceof PDFArray
                : category === 'XObject'
                  ? item instanceof PDFRawStream
                  : category === 'Pattern' || category === 'Shading'
                    ? item instanceof PDFDict || item instanceof PDFRawStream
                    : item instanceof PDFDict;
            if (!valid) throw unsafeRetention();
          }
        }
      }
      const charProcs = dictionary.lookupMaybe(
        PDFName.of('CharProcs'),
        PDFDict,
      );
      if (charProcs) {
        namedTables.add(charProcs);
        if (
          charProcs
            .values()
            .some(
              (value) =>
                !(source.context.lookup(value) instanceof PDFRawStream),
            )
        )
          throw unsafeRetention();
      }
    }
    for (const object of objects) {
      const dictionary =
        object instanceof PDFRawStream
          ? object.dict
          : object instanceof PDFDict
            ? object
            : null;
      if (dictionary?.keys().some((key) => forbiddenKeys.has(key.decodeText())))
        throw unsafeRetention();
      if (
        dictionary &&
        !namedTables.has(dictionary) &&
        !resourceDictionaries.has(dictionary) &&
        dictionary
          .keys()
          .some((key) => !APPEARANCE_DICTIONARY_KEYS.has(key.decodeText()))
      )
        throw unsafeRetention();
    }
  }
}

function equalBytes(first: Uint8Array, second: Uint8Array): boolean {
  return (
    first.byteLength === second.byteLength &&
    first.every((value, index) => value === second[index])
  );
}

/** Never inflate attacker data just to exempt known generated graphics wrappers. */
function controlOnlyMatcher(
  document: PDFDocument,
): (stream: PDFRawStream) => boolean {
  const knownWrappers = [
    '',
    '\n',
    'q\n',
    'Q\n',
    'n\n',
    'q\nQ\n',
    'q\nQ\nn\n',
  ].map((value) => document.context.flateStream(value).getContents());
  return (stream) => {
    // Image samples, fonts, CMaps or custom streams may contain the bytes q/Q/n.
    if (
      stream.dict
        .keys()
        .some(
          (key) =>
            key.decodeText() !== 'Length' && key.decodeText() !== 'Filter',
        )
    )
      return false;
    const bytes = stream.getContents();
    if (bytes.byteLength > 128) return false;
    const filter = stream.dict.get(PDFName.of('Filter'));
    if (!filter)
      return /^\s*(?:(?:q|Q|n)(?:\s+|$))*$/.test(
        new TextDecoder().decode(bytes),
      );
    return (
      filter.toString() === '/FlateDecode' &&
      knownWrappers.some((wrapper) => equalBytes(bytes, wrapper))
    );
  };
}

/** Original streams and page-reachable alternate strings must not survive elsewhere. */
export async function appearanceContentFingerprints(
  document: PDFDocument,
  checkAbort: () => void = () => undefined,
  includeResourceIdentifiers = true,
): Promise<ReadonlySet<string>> {
  // Original source resource compounds are captured before copying, across
  // every source ID. The throwaway appearance also contains newly generated
  // annotation style dictionaries (e.g. /ca 1 and /CA 1); those known drawing
  // states may legitimately recur on preserved pages. Keep the post-flatten
  // content/asset/string/name/key checks without treating new styles as source.
  const fingerprints = new Set<string>();
  const isControlOnlyStream = controlOnlyMatcher(document);
  const resourceObjects = includeResourceIdentifiers
    ? new Set<PDFObject>()
    : new Set(
        graphObjects(
          document,
          document.getPages().flatMap((page) => {
            const resources = page.node.Resources();
            return resources ? [resources] : [];
          }),
        ),
      );
  const objects = graphObjects(
    document,
    document.getPages().map((page) => page.node),
  );
  let imagePixels = 0;
  for (const object of objects) {
    checkAbort();
    const dictionary =
      object instanceof PDFRawStream
        ? object.dict
        : object instanceof PDFDict
          ? object
          : null;
    if (
      dictionary &&
      (includeResourceIdentifiers || !resourceObjects.has(object))
    ) {
      for (const key of dictionary.keys()) {
        if (
          !APPEARANCE_DICTIONARY_KEYS.has(key.decodeText()) &&
          !RESOURCE_CATEGORIES.has(key.decodeText())
        ) {
          fingerprints.add('key:' + (await fingerprint(key.asBytes())));
        }
      }
    }
    if (object instanceof PDFString || object instanceof PDFHexString) {
      if (object.asBytes().byteLength > 0)
        fingerprints.add('string:' + (await fingerprint(object.asBytes())));
      continue;
    }
    if (
      object instanceof PDFName &&
      !STANDARD_APPEARANCE_NAMES.has(object.decodeText())
    ) {
      fingerprints.add('name:' + (await fingerprint(object.asBytes())));
      continue;
    }
    if (!(object instanceof PDFRawStream)) continue;
    const subtype = object.dict
      .lookupMaybe(PDFName.of('Subtype'), PDFName)
      ?.toString();
    if (subtype === '/Image') {
      const width = object.dict
        .lookupMaybe(PDFName.of('Width'), PDFNumber)
        ?.asNumber();
      const height = object.dict
        .lookupMaybe(PDFName.of('Height'), PDFNumber)
        ?.asNumber();
      const pixels = (width ?? NaN) * (height ?? NaN);
      imagePixels += pixels;
      if (
        !Number.isFinite(pixels) ||
        !width ||
        !height ||
        width < 1 ||
        height < 1 ||
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        pixels > REDACTION_MAX_PIXELS ||
        imagePixels > REDACTION_MAX_IMAGE_PIXELS
      ) {
        throw new PdfExportError(
          'redaction-too-large',
          'This page contains images too large to safely finalize redactions in the browser.',
        );
      }
    }
    if (!isControlOnlyStream(object)) {
      fingerprints.add(await fingerprint(object.getContents()));
    }
  }
  return fingerprints;
}

/** Checks all serialized objects, including detached ones; page-tree removal alone is insufficient. */
export async function assertNoOriginalRedactedContent(
  output: PDFDocument,
  originalFingerprints: ReadonlySet<string>,
  checkAbort: () => void = () => undefined,
  rasterizedPageIndices: ReadonlySet<number> = new Set(),
): Promise<void> {
  await output.flush();
  const outputPages = new Set<PDFDict>(
    output.getPages().map((page) => page.node),
  );
  const objects = graphObjects(
    output,
    output.context.enumerateIndirectObjects().map(([, object]) => object),
  );
  // /Parent would reach the complete final page tree, including fresh raster
  // pages whose known generated identifiers may coincide with harmless source
  // identifiers. Check only the source graphs actually retained by copyPages.
  const preservedRoots = output.getPages().flatMap((page, index) =>
    rasterizedPageIndices.has(index)
      ? []
      : page.node
          .entries()
          .filter(([key]) => key.decodeText() !== 'Parent')
          .map(([, value]) => value),
  );
  const preservedResourceFingerprints = await resourceContentFingerprints(
    output,
    output
      .getPages()
      .flatMap((_, index) => (rasterizedPageIndices.has(index) ? [] : [index])),
    checkAbort,
  );
  for (const resource of preservedResourceFingerprints)
    if (originalFingerprints.has(resource)) throw unsafeRetention();
  for (const object of graphObjects(output, preservedRoots)) {
    checkAbort();
    const dictionary =
      object instanceof PDFRawStream
        ? object.dict
        : object instanceof PDFDict
          ? object
          : null;
    for (const key of dictionary?.keys() ?? []) {
      if (originalFingerprints.has('key:' + (await fingerprint(key.asBytes()))))
        throw unsafeRetention();
    }
  }
  for (const object of objects) {
    checkAbort();
    if (
      object instanceof PDFName &&
      originalFingerprints.has('name:' + (await fingerprint(object.asBytes())))
    )
      throw unsafeRetention();
    if (
      (object instanceof PDFString || object instanceof PDFHexString) &&
      originalFingerprints.has(
        'string:' + (await fingerprint(object.asBytes())),
      )
    )
      throw unsafeRetention();
    if (
      object instanceof PDFDict &&
      object.lookupMaybe(PDFName.of('Type'), PDFName)?.toString() === '/Page' &&
      !outputPages.has(object)
    )
      throw unsafeRetention();
    if (
      object instanceof PDFRawStream &&
      originalFingerprints.has(await fingerprint(object.getContents()))
    )
      throw unsafeRetention();
  }
}
