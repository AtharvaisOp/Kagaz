import { normalizeRotation } from '../../features/pdf-workspace/model/operations';
import type { WorkspacePage } from '../../features/pdf-workspace/model/types';
import {
  PdfExportError,
  type ExportProgress,
  type ExportWorkspaceRequest,
} from './types';
import { AnnotationExportError } from './annotations/exportContracts';
import type { PDFDocument } from 'pdf-lib';
import { FormExportError, type FormExportCapability } from './forms/types';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PdfExportError('aborted', 'PDF export was cancelled.');
  }
}

function unsupportedSourceMessage(capability: FormExportCapability): string {
  switch (capability) {
    case 'unsupported-xfa':
      return 'This PDF uses XFA forms, which Kagaz cannot support yet.';
    case 'unsupported-signed-pdf':
      return 'This PDF already contains a digital signature. Kagaz does not modify digitally signed PDFs because changes can invalidate that signature.';
    case 'unsupported-password':
      return 'This PDF contains a password field, so Kagaz cannot safely flatten it for export yet.';
    case 'unsupported-button':
      return 'This PDF contains a push button. Button actions cannot be safely flattened for export.';
    case 'unsupported-field':
      return 'This PDF contains a form field that Kagaz cannot safely flatten yet.';
    case 'discovering':
      return 'Kagaz is still checking this PDF for form fields. Try again in a moment.';
    case 'error':
      return 'Kagaz could not verify that this PDF form is safe to export.';
    case 'plain':
    case 'safe-acroform':
      return '';
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
  const redactionsByPage = new Map(
    pages.map((page) => [
      page.id,
      (request.redactionsByPage?.get(page.id) ?? []).map((region) => ({
        ...region,
        box: { ...region.box },
      })),
    ]),
  );
  const hasRedactions = [...redactionsByPage.values()].some(
    (regions) => regions.length > 0,
  );
  const originalRedactedContent = new Set<string>();
  const uniqueSourceIds = [
    ...new Set(pages.map((page) => page.sourceDocumentId)),
  ];
  const sourceDocuments = new Map<string, PDFDocument>();
  const formSnapshots = new Map(
    request.forms.sources.map((snapshot) => [
      snapshot.sourceDocumentId,
      snapshot,
    ]),
  );

  throwIfAborted(options.signal);
  if (request.forms.hasChangedTextDraft) {
    throw new FormExportError(
      'active-draft',
      'Finish or cancel the active form text edit before exporting.',
    );
  }
  options.onProgress?.({
    phase: 'preparing',
    current: 0,
    total: uniqueSourceIds.length,
  });

  const [pdfLib, flattening, formPreparation, signatureSafety] =
    await Promise.all([
      import('pdf-lib'),
      import('./annotations/flattenAnnotations'),
      import('./forms/prepareFormSource'),
      import('../pdf-signatures/signatureSafety'),
    ]);
  const { PDFDocument, degrees } = pdfLib;
  const redactionFinalization = hasRedactions
    ? await import('./redactions/finalizeRedactions')
    : null;
  const retentionSafety = hasRedactions
    ? await import('./redactions/retentionSafety')
    : null;

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
      const formSnapshot = formSnapshots.get(sourceId);
      if (!formSnapshot) {
        throw new FormExportError(
          'missing-source-snapshot',
          'Form safety information is missing for a source PDF.',
          source.fileName,
        );
      }
      if (
        formSnapshot.capability !== 'plain' &&
        formSnapshot.capability !== 'safe-acroform'
      ) {
        throw new FormExportError(
          'unsupported-source',
          unsupportedSourceMessage(formSnapshot.capability),
          source.fileName,
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

      let sourceDocument: PDFDocument;
      try {
        sourceDocument = await PDFDocument.load(bytes, {
          throwOnInvalidObject: true,
        });
      } catch {
        throw new PdfExportError(
          'source-pdf-invalid',
          'This source PDF could not be opened for export.',
          source.fileName,
        );
      }

      try {
        signatureSafety.assertNoDigitalSignature(sourceDocument);
      } catch (error) {
        throw new FormExportError(
          'existing-digital-signature',
          error instanceof signatureSafety.SignedPdfError
            ? error.message
            : 'Kagaz could not safely inspect this PDF for existing digital signatures.',
          source.fileName,
        );
      }
      try {
        signatureSafety.assertNoExecutableActions(sourceDocument);
      } catch {
        throw new FormExportError(
          'unsupported-source',
          'This PDF contains JavaScript actions, which Kagaz cannot safely export.',
          source.fileName,
        );
      }
      try {
        signatureSafety.assertUnsignedSignatureStructure(sourceDocument);
      } catch {
        throw new FormExportError(
          'signature-field-removal-failed',
          'This PDF has an unsigned signature field whose widget structure Kagaz cannot safely export.',
          source.fileName,
        );
      }
      // Verify the real form inventory even if discovery reported no widgets.
      if (
        formSnapshot.capability === 'safe-acroform' ||
        sourceDocument.catalog.getAcroForm()
      ) {
        await formPreparation.prepareFormSource(
          sourceDocument,
          formSnapshot,
          pdfLib,
          source.fileName,
          () => throwIfAborted(options.signal),
        );
      }
      throwIfAborted(options.signal);
      if (retentionSafety) {
        const sourcePages = pages.filter(
          (page) => page.sourceDocumentId === sourceId,
        );
        const preservedPageIndices = sourcePages
          .filter((page) => (redactionsByPage.get(page.id)?.length ?? 0) === 0)
          .map((page) => page.sourcePageIndex);
        retentionSafety.assertSafePreservedPages(
          sourceDocument,
          preservedPageIndices,
        );
        retentionSafety.assertNoSharedRedactedResources(
          sourceDocument,
          sourcePages
            .filter((page) => (redactionsByPage.get(page.id)?.length ?? 0) > 0)
            .map((page) => page.sourcePageIndex),
          preservedPageIndices,
        );
      }
      sourceDocuments.set(sourceId, sourceDocument);
    }

    if (retentionSafety) {
      // Separate File instances can contain the same original source objects.
      // Compare resolved resource payloads across all source IDs before copy.
      for (const [sourceId, sourceDocument] of sourceDocuments) {
        const affectedPageIndices = pages
          .filter(
            (page) =>
              page.sourceDocumentId === sourceId &&
              (redactionsByPage.get(page.id)?.length ?? 0) > 0,
          )
          .map((page) => page.sourcePageIndex);
        for (const resource of await retentionSafety.resourceContentFingerprints(
          sourceDocument,
          affectedPageIndices,
          () => throwIfAborted(options.signal),
        ))
          originalRedactedContent.add(resource);
      }
      for (const [sourceId, sourceDocument] of sourceDocuments) {
        const preservedPageIndices = pages
          .filter(
            (page) =>
              page.sourceDocumentId === sourceId &&
              (redactionsByPage.get(page.id)?.length ?? 0) === 0,
          )
          .map((page) => page.sourcePageIndex);
        for (const resource of await retentionSafety.resourceContentFingerprints(
          sourceDocument,
          preservedPageIndices,
          () => throwIfAborted(options.signal),
        )) {
          if (originalRedactedContent.has(resource)) {
            throw new PdfExportError(
              'redaction-unsafe-retention',
              'This PDF retains original redacted resources on another page. Kagaz cannot safely export these redactions. Extract the redacted pages separately.',
            );
          }
        }
      }
    }

    const output = await PDFDocument.create();
    const annotationContext = await flattening.createAnnotationExportContext(
      output,
      flattening.createAnnotationImageResolver(request.imageAssets),
    );
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
        const regions = redactionsByPage.get(workspacePage.id) ?? [];
        if (regions.length > 0 && redactionFinalization) {
          const fingerprints = await redactionFinalization.finalizeRedactions(
            output,
            sourceDocument,
            workspacePage,
            regions,
            request.annotationsByPage.get(workspacePage.id) ?? [],
            flattening.createAnnotationImageResolver(request.imageAssets),
            options.signal,
          );
          for (const fingerprint of fingerprints)
            originalRedactedContent.add(fingerprint);
          continue;
        }
        const [copiedPage] = await output.copyPages(sourceDocument, [
          workspacePage.sourcePageIndex,
        ]);
        if (!copiedPage) {
          throw new Error('The requested source page was not returned.');
        }

        await flattening.flattenAnnotationsOntoCopiedPage(
          copiedPage,
          request.annotationsByPage.get(workspacePage.id) ?? [],
          output,
          annotationContext,
        );
        throwIfAborted(options.signal);

        const intrinsicRotation = copiedPage.getRotation().angle;
        const totalRotation = normalizeRotation(
          intrinsicRotation + workspacePage.rotationDelta,
        );
        copiedPage.setRotation(degrees(totalRotation));
        output.addPage(copiedPage);
      } catch (error: unknown) {
        if (
          error instanceof PdfExportError ||
          error instanceof AnnotationExportError
        ) {
          throw error;
        }
        throw new PdfExportError(
          'page-copy-failed',
          'Kagaz could not copy one of the workspace pages into the export.',
        );
      }
    }

    throwIfAborted(options.signal);
    if (retentionSafety) {
      await retentionSafety.assertNoOriginalRedactedContent(
        output,
        originalRedactedContent,
        () => throwIfAborted(options.signal),
        new Set(
          pages.flatMap((page, index) =>
            (redactionsByPage.get(page.id)?.length ?? 0) > 0 ? [index] : [],
          ),
        ),
      );
      throwIfAborted(options.signal);
    }
    options.onProgress?.({
      phase: 'saving',
      current: 1,
      total: 1,
    });

    try {
      const bytes = await output.save();
      throwIfAborted(options.signal);
      return bytes;
    } catch {
      throwIfAborted(options.signal);
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
