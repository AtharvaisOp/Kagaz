import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadPdf } from '../../lib/pdf-export/downloadPdf';
import type { PdfExportController } from '../pdf-workspace/hooks/usePdfExport';
import { friendlyExportError } from '../pdf-workspace/hooks/usePdfExport';
import { HeavyPdfError } from './uploadHeavyPdf';

export type DerivativeState<M> =
  | { readonly status: 'idle' | 'preparing' | 'processing' | 'cancelled' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'success'; readonly metadata: M };

export function usePdfDerivative<Selection, M>(
  prepareWorkspace: PdfExportController['prepareWorkspace'],
  upload: (
    bytes: Uint8Array,
    selection: Selection,
    signal: AbortSignal,
    onProcessing: () => void,
  ) => Promise<{ bytes: Uint8Array; metadata: M }>,
  suffix: string,
) {
  const [state, setState] = useState<DerivativeState<M>>({ status: 'idle' });
  const active = useRef<AbortController | null>(null);
  const result = useRef<{ bytes: Uint8Array; fileName: string } | null>(null);
  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
    result.current = null;
    setState({ status: 'cancelled' });
  }, []);
  const start = async (selection: Selection) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    result.current = null;
    setState({ status: 'preparing' });
    try {
      const generated = await prepareWorkspace(controller.signal);
      if (controller.signal.aborted) return;
      const compressed = await upload(
        generated.bytes,
        selection,
        controller.signal,
        () => {
          if (!controller.signal.aborted) setState({ status: 'processing' });
        },
      );
      if (controller.signal.aborted) return;
      result.current = {
        bytes: compressed.bytes,
        fileName: generated.fileName.replace(/\.pdf$/i, `-${suffix}.pdf`),
      };
      setState({ status: 'success', metadata: compressed.metadata });
    } catch (error) {
      if (!controller.signal.aborted)
        setState({
          status: 'error',
          message:
            error instanceof HeavyPdfError
              ? error.message
              : friendlyExportError(error),
        });
    } finally {
      if (active.current === controller) active.current = null;
    }
  };
  const download = () => {
    if (result.current)
      downloadPdf(result.current.bytes, result.current.fileName);
  };
  useEffect(
    () => () => {
      active.current?.abort();
      result.current = null;
    },
    [],
  );
  return { state, start, cancel, download };
}
