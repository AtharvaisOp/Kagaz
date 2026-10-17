import { useEffect, useState } from 'react';
import type { DocumentFontId } from './fontCatalog';

interface TextSupportState {
  readonly key: string;
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: string | null;
}

/** Validates drafts locally without keeping their content in any global cache. */
export function useDocumentTextSupport(
  fontId: DocumentFontId,
  text: string,
  enabled = true,
) {
  const key = `${fontId}\0${text}`;
  const [state, setState] = useState<TextSupportState | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void Promise.all([import('./pdfFont'), import('./fontAssets')])
        .then(async ([engine, assets]) => {
          await assets.ensureBrowserDocumentFont(fontId, controller.signal);
          if (controller.signal.aborted) return;
          await engine.validateDocumentText(fontId, text);
          if (!controller.signal.aborted)
            setState({ key, status: 'ready', error: null });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setState({
              key,
              status: 'error',
              error:
                error instanceof Error
                  ? error.message
                  : 'This font could not be loaded. Choose another font.',
            });
        });
    }, 90);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, fontId, key, text]);
  return state?.key === key
    ? state
    : { key, status: 'loading' as const, error: null };
}
