import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { FormEvent } from 'react';

import { PdfToolDialog } from '../pdf-heavy-tools/PdfToolDialog';
import type { PdfAnnotationController } from '../pdf-annotations/hooks/usePdfAnnotations';
import type { PdfWatermarkController } from '../pdf-watermarks/hooks/usePdfWatermarks';
import type { PdfWorkspaceController } from '../pdf-workspace/hooks/usePdfWorkspace';
import type { WorkspacePage } from '../pdf-workspace/model/types';
import type { SourceDocumentRegistry } from '../pdf-workspace/runtime/sourceDocumentRegistry';
import { createBrowserIdFactory } from '../pdf-workspace/runtime/ids';
import { interpretLocalCommand } from './localInterpreter';
import { executeAssistantOperation } from './executeOperation';
import { validateAssistantOperation } from './validation';
import { createAssistantWorkspaceSnapshot } from './snapshot';

import type { AssistantEditorPorts } from './executeOperation';
import type {
  AssistantExecutionResult,
  AssistantOperation,
  AssistantWorkspaceSnapshot,
} from './types';

interface PlannedAction {
  readonly id: string;
  readonly operation: AssistantOperation;
  readonly revision: string;
}

interface AssistantDialogProps {
  readonly pages: readonly WorkspacePage[];
  readonly selectedPageId: string | null;
  readonly rotatePages: PdfWorkspaceController['rotatePages'];
  readonly movePage: PdfWorkspaceController['movePage'];
  readonly deletePage: PdfWorkspaceController['deletePage'];
  readonly scrollToPage: (pageId: string) => boolean;
  readonly annotationController: PdfAnnotationController;
  readonly watermarkController: PdfWatermarkController;
  readonly registry: SourceDocumentRegistry;
  readonly onClose: () => void;
}

function pageNumber(
  snapshot: AssistantWorkspaceSnapshot,
  pageId: string,
): number | null {
  return snapshot.pages.find((page) => page.id === pageId)?.pageNumber ?? null;
}

function describeOperation(
  operation: AssistantOperation,
  snapshot: AssistantWorkspaceSnapshot,
): {
  readonly title: string;
  readonly affected: string;
  readonly undo: string;
} {
  switch (operation.type) {
    case 'select_page': {
      const number = pageNumber(snapshot, operation.pageId);
      return {
        title: 'Select page ' + (number ?? 'unknown'),
        affected: 'Navigation only · no PDF content changes',
        undo: 'Page selection does not use document history.',
      };
    }
    case 'rotate_pages': {
      const numbers = operation.pageIds.map((id) => pageNumber(snapshot, id));
      return {
        title:
          'Rotate page' +
          (numbers.length === 1 ? ' ' : 's ') +
          numbers.join(', ') +
          (operation.degrees > 0 ? ' clockwise' : ' counterclockwise'),
        affected:
          numbers.length +
          ' ' +
          (numbers.length === 1 ? 'page' : 'pages') +
          ' · 90°',
        undo: 'Page rotation is not part of the current Undo/Redo history.',
      };
    }
    case 'move_page': {
      const number = pageNumber(snapshot, operation.pageId);
      return {
        title: 'Move page ' + (number ?? 'unknown'),
        affected: 'New position · ' + (operation.toIndex + 1),
        undo: 'Page order is not part of the current Undo/Redo history.',
      };
    }
    case 'delete_page': {
      const number = pageNumber(snapshot, operation.pageId);
      return {
        title: 'Delete page ' + (number ?? 'unknown'),
        affected: 'This removes one page from the current workspace.',
        undo: 'Page deletion is not part of the current Undo/Redo history.',
      };
    }
    case 'set_text_watermark':
      return {
        title: snapshot.watermark.present
          ? snapshot.watermark.kind === 'image'
            ? 'Replace existing image watermark with text'
            : 'Update existing text watermark'
          : 'Set text watermark',
        affected: '“' + operation.text + '” · every page',
        undo: 'Watermark changes are part of the shared Undo/Redo history.',
      };
    case 'remove_watermark':
      return {
        title: 'Remove watermark',
        affected:
          'The committed watermark will be removed from ' +
          snapshot.watermark.targetPageCount +
          (snapshot.watermark.targetPageCount === 1 ? ' page.' : ' pages.'),
        undo: 'Watermark changes are part of the shared Undo/Redo history.',
      };
    case 'add_text_annotation': {
      const number = pageNumber(snapshot, operation.pageId);
      return {
        title: 'Add a centered text note to page ' + (number ?? 'unknown'),
        affected: '“' + operation.text + '” · center of page',
        undo: 'Text annotations are part of the shared Undo/Redo history.',
      };
    }
  }
}

export function AssistantDialog({
  pages,
  selectedPageId,
  rotatePages,
  movePage,
  deletePage,
  scrollToPage,
  annotationController,
  watermarkController,
  registry,
  onClose,
}: AssistantDialogProps) {
  const snapshot = createAssistantWorkspaceSnapshot(
    pages,
    selectedPageId,
    watermarkController.state.present,
  );
  const snapshotRef = useRef(snapshot);
  const [proposalId] = useState(() =>
    createBrowserIdFactory('assistant-proposal'),
  );
  const [watermarkId] = useState(() =>
    createBrowserIdFactory('assistant-watermark'),
  );
  const [prompt, setPrompt] = useState('');
  const [planned, setPlanned] = useState<PlannedAction | null>(null);
  const [status, setStatus] = useState<
    'idle' | 'planning' | 'applying' | 'applied' | 'cancelled'
  >('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<
    'status' | 'error' | 'cancelled' | null
  >(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const applyLock = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);

  const ports: AssistantEditorPorts = {
    pages,
    rotatePages,
    movePage,
    deletePage,
    scrollToPage,
    annotations: annotationController,
    watermarks: watermarkController,
    registry,
    createWatermarkId: watermarkId,
  };

  useLayoutEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const cancelActive = useCallback(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, []);

  useEffect(
    () => () => {
      cancelActive();
    },
    [cancelActive],
  );

  const beginPlanning = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === 'planning' || status === 'applying') return;
    const text = prompt.trim();
    if (!text) {
      setMessage(
        'Enter a request before asking the assistant to interpret it.',
      );
      setMessageKind('error');
      return;
    }

    cancelActive();
    const controller = new AbortController();
    activeRequest.current = controller;
    const capturedSnapshot = snapshotRef.current;
    setPlanned(null);
    setDeleteConfirmed(false);
    setMessage(null);
    setMessageKind(null);
    setStatus('planning');

    // Yield once so the local busy state is announced before interpretation.
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => resolve()),
    );
    if (controller.signal.aborted) return;
    if (snapshotRef.current.revision !== capturedSnapshot.revision) {
      setStatus('idle');
      setMessage(
        'The workspace changed. Submit the command again for a fresh proposal.',
      );
      setMessageKind('error');
      return;
    }
    const result = interpretLocalCommand(text, capturedSnapshot);
    if (controller.signal.aborted) return;
    activeRequest.current = null;
    if (result.kind === 'proposal') {
      const validation = validateAssistantOperation(
        result.operation,
        snapshotRef.current,
      );
      if (!validation.ok) {
        setStatus('idle');
        setMessage(validation.message);
        setMessageKind('error');
        return;
      }
      setPlanned({
        id: proposalId(),
        operation: validation.operation,
        revision: capturedSnapshot.revision,
      });
      setStatus('idle');
      return;
    }
    setStatus('idle');
    setMessage(result.message);
    setMessageKind('error');
  };

  const applyPlanned = async () => {
    const action = planned;
    if (!action || applyLock.current || status === 'applying') return;
    if (snapshotRef.current.revision !== action.revision) {
      setStatus('idle');
      setMessage(
        'The workspace changed after this proposal. Submit the command again.',
      );
      setMessageKind('error');
      return;
    }
    if (action.operation.type === 'delete_page' && !deleteConfirmed) {
      setMessage('Confirm the page deletion before applying it.');
      setMessageKind('error');
      return;
    }

    const validation = validateAssistantOperation(
      action.operation,
      snapshotRef.current,
    );
    if (!validation.ok) {
      setMessage(validation.message);
      setMessageKind('error');
      return;
    }

    applyLock.current = true;
    const controller = new AbortController();
    activeRequest.current = controller;
    setMessage(null);
    setMessageKind(null);
    setStatus('applying');
    try {
      const result: AssistantExecutionResult = await executeAssistantOperation(
        validation.operation,
        action.revision,
        () => snapshotRef.current,
        ports,
        controller.signal,
      );
      if (result.kind === 'applied') {
        setStatus('applied');
        setMessage(result.message);
        setMessageKind('status');
      } else if (result.kind === 'cancelled') {
        setStatus('cancelled');
        setMessage(result.message);
        setMessageKind('cancelled');
      } else {
        setStatus('idle');
        setMessage(result.message);
        setMessageKind('error');
      }
    } catch {
      setStatus('idle');
      setMessage(
        'Kagaz could not complete the approved action. The workspace may be unchanged.',
      );
      setMessageKind('error');
    } finally {
      applyLock.current = false;
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  };

  const clearProposal = () => {
    cancelActive();
    setPlanned(null);
    setDeleteConfirmed(false);
    setStatus('idle');
    setMessage('The proposal was cancelled. No change was made.');
    setMessageKind('cancelled');
  };

  const stale =
    planned !== null &&
    status !== 'applied' &&
    status !== 'applying' &&
    planned.revision !== snapshot.revision;
  const preview = planned
    ? describeOperation(planned.operation, snapshot)
    : null;
  const requiresDeletionConfirmation =
    planned?.operation.type === 'delete_page';
  const applying = status === 'applying';
  const planning = status === 'planning';

  return (
    <PdfToolDialog
      id="assistant"
      title="AI Assistant"
      onClose={onClose}
      className="extract-dialog compress-dialog assistant-dialog"
    >
      <div id="assistant-privacy" className="assistant-privacy">
        <p>
          <strong>Local command interpreter · works offline</strong>
        </p>
        <p>
          This assistant reads your command and editor metadata only. PDF bytes,
          PDF text, filenames and annotations are not sent anywhere.
        </p>
        <p className="assistant-remote-status">
          Remote AI is unavailable until Kagaz configures an authenticated
          provider with usage limits. This prompt stays in your browser.
        </p>
      </div>

      <form
        className="assistant-form"
        onSubmit={(event) => void beginPlanning(event)}
      >
        <label htmlFor="assistant-prompt">Describe one PDF change</label>
        <textarea
          id="assistant-prompt"
          autoFocus
          data-dialog-autofocus
          rows={3}
          maxLength={500}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={
            'Rotate page 2 clockwise\nMove the last page to the beginning\nAdd a CONFIDENTIAL watermark to every page'
          }
          aria-describedby="assistant-prompt-hint"
          disabled={planning || applying}
        />
        <p id="assistant-prompt-hint" className="assistant-hint">
          Supported local commands: page navigation, rotation, reorder, delete,
          text watermarks and centered text notes.
        </p>
        <div className="assistant-actions">
          {planning ? (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                cancelActive();
                setStatus('cancelled');
                setMessage(
                  'Command interpretation cancelled. No change was made.',
                );
                setMessageKind('cancelled');
              }}
            >
              Cancel request
            </button>
          ) : null}
          <button
            className="primary-button"
            type="submit"
            disabled={planning || applying || !prompt.trim()}
          >
            {planning ? 'Interpreting locally…' : 'Review command'}
          </button>
        </div>
      </form>

      <div
        className="assistant-feedback"
        aria-live={messageKind === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
        aria-busy={planning || applying}
      >
        {planning ? (
          <p className="assistant-progress" role="status">
            <span className="export-status-dot" aria-hidden="true" />
            Interpreting the command in your browser…
          </p>
        ) : null}
        {applying ? (
          <div className="assistant-progress-row">
            <p className="assistant-progress" role="status">
              <span className="export-status-dot" aria-hidden="true" />
              Applying the approved change…
            </p>
            <button
              className="text-button"
              type="button"
              onClick={() => activeRequest.current?.abort()}
            >
              Cancel
            </button>
          </div>
        ) : null}
        {message ? (
          <p
            className={
              messageKind === 'error'
                ? 'assistant-error'
                : messageKind === 'cancelled'
                  ? 'assistant-cancelled'
                  : 'assistant-success'
            }
            role={messageKind === 'error' ? 'alert' : 'status'}
          >
            {message}
          </p>
        ) : null}
      </div>

      {planned && preview ? (
        <section
          className="assistant-proposal"
          aria-labelledby="assistant-proposal-title"
        >
          <div className="assistant-proposal-heading">
            <div>
              <p className="status-kicker">Review before applying</p>
              <h3 id="assistant-proposal-title">{preview.title}</h3>
            </div>
            <span className="assistant-local-badge">LOCAL</span>
          </div>
          <p className="assistant-affected">{preview.affected}</p>
          <p className="assistant-undo">{preview.undo}</p>
          {requiresDeletionConfirmation ? (
            <div className="assistant-delete-warning">
              <p>
                Deleting a page changes the current workspace and cannot be
                reversed with Undo/Redo.
              </p>
              <label className="assistant-confirm">
                <input
                  type="checkbox"
                  checked={deleteConfirmed}
                  disabled={applying || stale}
                  onChange={(event) => setDeleteConfirmed(event.target.checked)}
                />
                <span>I understand this page will be deleted.</span>
              </label>
            </div>
          ) : null}
          {stale ? (
            <p className="assistant-error" role="alert">
              The workspace changed after this proposal. Interpret the command
              again before applying it.
            </p>
          ) : null}
          <div className="assistant-actions assistant-proposal-actions">
            <button
              className="text-button"
              type="button"
              disabled={applying}
              onClick={clearProposal}
            >
              Cancel proposal
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={
                applying ||
                planning ||
                status === 'applied' ||
                stale ||
                (requiresDeletionConfirmation && !deleteConfirmed)
              }
              onClick={() => void applyPlanned()}
            >
              {status === 'applied' ? 'Applied' : 'Apply change'}
            </button>
          </div>
        </section>
      ) : null}
    </PdfToolDialog>
  );
}
