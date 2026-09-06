import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getExtractExportFileName,
  getWorkspaceExportFileName,
} from '../../../lib/pdf-export/fileNames';
import { downloadPdf } from '../../../lib/pdf-export/downloadPdf';
import { exportWorkspace } from '../../../lib/pdf-export/exportWorkspace';
import {
  PdfExportError,
  type ExportProgress,
  type ExportSource,
} from '../../../lib/pdf-export/types';
import { snapshotWorkspacePages } from '../../../lib/pdf-export/exportWorkspace';
import type { SourceDocumentRegistry } from '../runtime/sourceDocumentRegistry';
import type {
  PdfWorkspaceState,
  SourceDocumentId,
  WorkspacePage,
} from '../model/types';

export interface PdfExportState {
  readonly status: 'idle' | 'exporting' | 'error';
  readonly progress: ExportProgress | null;
  readonly error: string | null;
}

export interface PdfExportController {
  readonly state: PdfExportState;
  readonly downloadWorkspace: () => void;
  readonly extractPages: (pages: readonly WorkspacePage[]) => void;
  readonly cancel: () => void;
}

const IDLE_EXPORT_STATE: PdfExportState = {
  status: 'idle',
  progress: null,
  error: null,
};

function friendlyExportError(error: unknown): string {
  if (error instanceof PdfExportError && error.fileName) {
    return `${error.fileName}: ${error.message}`;
  }
  if (error instanceof PdfExportError) {
    return error.message;
  }
  return 'Kagaz could not create the PDF. Your workspace is still intact.';
}

function sourceMapForPages(
  pages: readonly WorkspacePage[],
  registry: SourceDocumentRegistry,
): Map<SourceDocumentId, ExportSource> {
  const sources = new Map<SourceDocumentId, ExportSource>();
  for (const page of pages) {
    if (sources.has(page.sourceDocumentId)) {
      continue;
    }
    const runtime = registry.get(page.sourceDocumentId);
    if (!runtime) {
      throw new PdfExportError(
        'missing-source',
        'A source PDF required by this workspace is no longer available.',
      );
    }
    sources.set(page.sourceDocumentId, {
      id: page.sourceDocumentId,
      file: runtime.file,
      fileName: runtime.file.name,
    });
  }
  return sources;
}

function sourceNamesInPageOrder(
  pages: readonly WorkspacePage[],
  sources: ReadonlyMap<SourceDocumentId, ExportSource>,
): string[] {
  const names: string[] = [];
  const seen = new Set<SourceDocumentId>();
  for (const page of pages) {
    if (seen.has(page.sourceDocumentId)) continue;
    seen.add(page.sourceDocumentId);
    const source = sources.get(page.sourceDocumentId);
    if (source) names.push(source.fileName);
  }
  return names;
}

export function usePdfExport(
  workspace: PdfWorkspaceState,
  registry: SourceDocumentRegistry,
): PdfExportController {
  const [state, setState] = useState<PdfExportState>(IDLE_EXPORT_STATE);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE_EXPORT_STATE);
  }, []);

  const run = useCallback(
    (pages: readonly WorkspacePage[], fileName: string) => {
      if (state.status === 'exporting' || pages.length === 0) {
        return;
      }

      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const controller = new AbortController();
      abortRef.current = controller;
      const pageSnapshot = snapshotWorkspacePages(pages);
      let sources: Map<SourceDocumentId, ExportSource>;

      try {
        sources = sourceMapForPages(pageSnapshot, registry);
      } catch (error: unknown) {
        setState({
          status: 'error',
          progress: null,
          error: friendlyExportError(error),
        });
        return;
      }

      const isCurrent = () =>
        generationRef.current === generation && !controller.signal.aborted;
      setState({
        status: 'exporting',
        progress: { phase: 'preparing', current: 0, total: sources.size },
        error: null,
      });

      void exportWorkspace(
        { pages: pageSnapshot, sources },
        {
          signal: controller.signal,
          onProgress: (progress) => {
            if (isCurrent())
              setState({ status: 'exporting', progress, error: null });
          },
        },
      )
        .then((bytes) => {
          if (!isCurrent()) return;
          downloadPdf(bytes, fileName);
          abortRef.current = null;
          setState(IDLE_EXPORT_STATE);
        })
        .catch((error: unknown) => {
          if (!isCurrent()) return;
          abortRef.current = null;
          if (error instanceof PdfExportError && error.code === 'aborted') {
            setState(IDLE_EXPORT_STATE);
            return;
          }
          setState({
            status: 'error',
            progress: null,
            error: friendlyExportError(error),
          });
        });
    },
    [registry, state.status],
  );

  const downloadWorkspace = useCallback(() => {
    const pages = snapshotWorkspacePages(workspace.pages);
    let sources: Map<SourceDocumentId, ExportSource>;
    try {
      sources = sourceMapForPages(pages, registry);
    } catch (error: unknown) {
      setState({
        status: 'error',
        progress: null,
        error: friendlyExportError(error),
      });
      return;
    }
    run(
      pages,
      getWorkspaceExportFileName(sourceNamesInPageOrder(pages, sources)),
    );
  }, [registry, run, workspace.pages]);

  const extractPages = useCallback(
    (pages: readonly WorkspacePage[]) => {
      let sources: Map<SourceDocumentId, ExportSource>;
      try {
        sources = sourceMapForPages(pages, registry);
      } catch (error: unknown) {
        setState({
          status: 'error',
          progress: null,
          error: friendlyExportError(error),
        });
        return;
      }
      run(
        pages,
        getExtractExportFileName(sourceNamesInPageOrder(pages, sources)),
      );
    },
    [registry, run],
  );

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  return { state, downloadWorkspace, extractPages, cancel };
}
