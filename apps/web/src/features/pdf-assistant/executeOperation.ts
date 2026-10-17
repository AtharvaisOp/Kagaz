import { DEFAULT_ANNOTATION_STYLE } from '../pdf-annotations/model/editorTypes';
import { viewportRectToPdfOrientedBox } from '../pdf-annotations/geometry/coordinateTransforms';
import { normalizeRotation } from '../pdf-workspace/model/operations';
import type { PdfAnnotationController } from '../pdf-annotations/hooks/usePdfAnnotations';
import type { PdfWatermarkController } from '../pdf-watermarks/hooks/usePdfWatermarks';
import {
  createDefaultWatermark,
  equalWatermarks,
} from '../pdf-watermarks/model/watermark';
import type { TextWatermarkConfig } from '../pdf-watermarks/model/types';
import type { PdfWorkspaceController } from '../pdf-workspace/hooks/usePdfWorkspace';
import type { SourceDocumentRegistry } from '../pdf-workspace/runtime/sourceDocumentRegistry';
import type { WorkspacePage } from '../pdf-workspace/model/types';
import { validateAssistantOperation } from './validation';

import type {
  AssistantExecutionResult,
  AssistantOperation,
  AssistantWorkspaceSnapshot,
} from './types';

export interface AssistantEditorPorts {
  readonly pages: readonly WorkspacePage[];
  readonly rotatePages: PdfWorkspaceController['rotatePages'];
  readonly movePage: PdfWorkspaceController['movePage'];
  readonly deletePage: PdfWorkspaceController['deletePage'];
  readonly scrollToPage: (pageId: string) => boolean;
  readonly annotations: Pick<
    PdfAnnotationController,
    'addAnnotation' | 'createAnnotationId'
  >;
  readonly watermarks: Pick<
    PdfWatermarkController,
    | 'state'
    | 'draft'
    | 'busy'
    | 'open'
    | 'cancel'
    | 'updateDraft'
    | 'applyDraft'
    | 'remove'
  >;
  readonly registry: SourceDocumentRegistry;
  readonly createWatermarkId: () => string;
}

function rejected(message: string): AssistantExecutionResult {
  return { kind: 'rejected', message };
}

function cancelled(): AssistantExecutionResult {
  return {
    kind: 'cancelled',
    message: 'The action was cancelled before it changed the workspace.',
  };
}

function currentSnapshotMatches(
  snapshotRevision: string,
  getSnapshot: () => AssistantWorkspaceSnapshot,
): boolean {
  return getSnapshot().revision === snapshotRevision;
}

async function applyTextWatermark(
  operation: Extract<AssistantOperation, { type: 'set_text_watermark' }>,
  ports: AssistantEditorPorts,
  signal: AbortSignal,
): Promise<AssistantExecutionResult> {
  if (ports.watermarks.draft || ports.watermarks.busy) {
    return rejected(
      'Finish or cancel the current watermark edit before using the assistant.',
    );
  }
  const existing = ports.watermarks.state.present;
  const base: TextWatermarkConfig =
    existing?.kind === 'text'
      ? existing
      : (createDefaultWatermark(
          ports.createWatermarkId(),
        ) as TextWatermarkConfig);
  const config: TextWatermarkConfig = {
    ...base,
    kind: 'text',
    text: operation.text,
    fontFamily:
      base.kind === 'text' ? (base.fontFamily ?? 'helvetica') : 'helvetica',
    target: { kind: 'all' },
  };
  if (existing && equalWatermarks(existing, config)) {
    return rejected(
      'That text watermark is already configured for every page.',
    );
  }

  ports.watermarks.open();
  ports.watermarks.updateDraft(config);
  const onAbort = () => ports.watermarks.cancel();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) {
      ports.watermarks.cancel();
      return cancelled();
    }
    const applied = await ports.watermarks.applyDraft();
    if (applied) {
      return {
        kind: 'applied',
        message: existing
          ? 'The text watermark was updated on every page.'
          : 'The text watermark was added to every page.',
      };
    }
    return signal.aborted
      ? cancelled()
      : rejected(
          'The watermark controller rejected the proposal. The document was not changed.',
        );
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function addTextAnnotation(
  operation: Extract<AssistantOperation, { type: 'add_text_annotation' }>,
  page: WorkspacePage,
  ports: AssistantEditorPorts,
  signal: AbortSignal,
  snapshotRevision: string,
  getSnapshot: () => AssistantWorkspaceSnapshot,
): Promise<AssistantExecutionResult> {
  const document = ports.registry.getDocument(page.sourceDocumentId);
  if (!document) return rejected('The selected page is no longer available.');

  let pdfPage: Awaited<ReturnType<typeof document.getPage>> | null = null;
  try {
    pdfPage = await document.getPage(page.sourcePageIndex + 1);
    if (signal.aborted) return cancelled();
    if (!currentSnapshotMatches(snapshotRevision, getSnapshot)) {
      return rejected(
        'The workspace changed while the note was being prepared. Review a fresh proposal.',
      );
    }

    const viewport = pdfPage.getViewport({
      scale: 1,
      rotation: normalizeRotation(pdfPage.rotate + page.rotationDelta),
    });
    const width = Math.min(430, viewport.width * 0.74);
    const height = Math.min(250, viewport.height * 0.58);
    if (width < 100 || height < 52) {
      return rejected('This page is too small for a safely placed text note.');
    }
    const charsPerLine = Math.max(1, Math.floor(width / 8));
    const visibleLines = Math.floor(height / (14 * 1.2));
    if (Math.ceil(operation.text.length / charsPerLine) > visibleLines) {
      return rejected('Shorten the note so it fits safely inside the page.');
    }
    const box = viewportRectToPdfOrientedBox(
      {
        x: (viewport.width - width) / 2,
        y: (viewport.height - height) / 2,
        width,
        height,
      },
      viewport,
    );
    if (!currentSnapshotMatches(snapshotRevision, getSnapshot)) {
      return rejected(
        'The workspace changed before the note could be added. Review a fresh proposal.',
      );
    }
    const selected = ports.scrollToPage(page.id);
    if (!selected) return rejected('The target page is no longer available.');
    const added = ports.annotations.addAnnotation({
      id: ports.annotations.createAnnotationId(),
      workspacePageId: page.id,
      kind: 'text',
      box,
      text: operation.text,
      fontFamily: 'helvetica',
      fontSizeUserUnits: 14,
      lineHeight: 1.2,
      align: 'center',
      color: DEFAULT_ANNOTATION_STYLE.strokeColor,
      opacity: 1,
    });
    return added
      ? {
          kind: 'applied',
          message:
            'The text note was added to the center of the selected page.',
        }
      : rejected(
          'The annotation controller rejected the note. The document was not changed.',
        );
  } catch {
    return signal.aborted
      ? cancelled()
      : rejected('Kagaz could not prepare the note geometry for this page.');
  } finally {
    pdfPage?.cleanup();
  }
}

export async function executeAssistantOperation(
  operation: AssistantOperation,
  approvedRevision: string,
  getSnapshot: () => AssistantWorkspaceSnapshot,
  ports: AssistantEditorPorts,
  signal: AbortSignal,
): Promise<AssistantExecutionResult> {
  if (signal.aborted) return cancelled();
  const snapshot = getSnapshot();
  if (snapshot.revision !== approvedRevision) {
    return rejected(
      'The workspace changed after this proposal. Interpret the command again.',
    );
  }
  const validation = validateAssistantOperation(operation, snapshot);
  if (!validation.ok) return rejected(validation.message);

  switch (validation.operation.type) {
    case 'select_page': {
      if (!ports.scrollToPage(validation.operation.pageId)) {
        return rejected('The target page is no longer available.');
      }
      return { kind: 'applied', message: 'The requested page is selected.' };
    }
    case 'rotate_pages':
      return ports.rotatePages(
        validation.operation.pageIds,
        validation.operation.degrees,
      )
        ? { kind: 'applied', message: 'The selected pages were rotated.' }
        : rejected('The page rotation was not accepted by the workspace.');
    case 'move_page':
      return ports.movePage(
        validation.operation.pageId,
        validation.operation.toIndex,
      )
        ? {
            kind: 'applied',
            message: 'The page was moved to the requested position.',
          }
        : rejected('The page move was not accepted by the workspace.');
    case 'delete_page':
      return ports.deletePage(validation.operation.pageId)
        ? { kind: 'applied', message: 'The selected page was deleted.' }
        : rejected('The page deletion was not accepted by the workspace.');
    case 'set_text_watermark':
      return applyTextWatermark(validation.operation, ports, signal);
    case 'remove_watermark':
      if (ports.watermarks.draft || ports.watermarks.busy) {
        return rejected(
          'Finish or cancel the current watermark edit before using the assistant.',
        );
      }
      return ports.watermarks.remove()
        ? { kind: 'applied', message: 'The committed watermark was removed.' }
        : rejected('The watermark controller did not change the workspace.');
    case 'add_text_annotation': {
      const annotationOperation = validation.operation;
      const page = ports.pages.find(
        (candidate) => candidate.id === annotationOperation.pageId,
      );
      if (!page) return rejected('The target page is no longer available.');
      return addTextAnnotation(
        annotationOperation,
        page,
        ports,
        signal,
        approvedRevision,
        getSnapshot,
      );
    }
    default: {
      const exhaustiveOperation: never = validation.operation;
      return rejected(String(exhaustiveOperation));
    }
  }
}
