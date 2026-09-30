import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CompressionMetadata,
  CompressionPreset,
} from '@kagaz/shared-types';
import { downloadPdf } from '../../lib/pdf-export/downloadPdf';
import type { PdfExportController } from '../pdf-workspace/hooks/usePdfExport';
import { friendlyExportError } from '../pdf-workspace/hooks/usePdfExport';
import { CompressionError, uploadCompression } from './compressionClient';

export type CompressionState =
  | { readonly status: 'idle' | 'preparing' | 'processing' | 'cancelled' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'success'; readonly metadata: CompressionMetadata };

export function usePdfCompression(
  prepareWorkspace: PdfExportController['prepareWorkspace'],
) {
  const [state, setState] = useState<CompressionState>({ status: 'idle' });
  const active = useRef<AbortController | null>(null);
  const result = useRef<{ bytes: Uint8Array; fileName: string } | null>(null);
  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
    result.current = null;
    setState({ status: 'cancelled' });
  }, []);
  const start = async (preset: CompressionPreset) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    result.current = null;
    setState({ status: 'preparing' });
    try {
      const generated = await prepareWorkspace(controller.signal);
      if (controller.signal.aborted) return;
      const compressed = await uploadCompression(
        generated.bytes,
        preset,
        controller.signal,
        () => setState({ status: 'processing' }),
      );
      if (controller.signal.aborted) return;
      result.current = {
        bytes: compressed.bytes,
        fileName: generated.fileName.replace(/\.pdf$/i, '-compressed.pdf'),
      };
      setState({ status: 'success', metadata: compressed.metadata });
    } catch (error) {
      if (!controller.signal.aborted)
        setState({
          status: 'error',
          message:
            error instanceof CompressionError
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
