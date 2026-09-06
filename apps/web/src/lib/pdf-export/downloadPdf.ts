export interface DownloadAdapter {
  readonly createBlob: (parts: BlobPart[], options: BlobPropertyBag) => Blob;
  readonly createObjectUrl: (blob: Blob) => string;
  readonly revokeObjectUrl: (url: string) => void;
  readonly createAnchor: () => HTMLAnchorElement;
  readonly appendAnchor: (anchor: HTMLAnchorElement) => void;
  readonly removeAnchor: (anchor: HTMLAnchorElement) => void;
  readonly clickAnchor: (anchor: HTMLAnchorElement) => void;
  readonly schedule: (callback: () => void) => void;
}

function defaultDownloadAdapter(): DownloadAdapter {
  return {
    createBlob: (parts, options) => new Blob(parts, options),
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement('a'),
    appendAnchor: (anchor) => document.body.append(anchor),
    removeAnchor: (anchor) => anchor.remove(),
    clickAnchor: (anchor) => anchor.click(),
    schedule: (callback) => window.setTimeout(callback, 1000),
  };
}

export function downloadPdf(
  bytes: Uint8Array,
  fileName: string,
  adapter: DownloadAdapter = defaultDownloadAdapter(),
): void {
  const copy = bytes.slice();
  const blob = adapter.createBlob([copy], { type: 'application/pdf' });
  const objectUrl = adapter.createObjectUrl(blob);
  const anchor = adapter.createAnchor();
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';

  try {
    adapter.appendAnchor(anchor);
    adapter.clickAnchor(anchor);
  } finally {
    adapter.removeAnchor(anchor);
    adapter.schedule(() => adapter.revokeObjectUrl(objectUrl));
  }
}
