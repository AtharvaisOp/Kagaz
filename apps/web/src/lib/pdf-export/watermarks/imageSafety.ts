import {
  readJpegExifOrientation,
  UNSUPPORTED_JPEG_ORIENTATION_MESSAGE,
} from '../../../features/pdf-annotations/runtime/jpegExifOrientation';
import { PdfExportError } from '../types';

export const WATERMARK_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const WATERMARK_MAX_IMAGE_SIDE = 8192;
export const WATERMARK_MAX_IMAGE_PIXELS = 16_000_000;

function invalidImage(message: string): never {
  throw new PdfExportError('watermark-image-invalid', message);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function chunkCrc(bytes: Uint8Array, start: number, end: number): number {
  let value = 0xffffffff;
  for (let index = start; index < end; index += 1)
    value = crcTable[(value ^ bytes[index]!) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** UPNG walks every header/frame, so inspect the complete bounded chunk sequence. */
function pngDimensions(
  bytes: Uint8Array,
  view: DataView,
): { width: number; height: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 33 ||
    signature.some((value, index) => bytes[index] !== value)
  )
    invalidImage('The selected watermark is not a valid PNG image.');
  let offset = 8;
  let chunks = 0;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = 0;
  let paletteEntries = 0;
  let hasTransparency = false;
  let hasData = false;
  let dataFinished = false;
  while (offset < bytes.length) {
    if (++chunks > 4096 || offset + 12 > bytes.length)
      invalidImage('The PNG watermark has too many or incomplete chunks.');
    const length = view.getUint32(offset);
    const end = offset + 8 + length;
    if (end + 4 > bytes.length)
      invalidImage('The PNG watermark has an incomplete chunk.');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      view.getUint32(end) !== chunkCrc(bytes, offset + 4, end)
    )
      invalidImage('The PNG watermark has invalid chunk data.');
    const start = offset + 8;
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT')
      invalidImage(
        'Animated PNG watermarks are not supported. Choose a still PNG or JPEG.',
      );
    if (chunks === 1 && type !== 'IHDR')
      invalidImage('The PNG watermark must begin with its image header.');
    if (type === 'IHDR') {
      if (chunks !== 1 || length !== 13)
        invalidImage(
          'The PNG watermark has duplicate or invalid image headers.',
        );
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      bitDepth = bytes[start + 8]!;
      colorType = bytes[start + 9]!;
      const validDepths: Readonly<Record<number, readonly number[]>> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !validDepths[colorType]?.includes(bitDepth) ||
        bytes[start + 10] !== 0 ||
        bytes[start + 11] !== 0 ||
        ![0, 1].includes(bytes[start + 12]!)
      )
        invalidImage('This PNG watermark encoding is not supported.');
    } else if (type === 'PLTE') {
      if (
        paletteEntries ||
        hasData ||
        !length ||
        length % 3 ||
        length > 768 ||
        colorType === 0 ||
        colorType === 4
      )
        invalidImage('The PNG watermark has an invalid palette.');
      paletteEntries = length / 3;
      if (colorType === 3 && paletteEntries > 2 ** bitDepth)
        invalidImage('The PNG watermark palette exceeds its bit depth.');
    } else if (type === 'tRNS') {
      if (
        hasTransparency ||
        hasData ||
        (colorType === 0
          ? length !== 2
          : colorType === 2
            ? length !== 6
            : colorType === 3
              ? !paletteEntries || !length || length > paletteEntries
              : true)
      )
        invalidImage('The PNG watermark has invalid transparency.');
      hasTransparency = true;
    } else if (type === 'IDAT') {
      if (dataFinished || (colorType === 3 && !paletteEntries))
        invalidImage('The PNG watermark has invalid image data ordering.');
      hasData ||= length > 0;
    } else if (type === 'tEXt' || type === 'iTXt') {
      // UPNG's metadata decoder searches for NUL without its own chunk bound.
      // Validate every delimiter before permitting it to inspect these bytes.
      const terminator = (from: number): number => {
        const index = bytes.indexOf(0, from);
        if (index < from || index >= end)
          invalidImage('The PNG watermark has malformed text metadata.');
        return index;
      };
      const keywordEnd = terminator(start);
      if (keywordEnd - start < 1 || keywordEnd - start > 79)
        invalidImage('The PNG watermark has invalid metadata keywords.');
      if (type === 'iTXt') {
        const flags = keywordEnd + 1;
        if (
          flags + 2 > end ||
          ![0, 1].includes(bytes[flags]!) ||
          bytes[flags + 1] !== 0
        )
          invalidImage('The PNG watermark has unsupported text metadata.');
        const languageEnd = terminator(flags + 2);
        terminator(languageEnd + 1);
      }
    } else if (type === 'hIST') {
      if (!paletteEntries || length !== paletteEntries * 2)
        invalidImage('The PNG watermark has an invalid palette histogram.');
    } else if (type === 'IEND') {
      if (length !== 0 || !hasData || end + 4 !== bytes.length)
        invalidImage('The PNG watermark has missing data or trailing content.');
      return { width, height };
    } else if (type[0] === type[0]!.toUpperCase()) {
      invalidImage('The PNG watermark has an unsupported critical chunk.');
    }
    if (hasData && type !== 'IDAT') dataFinished = true;
    offset = end + 4;
  }
  invalidImage('The PNG watermark is missing its terminal chunk.');
}

/** Header bounds run before either the browser decoder or pdf-lib allocates pixels. */
export function assertWatermarkImageBytes(
  input: Uint8Array | ArrayBuffer,
  mimeType: 'image/png' | 'image/jpeg',
): { width: number; height: number } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.byteLength || bytes.byteLength > WATERMARK_MAX_IMAGE_BYTES)
    invalidImage('Choose a PNG or JPEG watermark no larger than 10 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  if (mimeType === 'image/png') {
    ({ width, height } = pngDimensions(bytes, view));
  } else if (mimeType === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
      invalidImage('The selected watermark is not a valid JPEG image.');
    const orientation = readJpegExifOrientation(bytes);
    if (orientation !== null && orientation !== 1)
      invalidImage(UNSUPPORTED_JPEG_ORIENTATION_MESSAGE);
    let offset = 2;
    let inScan = false;
    let terminal = false;
    let segments = 0;
    let hasScan = false;
    let hasExif = false;
    while (offset < bytes.length) {
      if (inScan) {
        // Entropy bytes may contain stuffed FF00 and restart markers. Walk to
        // the next real segment, including between progressive JPEG scans, so
        // a second frame cannot hide after the first SOS and allocate pixels.
        offset = bytes.indexOf(0xff, offset);
        if (offset < 0)
          invalidImage('The selected watermark has incomplete JPEG scan data.');
      }
      if (bytes[offset] !== 0xff)
        invalidImage('The selected watermark has an invalid JPEG header.');
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === undefined)
        invalidImage('The selected watermark has an incomplete JPEG marker.');
      if (inScan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7)))
        continue;
      inScan = false;
      if (marker === 0xd9) {
        terminal = true;
        if (offset !== bytes.length)
          invalidImage('The JPEG watermark has trailing image data.');
        break;
      }
      if (marker === 0x01) continue;
      if (marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7))
        invalidImage('The selected watermark has an invalid JPEG marker.');
      if (++segments > 4096)
        invalidImage('The JPEG watermark has too many segments.');
      if (offset + 2 > bytes.length)
        invalidImage('The selected watermark has an incomplete JPEG header.');
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length)
        invalidImage('The selected watermark has an invalid JPEG segment.');
      if (
        marker === 0xe1 &&
        length >= 8 &&
        bytes[offset + 2] === 69 &&
        bytes[offset + 3] === 120 &&
        bytes[offset + 4] === 105 &&
        bytes[offset + 5] === 102 &&
        bytes[offset + 6] === 0 &&
        bytes[offset + 7] === 0
      ) {
        // Native/PDF decoders can disagree about duplicate or late orientation
        // metadata. Only the unique pre-scan EXIF checked above is supported.
        if (hasExif || hasScan)
          invalidImage(UNSUPPORTED_JPEG_ORIENTATION_MESSAGE);
        hasExif = true;
      }
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        // Baseline, extended sequential and progressive frames only. Multiple
        // frames/hierarchical/differential encodings have inconsistent decoders.
        if (
          width ||
          ![0xc0, 0xc1, 0xc2].includes(marker) ||
          length < 8 ||
          bytes[offset + 2] !== 8
        )
          invalidImage('This JPEG watermark encoding is not supported.');
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
      }
      if (marker === 0xda) {
        if (!width || !height)
          invalidImage('The JPEG watermark scan precedes its frame header.');
        inScan = true;
        hasScan = true;
      }
      offset += length;
    }
    if (!terminal)
      invalidImage('The JPEG watermark is missing its terminal marker.');
  } else {
    invalidImage('Choose a PNG or JPEG watermark.');
  }
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > WATERMARK_MAX_IMAGE_SIDE ||
    height > WATERMARK_MAX_IMAGE_SIDE ||
    width * height > WATERMARK_MAX_IMAGE_PIXELS
  )
    invalidImage(
      'Watermark images must be at most 8,192 pixels per side and 16 megapixels.',
    );
  return { width, height };
}

export async function watermarkImageFilePreflight(
  blob: Blob,
): Promise<{ width: number; height: number }> {
  if (blob.type !== 'image/png' && blob.type !== 'image/jpeg')
    invalidImage('Choose a PNG or JPEG watermark.');
  if (!blob.size || blob.size > WATERMARK_MAX_IMAGE_BYTES)
    invalidImage('Choose a PNG or JPEG watermark no larger than 10 MiB.');
  return assertWatermarkImageBytes(await blob.arrayBuffer(), blob.type);
}
