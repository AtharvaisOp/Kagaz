import type { AnnotationImageExportSource } from '../annotations/exportContracts';
import { PdfExportError } from '../types';
import {
  assertWatermarkImageBytes,
  WATERMARK_MAX_IMAGE_BYTES,
} from './imageSafety';
import { validateWatermarkPngDeflate } from './pngInflateSafety';

const NATIVE_IMAGE_TIMEOUT_MS = 10_000;
interface PreparedImage {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}
// Only records produced here are cache keys. The private byte copy is never
// returned to callers, so changing a returned Uint8Array cannot change trust.
const preparedImages = new WeakMap<
  AnnotationImageExportSource,
  PreparedImage
>();

function aborted(): PdfExportError {
  return new PdfExportError('aborted', 'PDF export was cancelled.');
}

function invalidImage(): PdfExportError {
  return new PdfExportError(
    'watermark-image-invalid',
    'The watermark image could not be decoded safely. Choose a valid still PNG or JPEG.',
  );
}

function preparedSource(
  source: AnnotationImageExportSource,
  prepared: PreparedImage,
): AnnotationImageExportSource {
  const result = Object.freeze({ ...source, bytes: prepared.bytes.slice() });
  preparedImages.set(result, prepared);
  return result;
}

/**
 * Native browser decoding is the untrusted compressed-data boundary. PNG bytes
 * are re-encoded from bounded, decoded pixels: hostile DEFLATE/metadata never
 * reaches pdf-lib's synchronous UPNG decoder. A transparent canvas retains
 * alpha. JPEG bytes are retained only after actual native decoding succeeds.
 */
export async function prepareWatermarkImageSource(
  source: AnnotationImageExportSource,
  signal?: AbortSignal,
): Promise<AnnotationImageExportSource> {
  if (signal?.aborted) throw aborted();
  const existing = preparedImages.get(source);
  if (existing) return preparedSource(source, existing);
  // Capture before the first await, including an independent ownership copy.
  const bytes =
    source.bytes instanceof Uint8Array
      ? source.bytes.slice()
      : new Uint8Array(source.bytes.slice(0));
  const dimensions = assertWatermarkImageBytes(bytes, source.mimeType);
  const capturedSource = {
    assetId: source.assetId,
    mimeType: source.mimeType,
    bytes,
  };
  if (capturedSource.mimeType === 'image/png')
    await validateWatermarkPngDeflate(bytes, signal);
  if (signal?.aborted) throw aborted();
  if (
    typeof Image === 'undefined' ||
    typeof document === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  )
    throw invalidImage();

  const blob = new Blob([bytes], { type: capturedSource.mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  let canvas: HTMLCanvasElement | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectOperation: ((error: Error) => void) | undefined;
  const cancel = () => rejectOperation?.(aborted());
  try {
    const encoded = await new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      rejectOperation = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const finish = (result: Uint8Array) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      signal?.addEventListener('abort', cancel, { once: true });
      timeout = setTimeout(
        () => rejectOperation?.(invalidImage()),
        NATIVE_IMAGE_TIMEOUT_MS,
      );
      image.onerror = () => rejectOperation?.(invalidImage());
      image.onload = () => {
        if (settled || signal?.aborted) {
          if (signal?.aborted) cancel();
          return;
        }
        if (
          image.naturalWidth !== dimensions.width ||
          image.naturalHeight !== dimensions.height
        ) {
          rejectOperation?.(invalidImage());
          return;
        }
        if (capturedSource.mimeType === 'image/jpeg') {
          finish(bytes);
          return;
        }
        try {
          canvas = document.createElement('canvas');
          canvas.width = dimensions.width;
          canvas.height = dimensions.height;
          const context = canvas.getContext('2d');
          if (!context) throw invalidImage();
          context.drawImage(image, 0, 0);
          canvas.toBlob((encodedBlob) => {
            if (settled) return;
            if (
              !encodedBlob ||
              encodedBlob.type !== 'image/png' ||
              !encodedBlob.size ||
              encodedBlob.size > WATERMARK_MAX_IMAGE_BYTES
            ) {
              rejectOperation?.(invalidImage());
              return;
            }
            void encodedBlob.arrayBuffer().then(
              (buffer) => {
                if (settled) return;
                const canonical = new Uint8Array(buffer);
                try {
                  const output = assertWatermarkImageBytes(
                    canonical,
                    'image/png',
                  );
                  if (
                    output.width !== dimensions.width ||
                    output.height !== dimensions.height
                  )
                    throw invalidImage();
                  finish(canonical);
                } catch {
                  rejectOperation?.(invalidImage());
                }
              },
              () => rejectOperation?.(invalidImage()),
            );
          }, 'image/png');
        } catch {
          rejectOperation?.(invalidImage());
        }
      };
      image.src = objectUrl;
    });
    if (signal?.aborted) throw aborted();
    return preparedSource(capturedSource, { bytes: encoded, ...dimensions });
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    image.onload = null;
    image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(objectUrl);
    // Both native decoded pixels and the encoding surface are operation-scoped.
    if (canvas) {
      const releasedCanvas = canvas as HTMLCanvasElement;
      releasedCanvas.width = 0;
      releasedCanvas.height = 0;
    }
  }
}

/** Selection can register the canonical Blob and retain the normal registry. */
export async function prepareWatermarkImageFile(
  blob: Blob,
  signal?: AbortSignal,
): Promise<{
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}> {
  if (signal?.aborted) throw aborted();
  if (
    (blob.type !== 'image/png' && blob.type !== 'image/jpeg') ||
    !blob.size ||
    blob.size > WATERMARK_MAX_IMAGE_BYTES
  )
    throw invalidImage();
  const source = await prepareWatermarkImageSource(
    {
      assetId: 'watermark-selection',
      mimeType: blob.type,
      bytes: await blob.arrayBuffer(),
    },
    signal,
  );
  const dimensions = assertWatermarkImageBytes(source.bytes, source.mimeType);
  const bytes =
    source.bytes instanceof Uint8Array
      ? source.bytes.slice()
      : source.bytes.slice(0);
  return { blob: new Blob([bytes], { type: source.mimeType }), ...dimensions };
}
