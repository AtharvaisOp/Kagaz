import type { AnnotationAssetId } from '../model/types';

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
    async register(blob: Blob): Promise<AnnotationImageAsset> {
      if (!supportedMimeTypes.has(blob.type)) {
        throw new Error('Choose a PNG or JPEG image.');
      }
      const mimeType = blob.type as AnnotationImageAsset['mimeType'];
      const assetId = dependencies.createId();
      const objectUrl = dependencies.createObjectUrl(blob);
      try {
        const decoded = await dependencies.decode(blob, objectUrl);
        if (
          !Number.isFinite(decoded.width) ||
          decoded.width <= 0 ||
          !Number.isFinite(decoded.height) ||
          decoded.height <= 0
        ) {
          throw new Error('The selected image has invalid dimensions.');
        }
        const asset: AnnotationImageAsset = {
          assetId,
          blob,
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
        notify(assetId);
        return asset;
      } catch (error) {
        dependencies.revokeObjectUrl(objectUrl);
        throw error instanceof Error
          ? error
          : new Error('The selected image could not be decoded.');
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
  return createAnnotationAssetRegistry({
    createId,
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    decode: browserDecodeImage,
  });
}
