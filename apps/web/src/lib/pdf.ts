import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

export interface LoadedPdf {
  document: PDFDocumentProxy;
  loadingTask: PDFDocumentLoadingTask;
}

export async function loadPdf(
  file: File,
  signal: AbortSignal,
): Promise<LoadedPdf> {
  const data = new Uint8Array(await file.arrayBuffer());

  if (signal.aborted) {
    throw new DOMException('PDF loading was cancelled.', 'AbortError');
  }

  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');

  if (signal.aborted) {
    throw new DOMException('PDF loading was cancelled.', 'AbortError');
  }

  GlobalWorkerOptions.workerSrc = workerUrl;
  // XFA detection is intentionally enabled at the PDF.js boundary. Form
  // discovery can then classify pure XFA before showing AcroForm controls;
  // the form feature still never calls pdf-lib for detection.
  const loadingTask = getDocument({ data, enableXfa: true });
  const cancelLoading = () => {
    void loadingTask.destroy();
  };
  signal.addEventListener('abort', cancelLoading, { once: true });

  try {
    const document = await loadingTask.promise;
    // PDF.js hides signature field values and omits malformed signed ranges.
    // Inspect parsed objects before admitting any source to the editable
    // workspace. pdf-lib remains dynamically loaded, never in the main bundle.
    const { inspectSourceSignatureSafety } =
      await import('./pdf-signatures/signatureSafety');
    await inspectSourceSignatureSafety(await document.getData());
    if (signal.aborted)
      throw new DOMException('PDF loading was cancelled.', 'AbortError');
    return { document, loadingTask };
  } catch (error) {
    await loadingTask.destroy();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelLoading);
  }
}

export function isPdfFile(file: File): boolean {
  if (file.type === 'application/pdf') {
    return true;
  }

  return file.type === '' && file.name.toLowerCase().endsWith('.pdf');
}

export function describePdfError(error: unknown): string {
  if (error instanceof Error) {
    if (
      error.name === 'SignedPdfError' ||
      error.name === 'UnsafeSignatureFieldError'
    )
      return error.message;
    if (error.name === 'PasswordException') {
      return 'This PDF is password protected. Password entry is not available yet.';
    }

    if (
      error.name === 'InvalidPDFException' ||
      error.name === 'FormatError' ||
      /invalid pdf/i.test(error.message)
    ) {
      return 'This file is not a valid PDF or appears to be corrupted.';
    }
  }

  return 'Kagaz could not open this PDF. The file may be damaged or unsupported.';
}
