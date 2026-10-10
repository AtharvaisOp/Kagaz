import { PdfExportError } from '../types';
import { assertWatermarkImageBytes } from './imageSafety';

const INPUT_CHUNK_BYTES = 1024;
const INFLATE_TIMEOUT_MS = 10_000;
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

function invalidData(): PdfExportError {
  return new PdfExportError(
    'watermark-image-invalid',
    'The PNG watermark has invalid compressed pixel data. Choose a valid still PNG or JPEG.',
  );
}

/**
 * Browser image decoders may tolerate a corrupt IDAT and display blank pixels.
 * Validate its zlib stream independently before any native pixel decoding or
 * synchronous pdf-lib decoding. Input is fed in small chunks, output is scanned
 * without retaining it, and exact dimensions/filter bytes bound the expansion.
 */
export async function validateWatermarkPngDeflate(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  const { width, height } = assertWatermarkImageBytes(bytes, 'image/png');
  if (typeof DecompressionStream === 'undefined') throw invalidData();
  const checkAbort = () => {
    if (signal?.aborted)
      throw new PdfExportError('aborted', 'PDF export was cancelled.');
  };
  checkAbort();
  const channels = (
    { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Readonly<Record<number, number>>
  )[bytes[25]!]!;
  const bitDepth = bytes[24]!;
  const passes = bytes[28] === 1 ? ADAM7 : [[0, 0, 1, 1] as const];
  const layouts = passes.flatMap(([x, y, stepX, stepY]) => {
    const passWidth = width > x ? Math.ceil((width - x) / stepX) : 0;
    const rows = height > y ? Math.ceil((height - y) / stepY) : 0;
    return passWidth && rows
      ? [
          {
            bytesPerRow: 1 + Math.ceil((passWidth * channels * bitDepth) / 8),
            rows,
          },
        ]
      : [];
  });
  const expectedBytes = layouts.reduce(
    (total, layout) => total + layout.rows * layout.bytesPerRow,
    0,
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ranges: { start: number; end: number }[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset);
    if (
      bytes[offset + 4] === 73 &&
      bytes[offset + 5] === 68 &&
      bytes[offset + 6] === 65 &&
      bytes[offset + 7] === 84 &&
      length
    )
      ranges.push({ start: offset + 8, end: offset + 8 + length });
    offset += 12 + length;
  }
  let rangeIndex = 0;
  let inputOffset = ranges[0]?.start ?? 0;
  const input = new ReadableStream<BufferSource>({
    pull(controller) {
      checkAbort();
      const range = ranges[rangeIndex];
      if (!range) {
        controller.close();
        return;
      }
      const end = Math.min(inputOffset + INPUT_CHUNK_BYTES, range.end);
      controller.enqueue(bytes.slice(inputOffset, end));
      inputOffset = end;
      if (inputOffset === range.end) {
        rangeIndex += 1;
        inputOffset = ranges[rangeIndex]?.start ?? 0;
      }
    },
  });
  const reader = input
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader();
  let timedOut = false;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    cancel();
  }, INFLATE_TIMEOUT_MS);
  let produced = 0;
  let passIndex = 0;
  let row = 0;
  let rowRemaining = 0;
  let yieldAtBytes = 1024 * 1024;
  try {
    while (true) {
      checkAbort();
      const { done, value } = await reader.read();
      checkAbort();
      if (timedOut) throw invalidData();
      if (done) break;
      produced += value.byteLength;
      if (produced > expectedBytes) throw invalidData();
      let offset = 0;
      while (offset < value.length) {
        const layout = layouts[passIndex];
        if (!layout) throw invalidData();
        if (rowRemaining === 0) {
          if (value[offset++]! > 4) throw invalidData();
          rowRemaining = layout.bytesPerRow - 1;
        }
        const consumed = Math.min(rowRemaining, value.length - offset);
        rowRemaining -= consumed;
        offset += consumed;
        if (rowRemaining === 0 && ++row === layout.rows) {
          row = 0;
          passIndex += 1;
        }
      }
      if (produced >= yieldAtBytes) {
        // A buffered reader may resolve immediately; yield to input, abort and
        // timeout handlers rather than consuming all 128 MiB in microtasks.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        checkAbort();
        if (timedOut) throw invalidData();
        yieldAtBytes = produced + 1024 * 1024;
      }
    }
    if (
      produced !== expectedBytes ||
      rowRemaining !== 0 ||
      passIndex !== layouts.length
    )
      throw invalidData();
  } catch (error) {
    checkAbort();
    if (error instanceof PdfExportError) throw error;
    throw invalidData();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
