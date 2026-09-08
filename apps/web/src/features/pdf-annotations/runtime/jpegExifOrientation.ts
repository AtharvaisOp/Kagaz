export type JpegExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const UNSUPPORTED_JPEG_ORIENTATION_MESSAGE =
  'This photo uses camera orientation metadata that Kagaz cannot export correctly yet. Save or rotate the image normally and try again.';

export class UnsupportedJpegOrientationError extends Error {
  constructor() {
    super(UNSUPPORTED_JPEG_ORIENTATION_MESSAGE);
    this.name = 'UnsupportedJpegOrientationError';
  }
}

function isAvailable(
  offset: number,
  byteLength: number,
  lowerBound: number,
  upperBound: number,
): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    offset >= lowerBound &&
    offset <= upperBound - byteLength
  );
}

function readExifOrientation(
  bytes: Uint8Array,
  payloadStart: number,
  payloadEnd: number,
): JpegExifOrientation | null {
  if (
    !isAvailable(payloadStart, 6, 0, payloadEnd) ||
    bytes[payloadStart] !== 0x45 ||
    bytes[payloadStart + 1] !== 0x78 ||
    bytes[payloadStart + 2] !== 0x69 ||
    bytes[payloadStart + 3] !== 0x66 ||
    bytes[payloadStart + 4] !== 0 ||
    bytes[payloadStart + 5] !== 0
  ) {
    return null;
  }

  const tiffStart = payloadStart + 6;
  if (!isAvailable(tiffStart, 8, payloadStart, payloadEnd)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteOrder = view.getUint16(tiffStart, false);
  const littleEndian = byteOrder === 0x4949;
  if (!littleEndian && byteOrder !== 0x4d4d) return null;
  if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return null;

  const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
  const ifdStart = tiffStart + ifdOffset;
  if (!isAvailable(ifdStart, 2, tiffStart, payloadEnd)) return null;
  const entryCount = view.getUint16(ifdStart, littleEndian);
  const entriesStart = ifdStart + 2;
  if (entryCount > Math.floor((payloadEnd - entriesStart) / 12)) return null;

  for (let index = 0; index < entryCount; index += 1) {
    const entryStart = entriesStart + index * 12;
    if (!isAvailable(entryStart, 12, tiffStart, payloadEnd)) return null;
    if (view.getUint16(entryStart, littleEndian) !== 0x0112) continue;
    if (view.getUint16(entryStart + 2, littleEndian) !== 3) return null;

    const valueCount = view.getUint32(entryStart + 4, littleEndian);
    if (valueCount < 1) return null;
    let valueOffset = entryStart + 8;
    if (valueCount > 2) {
      const referencedOffset = view.getUint32(entryStart + 8, littleEndian);
      valueOffset = tiffStart + referencedOffset;
    }
    if (!isAvailable(valueOffset, 2, tiffStart, payloadEnd)) return null;
    const orientation = view.getUint16(valueOffset, littleEndian);
    return orientation >= 1 && orientation <= 8
      ? (orientation as JpegExifOrientation)
      : null;
  }

  return null;
}

export function readJpegExifOrientation(
  bytes: Uint8Array,
): JpegExifOrientation | null {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    if (marker === undefined) return null;
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (!isAvailable(offset, 2, 0, bytes.length)) return null;

    const lengthHigh = bytes[offset];
    const lengthLow = bytes[offset + 1];
    if (lengthHigh === undefined || lengthLow === undefined) return null;
    const segmentLength = (lengthHigh << 8) | lengthLow;
    if (segmentLength < 2) return null;
    const payloadStart = offset + 2;
    const payloadEnd = offset + segmentLength;
    if (!isAvailable(payloadStart, segmentLength - 2, 0, bytes.length)) {
      return null;
    }
    if (marker === 0xe1) {
      const orientation = readExifOrientation(bytes, payloadStart, payloadEnd);
      if (orientation !== null) return orientation;
    }
    offset = payloadEnd;
  }

  return null;
}

export async function rejectUnsupportedJpegOrientation(
  blob: Blob,
): Promise<void> {
  const orientation = readJpegExifOrientation(
    new Uint8Array(await blob.arrayBuffer()),
  );
  if (orientation !== null && orientation !== 1) {
    throw new UnsupportedJpegOrientationError();
  }
}
