// Trusted synthetic-fixture utilities only. Production inspection uses Python.
import { readFile } from 'node:fs/promises';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export const OFFICE_FIXTURES = [
  {
    name: 'paragraphs.docx',
    format: 'docx',
    pages: 1,
    words: ['Kagaz Writer', 'First paragraph', 'Bold formatted'],
  },
  {
    name: 'image-page-break.docx',
    format: 'docx',
    pages: 2,
    words: ['Kagaz Writer', 'Second Page', 'Explicit page break'],
    image: true,
  },
  {
    name: 'slides.pptx',
    format: 'pptx',
    pages: 3,
    words: ['Kagaz Slide 1', 'Kagaz Slide 2', 'Kagaz Slide 3'],
    image: true,
  },
  {
    name: 'sheet.xlsx',
    format: 'xlsx',
    pages: 1,
    words: ['Kagaz Budget', 'Paper', 'Printing', '375'],
  },
  {
    name: 'sheets.xlsx',
    format: 'xlsx',
    pages: 2,
    words: ['Kagaz Budget', 'Kagaz Summary', 'Paper', '375'],
  },
];
export const officeFixture = (name) =>
  readFile(
    new URL(`../apps/api/src/tools/fixtures/office/${name}`, import.meta.url),
  );

export function archiveEntries(bytes) {
  const end = bytes.lastIndexOf(Buffer.from('PK\x05\x06'));
  let cursor = bytes.readUInt32LE(end + 16);
  const entries = [];
  while (cursor < end) {
    const nameLength = bytes.readUInt16LE(cursor + 28),
      extra = bytes.readUInt16LE(cursor + 30),
      comment = bytes.readUInt16LE(cursor + 32);
    const name = bytes
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString();
    const local = bytes.readUInt32LE(cursor + 42),
      compressed = bytes.readUInt32LE(cursor + 20);
    const start =
      local +
      30 +
      bytes.readUInt16LE(local + 26) +
      bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(start, start + compressed);
    entries.push([
      name,
      bytes.readUInt16LE(cursor + 10) === 8
        ? inflateRawSync(raw)
        : Buffer.from(raw),
    ]);
    cursor += 46 + nameLength + extra + comment;
  }
  return entries;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipEntries(
  entries,
  { flags = 0, stored = false, mode = 0o600 } = {},
) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name),
      bytes = Buffer.from(data),
      compressed = stored ? bytes : deflateRawSync(bytes);
    const local = Buffer.alloc(30),
      directory = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc32(bytes), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(0x314, 4);
    directory.writeUInt16LE(20, 6);
    local.copy(directory, 8, 6, 26);
    directory.writeUInt16LE(nameBytes.length, 28);
    directory.writeUInt32LE((mode << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    central.push(directory, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
export const OFFICE_ATTACKS = [
  'macro-part',
  'macro-content-type',
  'macro-relationship',
  'traversal',
  'absolute-path',
  'backslash',
  'pptm-part',
  'pptm-content-type',
  'pptm-relationship',
  'xlsm-part',
  'xlsm-content-type',
  'xlsm-relationship',
  'uri-escape',
  'duplicate',
  'case-alias',
  'symlink',
  'encrypted-zip',
  'malformed-zip',
  'malformed-xml',
  'xml-entity',
  'external-image',
  'external-template',
  'file-resource',
  'missing-content-types',
  'wrong-main-type',
  'mixed-families',
  'zip-bomb',
  'entry-limit',
  'individual-limit',
  'expanded-limit',
  'embedded-executable',
  'embedded-package',
  'direct-image-url',
  'field-resource',
  'remote-formula',
  'remote-defined-name',
  'dangerous-defined-name',
  'legacy-encryption',
  'trailing-payload',
  'local-header-mismatch',
  'crc-corrupt',
];

function boundedExpansion(size) {
  const pattern = Buffer.alloc(256 * 1024);
  let seed = 0x4b414741;
  for (let offset = 0; offset < pattern.length; offset++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    pattern[offset] = seed & 0xff;
  }
  const repeats = Math.ceil(size / pattern.length);
  return Buffer.concat(
    Array(repeats).fill(pattern),
    repeats * pattern.length,
  ).subarray(0, size);
}

export async function officeAttack(kind) {
  const fixture = kind.startsWith('pptm-')
    ? 'slides.pptx'
    : kind.startsWith('xlsm-') ||
        [
          'remote-formula',
          'remote-defined-name',
          'dangerous-defined-name',
        ].includes(kind)
      ? 'sheet.xlsx'
      : 'paragraphs.docx';
  const input = await officeFixture(fixture);
  let entries = archiveEntries(input),
    flags = 0,
    mode = 0o600;
  const edit = (name, transform) => {
    entries = entries.map(([n, data]) => [
      n,
      n === name ? Buffer.from(transform(data.toString())) : data,
    ]);
  };
  const add = (name, data = '<x/>') => entries.push([name, Buffer.from(data)]);
  const relationship = (part, type, target, extra = '') =>
    edit(part, (data) => {
      const closing = /<\/(?:([A-Za-z0-9_]+:)?)Relationships>/.exec(data)?.[0];
      if (!closing) return data;
      const prefix = closing.slice(2, -'Relationships>'.length);
      return data.replace(
        closing,
        `<${prefix}Relationship Id="evil" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}" ${extra}/>${closing}`,
      );
    });
  switch (kind) {
    case 'macro-part':
      add('word/vbaProject.bin', 'macro payload');
      break;
    case 'macro-content-type':
      edit('[Content_Types].xml', (s) =>
        s.replace(
          'wordprocessingml.document.main+xml',
          'wordprocessingml.document.macroEnabled.main+xml',
        ),
      );
      break;
    case 'macro-relationship':
      relationship(
        'word/_rels/document.xml.rels',
        'vbaProject',
        'document.xml',
      );
      break;
    case 'pptm-part':
      add('ppt/vbaProject.bin', 'macro payload');
      break;
    case 'pptm-content-type':
      edit('[Content_Types].xml', (s) =>
        s.replace(
          'presentationml.presentation.main+xml',
          'presentationml.presentation.macroEnabled.main+xml',
        ),
      );
      break;
    case 'pptm-relationship':
      relationship(
        'ppt/_rels/presentation.xml.rels',
        'vbaProject',
        'presentation.xml',
      );
      break;
    case 'xlsm-part':
      add('xl/vbaProject.bin', 'macro payload');
      break;
    case 'xlsm-content-type':
      edit('[Content_Types].xml', (s) =>
        s.replace(
          'spreadsheetml.sheet.main+xml',
          'spreadsheetml.sheet.macroEnabled.main+xml',
        ),
      );
      break;
    case 'xlsm-relationship':
      relationship('xl/_rels/workbook.xml.rels', 'vbaProject', 'workbook.xml');
      break;
    case 'traversal':
      add('../outside.xml');
      break;
    case 'absolute-path':
      add('/tmp/outside.xml');
      break;
    case 'backslash':
      add('word\\outside.xml');
      break;
    case 'uri-escape':
      add('word/%2e%2e/outside.xml');
      break;
    case 'duplicate':
      entries.push(entries[0]);
      break;
    case 'case-alias':
      add('WORD/DOCUMENT.XML');
      break;
    case 'symlink':
      mode = 0o120777;
      break;
    case 'encrypted-zip':
      flags = 1;
      break;
    case 'malformed-zip':
      return Buffer.from('PK\x03\x04broken');
    case 'malformed-xml':
      edit('word/document.xml', () => '<broken');
      break;
    case 'xml-entity':
      edit(
        'word/document.xml',
        () =>
          '<!DOCTYPE doc [<!ENTITY evil SYSTEM "file:///etc/passwd">]><doc>&evil;</doc>',
      );
      break;
    case 'external-image':
      relationship(
        'word/_rels/document.xml.rels',
        'image',
        'https://127.0.0.1:9/secret.png',
        'TargetMode="External"',
      );
      break;
    case 'external-template':
      relationship(
        'word/_rels/document.xml.rels',
        'attachedTemplate',
        'https://hostile.invalid/template',
        'TargetMode="External"',
      );
      break;
    case 'file-resource':
      relationship(
        'word/_rels/document.xml.rels',
        'image',
        'file:///etc/passwd',
      );
      break;
    case 'missing-content-types':
      entries = entries.filter(([name]) => name !== '[Content_Types].xml');
      break;
    case 'wrong-main-type':
      edit('[Content_Types].xml', (s) =>
        s.replace(
          'wordprocessingml.document.main+xml',
          'spreadsheetml.sheet.main+xml',
        ),
      );
      break;
    case 'mixed-families':
      add('xl/workbook.xml');
      break;
    case 'zip-bomb':
      add('docProps/bomb.xml', 'x'.repeat(2 * 1024 * 1024));
      break;
    case 'entry-limit':
      for (let n = 0; n < 2049; n++) add(`docProps/part${n}.xml`);
      break;
    case 'individual-limit': {
      // A 16 MiB + 1 payload compresses below the 10 MiB package limit while
      // staying under the 100:1 ratio ceiling, isolating the per-entry guard.
      add('word/large.png', boundedExpansion(16 * 1024 * 1024 + 1));
      break;
    }
    case 'expanded-limit': {
      // Five independently moderate-ratio entries exceed the 64 MiB aggregate
      // cap while the complete archive remains comfortably below 10 MiB.
      for (let n = 0; n < 5; n++)
        add(`word/large${n}.png`, boundedExpansion(14 * 1024 * 1024));
      break;
    }
    case 'embedded-executable':
      add('word/program.exe', 'MZ malicious');
      break;
    case 'embedded-package':
      add('word/embeddings/package.zip', 'PK payload');
      break;
    case 'direct-image-url':
      edit('word/document.xml', (s) =>
        s.replace(
          '<w:body>',
          '<w:body><w:imagedata src="https://hostile.invalid/image"/>',
        ),
      );
      break;
    case 'field-resource':
      edit('word/document.xml', (s) =>
        s.replace(
          '<w:body>',
          '<w:body><w:instrText>INCLUDEPICTURE https://hostile.invalid/image</w:instrText>',
        ),
      );
      break;
    case 'remote-formula':
      edit('xl/worksheets/sheet1.xml', (s) =>
        s.replace('SUM(B2:B3)', 'WEBSERVICE(A2)'),
      );
      break;
    case 'remote-defined-name':
      edit('xl/workbook.xml', (s) =>
        s.replace(
          '</definedNames>',
          '<definedName name="Remote">WEBSERVICE(A2)</definedName></definedNames>',
        ),
      );
      break;
    case 'dangerous-defined-name':
      edit('xl/workbook.xml', (s) =>
        s.replace(
          '</definedNames>',
          '<definedName name="Auto_Open">CALL(A1)</definedName></definedNames>',
        ),
      );
      break;
    case 'legacy-encryption':
      return Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  const result = zipEntries(entries, { flags, mode });
  if (kind === 'trailing-payload')
    return Buffer.concat([result, Buffer.from('payload')]);
  if (kind === 'local-header-mismatch') result[30] ^= 1;
  if (kind === 'crc-corrupt') result[35] ^= 1;
  return result;
}
