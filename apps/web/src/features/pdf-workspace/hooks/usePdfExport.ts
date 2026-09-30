import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getExtractExportFileName,
  getWorkspaceExportFileName,
} from '../../../lib/pdf-export/fileNames';
import { downloadPdf } from '../../../lib/pdf-export/downloadPdf';
import { exportWorkspace } from '../../../lib/pdf-export/exportWorkspace';
import { AnnotationExportError } from '../../../lib/pdf-export/annotations/exportContracts';
import { snapshotAnnotationImageAssets } from '../../../lib/pdf-export/annotations/imageAssets';
import {
  PdfExportError,
  type ExportProgress,
  type ExportSource,
} from '../../../lib/pdf-export/types';
import {
  FormExportError,
  type FormExportSnapshot,
} from '../../../lib/pdf-export/forms/types';
import { snapshotWorkspacePages } from '../../../lib/pdf-export/exportWorkspace';
import type {
  AnnotationHistoryState,
  PdfAnnotation,
} from '../../pdf-annotations/model/types';
import type { AnnotationAssetRegistry } from '../../pdf-annotations/runtime/annotationAssetRegistry';
import type { SourceDocumentRegistry } from '../runtime/sourceDocumentRegistry';
import type {
  PdfWorkspaceState,
  SourceDocumentId,
  WorkspacePage,
} from '../model/types';

type ExportBlockReason = (pages: readonly WorkspacePage[]) => string | null;

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
  readonly prepareWorkspace: (
    signal: AbortSignal,
    onProgress?: (progress: ExportProgress) => void,
  ) => Promise<{ bytes: Uint8Array; fileName: string }>;
}

const IDLE_EXPORT_STATE: PdfExportState = {
  status: 'idle',
  progress: null,
  error: null,
};

export function friendlyExportError(error: unknown): string {
  if (error instanceof AnnotationExportError) {
    switch (error.code) {
      case 'unsupported-text-font':
        return 'This text contains characters unsupported by the PDF export font.';
      case 'missing-image-asset':
        return 'An image annotation is no longer available for export.';
      case 'missing-signature-asset':
        return 'A visual signature is no longer available for export.';
      case 'image-read-failed':
        return 'Kagaz could not read an image annotation for export.';
      case 'unsupported-image-format':
        return 'This image annotation format is not supported for PDF export.';
      case 'image-embed-failed':
        return 'Kagaz could not embed an image annotation in the PDF.';
    }
  }
  if (error instanceof FormExportError && error.fileName) {
    return `${error.fileName}: ${error.message}`;
  }
  if (error instanceof FormExportError) return error.message;
  if (error instanceof PdfExportError && error.fileName) {
    return `${error.fileName}: ${error.message}`;
  }
  if (error instanceof PdfExportError) {
    return error.message;
  }
  return 'Kagaz could not create the PDF. Your workspace is still intact.';
}

export interface AnnotationExportSnapshot {
  readonly annotationsByPage: ReadonlyMap<string, readonly PdfAnnotation[]>;
  readonly imageAssetIds: readonly string[];
}

/** Copies only committed annotations attached to the selected page snapshot. */
export function snapshotAnnotationsForPages(
  pages: readonly WorkspacePage[],
  state: AnnotationHistoryState,
): AnnotationExportSnapshot {
  const annotationsByPage = new Map<string, readonly PdfAnnotation[]>();
  const imageAssetIds = new Set<string>();

  for (const page of pages) {
    const annotations = state.present.byPage[page.id] ?? [];
    const pageSnapshot = Object.freeze([...annotations]);
    annotationsByPage.set(page.id, pageSnapshot);
    for (const annotation of pageSnapshot) {
      if (annotation.kind === 'image' || annotation.kind === 'signature') {
        imageAssetIds.add(annotation.assetId);
      }
    }
  }

  return {
    annotationsByPage,
    imageAssetIds: [...imageAssetIds],
  };
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
  annotationState: AnnotationHistoryState,
  annotationAssets: Pick<AnnotationAssetRegistry, 'get'>,
  getExportBlockReason: ExportBlockReason,
  snapshotForms: (pages: readonly WorkspacePage[]) => FormExportSnapshot,
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

  const preparePages = useCallback(
    (
      pages: readonly WorkspacePage[],
      signal: AbortSignal,
      onProgress?: (progress: ExportProgress) => void,
    ) => {
      const block = getExportBlockReason(pages);
      if (block) throw new PdfExportError('export-blocked', block);
      const pageSnapshot = snapshotWorkspacePages(pages);
      const sources = sourceMapForPages(pageSnapshot, registry);
      const forms = snapshotForms(pageSnapshot);
      const annotations = snapshotAnnotationsForPages(
        pageSnapshot,
        annotationState,
      );
      // Captures asset Blobs synchronously before the first asynchronous read.
      const imageAssets = snapshotAnnotationImageAssets(
        annotationAssets,
        annotations.imageAssetIds,
      );
      return {
        fileName: getWorkspaceExportFileName(
          sourceNamesInPageOrder(pageSnapshot, sources),
        ),
        bytes: imageAssets.then((assets) =>
          exportWorkspace(
            {
              pages: pageSnapshot,
              sources,
              forms,
              annotationsByPage: annotations.annotationsByPage,
              imageAssets: assets,
            },
            { signal, onProgress },
          ),
        ),
      };
    },
    [
      getExportBlockReason,
      registry,
      snapshotForms,
      annotationState,
      annotationAssets,
    ],
  );

  const prepareWorkspace = useCallback(
    async (
      signal: AbortSignal,
      onProgress?: (progress: ExportProgress) => void,
    ) => {
      const prepared = preparePages(workspace.pages, signal, onProgress);
      return { bytes: await prepared.bytes, fileName: prepared.fileName };
    },
    [preparePages, workspace.pages],
  );

  const run = useCallback(
    (pages: readonly WorkspacePage[], fileName: string) => {
      if (state.status === 'exporting' || pages.length === 0) {
        return;
      }

      const exportBlockReason = getExportBlockReason(pages);
      if (exportBlockReason) {
        setState({
          status: 'error',
          progress: null,
          error: exportBlockReason,
        });
        return;
      }

      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const controller = new AbortController();
      abortRef.current = controller;
      let prepared: ReturnType<typeof preparePages>;
      const isCurrent = () =>
        generationRef.current === generation && !controller.signal.aborted;

      try {
        prepared = preparePages(pages, controller.signal, (progress) => {
          if (isCurrent())
            setState({ status: 'exporting', progress, error: null });
        });
      } catch (error: unknown) {
        setState({
          status: 'error',
          progress: null,
          error: friendlyExportError(error),
        });
        return;
      }

      setState({
        status: 'exporting',
        progress: { phase: 'preparing', current: 0, total: 1 },
        error: null,
      });

      void prepared.bytes
        .then((bytes) => {
          if (!bytes || !isCurrent()) return;
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
    [getExportBlockReason, preparePages, state.status],
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

  return { state, downloadWorkspace, extractPages, cancel, prepareWorkspace };
}
