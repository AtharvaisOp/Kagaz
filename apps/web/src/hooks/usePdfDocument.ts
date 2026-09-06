import { useEffect, useState } from 'react';

import { describePdfError, loadPdf } from '../lib/pdf';

import type { PDFDocumentProxy } from 'pdfjs-dist';

export type PdfDocumentState =
  | { status: 'idle' }
  | { status: 'loading'; fileName: string }
  | { status: 'ready'; document: PDFDocumentProxy; fileName: string }
  | { status: 'error'; message: string; fileName: string };

type SettledPdfDocumentState =
  | {
      file: File;
      value: Extract<PdfDocumentState, { status: 'ready' }>;
    }
  | {
      file: File;
      value: Extract<PdfDocumentState, { status: 'error' }>;
    };

export function usePdfDocument(file: File | null): PdfDocumentState {
  const [settledState, setSettledState] =
    useState<SettledPdfDocumentState | null>(null);

  useEffect(() => {
    if (!file) {
      return;
    }

    let active = true;
    const abortController = new AbortController();
    let loadingTask: Awaited<ReturnType<typeof loadPdf>>['loadingTask'] | null =
      null;

    void loadPdf(file, abortController.signal)
      .then((loaded) => {
        loadingTask = loaded.loadingTask;
        if (!active) {
          return loaded.loadingTask.destroy();
        }

        setSettledState({
          file,
          value: {
            status: 'ready',
            document: loaded.document,
            fileName: file.name,
          },
        });
      })
      .catch((error: unknown) => {
        if (
          active &&
          !(error instanceof DOMException && error.name === 'AbortError')
        ) {
          setSettledState({
            file,
            value: {
              status: 'error',
              message: describePdfError(error),
              fileName: file.name,
            },
          });
        }
      });

    return () => {
      active = false;
      abortController.abort();
      if (loadingTask) {
        void loadingTask.destroy();
      }
    };
  }, [file]);

  if (!file) {
    return { status: 'idle' };
  }

  if (!settledState || settledState.file !== file) {
    return { status: 'loading', fileName: file.name };
  }

  return settledState.value;
}
