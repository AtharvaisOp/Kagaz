import { normalizeRotation } from '../../features/pdf-workspace/model/operations';
import type { WorkspacePage } from '../../features/pdf-workspace/model/types';
import {
  PdfExportError,
  type ExportProgress,
  type ExportWorkspaceRequest,
} from './types';
import type { PDFDocument } from 'pdf-lib';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PdfExportError('aborted', 'PDF export was cancelled.');
  }
}

/**
 * Builds a new PDF from a logical workspace snapshot. PDF.js runtimes are
 * intentionally not accepted here: this boundary owns only export-scoped
 * pdf-lib documents and original browser Files.
 */
export async function exportWorkspace(
  request: ExportWorkspaceRequest,
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: ExportProgress) => void;
  } = {},
): Promise<Uint8Array> {
  const pages = request.pages.map((page) => ({ ...page }));
  const uniqueSourceIds = [
    ...new Set(pages.map((page) => page.sourceDocumentId)),
  ];
  const sourceDocuments = new Map<string, PDFDocument>();

  throwIfAborted(options.signal);
  options.onProgress?.({
    phase: 'preparing',
    current: 0,
    total: uniqueSourceIds.length,
  });

  const { PDFDocument, degrees } = await import('pdf-lib');

  try {
    for (const [index, sourceId] of uniqueSourceIds.entries()) {
      throwIfAborted(options.signal);
      const source = request.sources.get(sourceId);
      if (!source) {
        throw new PdfExportError(
          'missing-source',
          'A source PDF required by this workspace is no longer available.',
        );
      }

      options.onProgress?.({
        phase: 'loading',
        current: index + 1,
        total: uniqueSourceIds.length,
        fileName: source.fileName,
      });

      let bytes: ArrayBuffer;
      try {
        bytes = await source.file.arrayBuffer();
      } catch {
        throw new PdfExportError(
          'source-read-failed',
          'Kagaz could not read this source PDF for export.',
          source.fileName,
        );
      }

      throwIfAborted(options.signal);

      try {
        sourceDocuments.set(sourceId, await PDFDocument.load(bytes));
      } catch {
        throw new PdfExportError(
          'source-pdf-invalid',
          'This source PDF could not be opened for export.',
          source.fileName,
        );
      }
    }

    const output = await PDFDocument.create();
    for (const [index, workspacePage] of pages.entries()) {
      throwIfAborted(options.signal);
      const sourceDocument = sourceDocuments.get(
        workspacePage.sourceDocumentId,
      );
      if (!sourceDocument) {
        throw new PdfExportError(
          'missing-source',
          'A source PDF required by this workspace is no longer available.',
        );
      }

      options.onProgress?.({
        phase: 'building',
        current: index + 1,
        total: pages.length,
      });

      try {
        const [copiedPage] = await output.copyPages(sourceDocument, [
          workspacePage.sourcePageIndex,
        ]);
        if (!copiedPage) {
          throw new Error('The requested source page was not returned.');
        }

        const intrinsicRotation = copiedPage.getRotation().angle;
        const totalRotation = normalizeRotation(
          intrinsicRotation + workspacePage.rotationDelta,
        );
        copiedPage.setRotation(degrees(totalRotation));
        output.addPage(copiedPage);
      } catch (error: unknown) {
        if (error instanceof PdfExportError) {
          throw error;
        }
        throw new PdfExportError(
          'page-copy-failed',
          'Kagaz could not copy one of the workspace pages into the export.',
        );
      }
    }

    throwIfAborted(options.signal);
    options.onProgress?.({
      phase: 'saving',
      current: 1,
      total: 1,
    });

    try {
      return await output.save();
    } catch {
      throw new PdfExportError(
        'save-failed',
        'Kagaz could not finish writing the exported PDF.',
      );
    }
  } finally {
    // pdf-lib documents are export-scoped and have no worker lifecycle to
    // destroy; dropping this cache at the end releases the references.
    sourceDocuments.clear();
  }
}

export function snapshotWorkspacePages(
  pages: readonly WorkspacePage[],
): readonly WorkspacePage[] {
  return pages.map((page) => ({ ...page }));
}
