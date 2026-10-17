import type { AnnotationAssetId } from '../model/types';
import { rejectUnsupportedJpegOrientation } from './jpegExifOrientation';
import { WATERMARK_MAX_IMAGE_BYTES } from '../../../lib/pdf-export/watermarks/imageSafety';

export interface AnnotationImageAsset {
  readonly assetId: AnnotationAssetId;
  readonly blob: Blob;
  readonly fileName: string | null;
  readonly mimeType: 'image/png' | 'image/jpeg';
  readonly objectUrl: string;
  readonly width: number;
  readonly height: number;
  readonly image: CanvasImageSource;
}

interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly image: CanvasImageSource;
}

export interface AnnotationAssetRegistryDependencies {
  readonly createId: () => AnnotationAssetId;
  readonly createObjectUrl: (blob: Blob) => string;
  readonly revokeObjectUrl: (url: string) => void;
  readonly decode: (blob: Blob, objectUrl: string) => Promise<DecodedImage>;
  /** Applies bounded decoding/canonicalization before untrusted bytes reach Image(). */
  readonly prepare?: (blob: Blob, signal?: AbortSignal) => Promise<Blob>;
}

const supportedMimeTypes = new Set(['image/png', 'image/jpeg']);

function browserDecodeImage(
  _blob: Blob,
  objectUrl: string,
): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () =>
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
        image,
      });
    image.onerror = () =>
      reject(new Error('The selected image could not be decoded.'));
    image.src = objectUrl;
  });
}

export function createAnnotationAssetRegistry(
  dependencies: AnnotationAssetRegistryDependencies,
) {
  const assets = new Map<AnnotationAssetId, AnnotationImageAsset>();
  const listeners = new Map<AnnotationAssetId, Set<() => void>>();
  const pendingUrls = new Set<string>();
  const activePreparations = new Set<AbortController>();
  let generation = 0;
  const revokePending = (url: string) => {
    if (pendingUrls.delete(url)) dependencies.revokeObjectUrl(url);
  };

  const notify = (assetId: AnnotationAssetId) => {
    for (const listener of listeners.get(assetId) ?? []) listener();
  };

  const destroy = (assetId: AnnotationAssetId): boolean => {
    const asset = assets.get(assetId);
    if (!asset) return false;
    assets.delete(assetId);
    dependencies.revokeObjectUrl(asset.objectUrl);
    const close = (asset.image as { close?: () => void }).close;
    close?.call(asset.image);
    notify(assetId);
    listeners.delete(assetId);
    return true;
  };

  return {
    async register(
      blob: Blob,
      signal?: AbortSignal,
    ): Promise<AnnotationImageAsset> {
      const requestGeneration = generation;
      const cancelled = () =>
        signal?.aborted || requestGeneration !== generation;
      if (cancelled())
        throw new DOMException('Image loading was cancelled.', 'AbortError');
      if (!supportedMimeTypes.has(blob.type)) {
        throw new Error('Choose a PNG or JPEG image.');
      }
      if (!blob.size || blob.size > WATERMARK_MAX_IMAGE_BYTES) {
        throw new Error('The selected image is empty or too large.');
      }
      const mimeType = blob.type as AnnotationImageAsset['mimeType'];
      if (mimeType === 'image/jpeg') {
        await rejectUnsupportedJpegOrientation(blob);
      }
      if (cancelled())
        throw new DOMException('Image loading was cancelled.', 'AbortError');
      let preparedBlob = blob;
      if (dependencies.prepare) {
        const preparation = new AbortController();
        const abortPreparation = () => preparation.abort();
        activePreparations.add(preparation);
        signal?.addEventListener('abort', abortPreparation, { once: true });
        try {
          preparedBlob = await dependencies.prepare(blob, preparation.signal);
        } catch (error) {
          if (cancelled() || preparation.signal.aborted)
            throw new DOMException(
              'Image loading was cancelled.',
              'AbortError',
            );
          throw error;
        } finally {
          activePreparations.delete(preparation);
          signal?.removeEventListener('abort', abortPreparation);
        }
      }
      if (cancelled())
        throw new DOMException('Image loading was cancelled.', 'AbortError');
      const assetId = dependencies.createId();
      const objectUrl = dependencies.createObjectUrl(preparedBlob);
      pendingUrls.add(objectUrl);
      const abort = () => revokePending(objectUrl);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const decoded = await dependencies.decode(preparedBlob, objectUrl);
        if (cancelled()) {
          const close = (decoded.image as { close?: () => void }).close;
          close?.call(decoded.image);
          throw new DOMException('Image loading was cancelled.', 'AbortError');
        }
        if (
          !Number.isFinite(decoded.width) ||
          decoded.width <= 0 ||
          !Number.isFinite(decoded.height) ||
          decoded.height <= 0
        ) {
          const close = (decoded.image as { close?: () => void }).close;
          close?.call(decoded.image);
          throw new Error('The selected image has invalid dimensions.');
        }
        const asset: AnnotationImageAsset = {
          assetId,
          blob: preparedBlob,
          fileName:
            typeof File !== 'undefined' && blob instanceof File
              ? blob.name
              : null,
          mimeType,
          objectUrl,
          width: decoded.width,
          height: decoded.height,
          image: decoded.image,
        };
        assets.set(assetId, asset);
        pendingUrls.delete(objectUrl);
        notify(assetId);
        return asset;
      } catch (error) {
        revokePending(objectUrl);
        if (cancelled())
          throw new DOMException('Image loading was cancelled.', 'AbortError');
        throw error instanceof Error
          ? error
          : new Error('The selected image could not be decoded.');
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    },
    get(assetId: AnnotationAssetId): AnnotationImageAsset | null {
      return assets.get(assetId) ?? null;
    },
    subscribe(assetId: AnnotationAssetId, listener: () => void) {
      const current = listeners.get(assetId) ?? new Set();
      current.add(listener);
      listeners.set(assetId, current);
      return () => {
        current.delete(listener);
        if (current.size === 0) listeners.delete(assetId);
      };
    },
    reconcile(reachableAssetIds: ReadonlySet<AnnotationAssetId>): void {
      for (const assetId of [...assets.keys()]) {
        if (!reachableAssetIds.has(assetId)) destroy(assetId);
      }
    },
    destroy,
    destroyAll(): void {
      generation += 1;
      for (const preparation of activePreparations) preparation.abort();
      for (const url of pendingUrls) revokePending(url);
      for (const assetId of [...assets.keys()]) destroy(assetId);
    },
    get size() {
      return assets.size;
    },
  };
}

export type AnnotationAssetRegistry = ReturnType<
  typeof createAnnotationAssetRegistry
>;

export function createBrowserAnnotationAssetRegistry(
  createId: () => AnnotationAssetId,
): AnnotationAssetRegistry {
  const prepare = async (blob: Blob, signal?: AbortSignal) => {
    const { prepareWatermarkImageFile } =
      await import('../../../lib/pdf-export/watermarks/nativeImage');
    try {
      return (await prepareWatermarkImageFile(blob, signal)).blob;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError')
        throw error;
      throw new Error(
        'The selected image could not be opened safely. Choose a valid PNG or JPEG.',
        { cause: error },
      );
    }
  };
  return createAnnotationAssetRegistry({
    createId,
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    decode: browserDecodeImage,
    prepare,
  });
}
