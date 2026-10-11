import type { DocumentFontId } from './fontCatalog';
import { FontTextError } from './fontErrors';

export type FontAssetSnapshot = ReadonlyMap<DocumentFontId, Uint8Array>;

export const NOTO_SANS_ASSET = {
  url: new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url).href,
  bytes: 569208,
  sha256: 'b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5',
} as const;

let bundledBytes: Promise<Uint8Array> | null = null;
let browserFace: Promise<void> | null = null;
const FONT_LOAD_DEADLINE_MS = 15_000;

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function awaitWithAbort<T>(
  pending: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  checkAbort(signal);
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(
          error instanceof Error
            ? error
            : new FontTextError(
                'font-load-failed',
                'The bundled font could not be loaded.',
              ),
        );
      },
    );
  });
}

/** Only the checked-in, static, content-addressed font is accepted in Phase 5C. */
export async function validateBundledFontBytes(
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.byteLength !== NOTO_SANS_ASSET.bytes) {
    throw new FontTextError(
      'invalid-font',
      'The bundled font asset is incomplete or has changed. Reload Kagaz and try again.',
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x00010000) {
    throw new FontTextError(
      'invalid-font',
      'Only the bundled static TrueType font is supported.',
    );
  }
  const tables = view.getUint16(4);
  if (tables === 0 || tables > 64 || 12 + tables * 16 > bytes.length) {
    throw new FontTextError(
      'invalid-font',
      'The bundled font table directory is invalid.',
    );
  }
  let permissionsChecked = false;
  for (let index = 0; index < tables; index += 1) {
    const entry = 12 + index * 16;
    const tag = String.fromCharCode(...bytes.subarray(entry, entry + 4));
    const offset = view.getUint32(entry + 8);
    const length = view.getUint32(entry + 12);
    if (offset > bytes.length || length > bytes.length - offset) {
      throw new FontTextError(
        'invalid-font',
        'The bundled font contains a truncated table.',
      );
    }
    if (tag === 'fvar') {
      throw new FontTextError(
        'invalid-font',
        'Variable fonts are not supported by this export path.',
      );
    }
    if (tag === 'OS/2') {
      if (length < 10 || (view.getUint16(offset + 8) & 0x020e) !== 0) {
        throw new FontTextError(
          'invalid-font',
          'The font does not permit the required editable PDF embedding.',
        );
      }
      permissionsChecked = true;
    }
  }
  if (!permissionsChecked)
    throw new FontTextError(
      'invalid-font',
      'Font embedding permissions could not be checked.',
    );
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (hash !== NOTO_SANS_ASSET.sha256) {
    throw new FontTextError(
      'invalid-font',
      'The bundled font asset does not match this Kagaz version. Reload the page and try again.',
    );
  }
}

async function loadBundledBytes(): Promise<Uint8Array> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), FONT_LOAD_DEADLINE_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const response = await awaitWithAbort(
      fetch(NOTO_SANS_ASSET.url, {
        credentials: 'omit',
        cache: 'force-cache',
        signal: controller.signal,
      }),
      controller.signal,
    );
    if (!response.ok || !response.body)
      throw new FontTextError(
        'font-load-failed',
        'Noto Sans could not be loaded from Kagaz. Reload the page and try again.',
      );
    const declared = response.headers.get('Content-Length');
    if (
      declared !== null &&
      (!/^\d+$/.test(declared) || Number(declared) > NOTO_SANS_ASSET.bytes)
    ) {
      await response.body.cancel();
      throw new FontTextError(
        'invalid-font',
        'The bundled font response exceeds its size limit.',
      );
    }
    // Content-Length can be absent or describe compressed transport. The actual
    // decompressed stream has an independent fixed bound before allocation.
    const bytes = new Uint8Array(NOTO_SANS_ASSET.bytes);
    let offset = 0;
    reader = response.body.getReader();
    while (true) {
      const { done, value } = await awaitWithAbort(
        reader.read(),
        controller.signal,
      );
      if (done) break;
      if (value.byteLength > bytes.length - offset)
        throw new FontTextError(
          'invalid-font',
          'The bundled font response exceeds its size limit.',
        );
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== bytes.length)
      throw new FontTextError(
        'invalid-font',
        'The bundled font response is incomplete.',
      );
    await validateBundledFontBytes(bytes);
    return bytes;
  } catch (error: unknown) {
    if (error instanceof FontTextError) throw error;
    throw new FontTextError(
      'font-load-failed',
      'Noto Sans could not be loaded from Kagaz within 15 seconds. Reload the page and try again.',
    );
  } finally {
    clearTimeout(deadline);
    if (reader) {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    controller.abort();
  }
}

/** A single immutable bundle resource is cached; exports receive independent copies. */
export async function snapshotFontAssets(
  fontIds: Iterable<DocumentFontId>,
  signal?: AbortSignal,
): Promise<FontAssetSnapshot> {
  checkAbort(signal);
  const snapshot = new Map<DocumentFontId, Uint8Array>();
  if (new Set(fontIds).has('noto-sans')) {
    bundledBytes ??= loadBundledBytes().catch((error: unknown) => {
      bundledBytes = null;
      throw error;
    });
    const bytes = await awaitWithAbort(bundledBytes, signal);
    checkAbort(signal);
    snapshot.set('noto-sans', Uint8Array.from(bytes));
  }
  return snapshot;
}

/** FontFace is limited to one bundled face, with no object URL or persistent data. */
export async function ensureBrowserDocumentFont(
  fontId: DocumentFontId,
  signal?: AbortSignal,
): Promise<void> {
  checkAbort(signal);
  if (fontId === 'helvetica') return;
  browserFace ??= (async () => {
    if (typeof FontFace !== 'function' || !document.fonts)
      throw new FontTextError(
        'font-load-failed',
        'This browser cannot load the bundled document font.',
      );
    const assets = await snapshotFontAssets(['noto-sans']);
    const bytes = assets.get('noto-sans');
    if (!bytes)
      throw new FontTextError(
        'font-load-failed',
        'The bundled document font is unavailable.',
      );
    const face = new FontFace('Kagaz Noto Sans', Uint8Array.from(bytes).buffer);
    await face.load();
    document.fonts.add(face);
  })().catch((error: unknown) => {
    browserFace = null;
    throw error;
  });
  await awaitWithAbort(browserFace, signal);
  checkAbort(signal);
}
