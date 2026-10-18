import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { FormEvent, ReactNode } from 'react';

import { PdfToolDialog } from '../pdf-heavy-tools/PdfToolDialog';
import type { PdfAnnotationController } from '../pdf-annotations/hooks/usePdfAnnotations';
import type { PdfWatermarkController } from '../pdf-watermarks/hooks/usePdfWatermarks';
import type { PdfWorkspaceController } from '../pdf-workspace/hooks/usePdfWorkspace';
import type { PdfFormsController } from '../pdf-forms/hooks/usePdfForms';
import type { WorkspacePage } from '../pdf-workspace/model/types';
import type { SourceDocumentRegistry } from '../pdf-workspace/runtime/sourceDocumentRegistry';
import { createBrowserIdFactory } from '../pdf-workspace/runtime/ids';
import type { RedactionRegion } from '../pdf-redactions/model/types';
import { interpretLocalCommand } from './localInterpreter';
import { executeAssistantOperation } from './executeOperation';
import { validateAssistantOperation } from './validation';
import { createAssistantWorkspaceSnapshot } from './snapshot';
import { normalizeSearchText, RETRIEVAL_LIMITS } from './retrieval/index';
import type { RetrievalResult } from './retrieval/index';
import { useLocalPdfSearch } from './retrieval/useLocalPdfSearch';

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
  readonly forms: PdfFormsController;
  readonly redactions: readonly RedactionRegion[];
  readonly retrievalResetRef: { current: (() => void) | null };
  readonly onClose: () => void;
}

interface AssistantSearchPanelProps {
  readonly pages: readonly WorkspacePage[];
  readonly state: ReturnType<typeof useLocalPdfSearch>['state'];
  readonly visibleResults: readonly (RetrievalResult & {
    readonly pageNumber: number;
  })[];
  readonly pendingRedactionPageNumbers: readonly number[];
  readonly onSearch: (query: string) => void;
  readonly onCancel: () => void;
  readonly onNavigate: (pageId: string) => void;
}

function highlightExcerpt(
  excerpt: string,
  terms: readonly string[],
): ReactNode {
  if (terms.length === 0) return excerpt;
  const normalizedTerms = new Set(terms);
  return excerpt.split(/([\p{L}\p{N}\p{M}]+)/gu).map((part, index) => {
    const normalized = normalizeSearchText(part);
    return normalizedTerms.has(normalized) ? (
      <mark key={`${part}:${index}`}>{part}</mark>
    ) : (
      part
    );
  });
}

function AssistantSearchPanel({
  pages,
  state,
  visibleResults,
  pendingRedactionPageNumbers,
  onSearch,
  onCancel,
  onNavigate,
}: AssistantSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState<{
    readonly key: string;
    readonly count: number;
  }>(() => ({
    key: '',
    count: RETRIEVAL_LIMITS.initialVisibleResults,
  }));
  const resultSetKey = JSON.stringify(
    state.results.map((result) => [result.id, result.matchedTerms]),
  );
  const displayedCount =
    visibleCount.key === resultSetKey
      ? visibleCount.count
      : RETRIEVAL_LIMITS.initialVisibleResults;
  const working = state.status === 'indexing' || state.status === 'searching';
  const showNoResults =
    !working &&
    state.messageKind === 'status' &&
    state.totalMatches === 0 &&
    state.message !== null;

  return (
    <section
      className="assistant-search"
      aria-labelledby="assistant-search-title"
      data-indexed-source-pages={state.summary?.searchableSourcePages ?? 0}
      data-indexed-form-passages={state.summary?.indexedFormPassages ?? 0}
      data-indexed-text-characters={state.summary?.characters ?? 0}
      data-indexed-chunks={state.summary?.chunks ?? 0}
      data-index-generation={state.summary?.generation ?? 0}
    >
      <div className="assistant-search-intro">
        <h3 id="assistant-search-title">Ask PDF</h3>
        <p>
          Search selectable text from the opened PDFs. Results quote the source
          text and link to its current workspace page.
        </p>
      </div>
      <form
        className="assistant-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(query);
        }}
      >
        <label htmlFor="assistant-search-query">
          Question or search phrase
        </label>
        <input
          id="assistant-search-query"
          type="search"
          value={query}
          maxLength={RETRIEVAL_LIMITS.maxQueryCharacters}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={'Find payment terms, or search for “late delivery”'}
          aria-describedby="assistant-search-hint"
        />
        <p id="assistant-search-hint" className="assistant-hint">
          Use a name, number, topic, or quote an exact phrase. Add “page 7” to
          limit a search to one current workspace page.
        </p>
        <div className="assistant-actions">
          {working ? (
            <button className="text-button" type="button" onClick={onCancel}>
              Cancel search
            </button>
          ) : null}
          <button
            className="primary-button"
            type="submit"
            disabled={!query.trim() || pages.length === 0}
          >
            {working ? 'Search again' : 'Search locally'}
          </button>
        </div>
      </form>

      <div
        className="assistant-search-disclosure"
        aria-label="Local search scope"
      >
        <p>Browser-local processing · no document text is uploaded.</p>
        <p>
          This searches source PDF text and committed supported form values.
          Form results are labeled; uncommitted drafts, annotations, and
          watermarks are excluded. Scanned pages are not OCR’d.
        </p>
        <p>
          Results are evidence from matching words and phrases. A generative
          model is not connected for broader reasoning.
        </p>
      </div>

      {pendingRedactionPageNumbers.length > 0 ? (
        <div className="assistant-redaction-notice" role="status">
          <strong>Pending redactions exclude source pages</strong>
          <span>
            Retrieval skipped page
            {pendingRedactionPageNumbers.length === 1 ? '' : 's'}{' '}
            {pendingRedactionPageNumbers.join(', ')} entirely, including
            matching duplicate source pages. Text behind pending redactions was
            not read or searched.
          </span>
        </div>
      ) : null}

      <div
        className="assistant-feedback assistant-search-feedback"
        aria-live={state.messageKind === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
        aria-busy={working}
      >
        {state.status === 'indexing' ? (
          <p className="assistant-progress" role="status">
            <span className="export-status-dot" aria-hidden="true" />
            Indexing local PDF text · page {
              state.progress.completedPages
            } of {state.progress.totalPages}.
          </p>
        ) : null}
        {state.status === 'searching' ? (
          <p className="assistant-progress" role="status">
            <span className="export-status-dot" aria-hidden="true" />
            Ranking matching passages locally…
          </p>
        ) : null}
        {state.message ? (
          <p
            className={
              state.messageKind === 'error'
                ? 'assistant-error'
                : state.messageKind === 'cancelled'
                  ? 'assistant-cancelled'
                  : 'assistant-success'
            }
            role={state.messageKind === 'error' ? 'alert' : 'status'}
          >
            {state.message}
          </p>
        ) : null}
      </div>

      {showNoResults ? (
        <div className="assistant-no-results" role="status">
          <h4>
            {state.summary?.searchableSourcePages === 0 &&
            state.summary.indexedFormPassages === 0
              ? 'No selectable source text is available'
              : 'No matching passages'}
          </h4>
          <p>
            {state.summary?.searchableSourcePages === 0 &&
            state.summary.indexedFormPassages === 0
              ? 'This document may contain scanned pages or unsupported text. Kagaz does not run OCR automatically.'
              : 'Try fewer terms, a different spelling, or remove a page filter.'}
          </p>
        </div>
      ) : null}

      {visibleResults.length > 0 ? (
        <section
          className="assistant-results"
          aria-labelledby="assistant-results-title"
        >
          <div className="assistant-results-heading">
            <div>
              <h4 id="assistant-results-title">Matching passages</h4>
              <p>
                Showing {Math.min(displayedCount, visibleResults.length)} of{' '}
                {state.limited
                  ? `at least ${state.totalMatches}`
                  : state.totalMatches}{' '}
                {state.totalMatches === 1 ? 'passage' : 'passages'}.
              </p>
            </div>
          </div>
          <ol className="assistant-result-list">
            {visibleResults.slice(0, displayedCount).map((result) => (
              <li className="assistant-result" key={result.id}>
                <div className="assistant-result-meta">
                  <button
                    className="assistant-result-citation"
                    type="button"
                    aria-label={`Go to page ${result.pageNumber}`}
                    onClick={() => onNavigate(result.pageId)}
                  >
                    Page {result.pageNumber}
                  </button>
                  <span className="assistant-result-provenance">
                    {result.provenance === 'committed-form-value'
                      ? `Committed form value · ${result.fieldLabel ?? 'Unnamed field'}`
                      : 'Source PDF text'}
                  </span>
                  <span className="assistant-result-reason">
                    {result.matchReason}
                  </span>
                </div>
                <blockquote>
                  {highlightExcerpt(result.excerpt, result.matchedTerms)}
                </blockquote>
              </li>
            ))}
          </ol>
          {displayedCount < visibleResults.length ? (
            <button
              className="text-button assistant-show-more"
              type="button"
              onClick={() =>
                setVisibleCount((current) => ({
                  key: resultSetKey,
                  count: Math.min(
                    RETRIEVAL_LIMITS.maxSearchResults,
                    (current.key === resultSetKey
                      ? current.count
                      : RETRIEVAL_LIMITS.initialVisibleResults) +
                      RETRIEVAL_LIMITS.initialVisibleResults,
                  ),
                }))
              }
            >
              Show{' '}
              {Math.min(
                RETRIEVAL_LIMITS.initialVisibleResults,
                visibleResults.length - displayedCount,
              )}{' '}
              more passages
            </button>
          ) : null}
          {state.limited ? (
            <p className="assistant-limit-notice" role="status">
              The local result limit was reached. Add more specific words to
              inspect additional passages.
            </p>
          ) : null}
        </section>
      ) : null}
    </section>
  );
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
  forms,
  redactions,
  retrievalResetRef,
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
  const [mode, setMode] = useState<'edit' | 'ask'>('edit');
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
  const localSearch = useLocalPdfSearch({ pages, redactions, registry, forms });

  useLayoutEffect(() => {
    retrievalResetRef.current = localSearch.clear;
    return () => {
      if (retrievalResetRef.current === localSearch.clear)
        retrievalResetRef.current = null;
    };
  }, [localSearch.clear, retrievalResetRef]);

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
          <strong>Browser-local assistant</strong>
        </p>
        <p>
          Editing commands use the offline interpreter. Ask PDF extracts and
          searches selectable source text in this browser. PDF bytes, extracted
          text, committed form values, filenames and annotations are not sent
          anywhere.
        </p>
        <p className="assistant-remote-status">
          Remote generative answers are disabled. Search results are grounded
          passages, not model-generated conclusions.
        </p>
      </div>

      <div
        className="assistant-mode-switch"
        role="group"
        aria-label="Assistant mode"
      >
        <button
          className={mode === 'edit' ? 'is-active' : ''}
          type="button"
          aria-pressed={mode === 'edit'}
          onClick={() => setMode('edit')}
        >
          Edit PDF
        </button>
        <button
          className={mode === 'ask' ? 'is-active' : ''}
          type="button"
          aria-pressed={mode === 'ask'}
          onClick={() => setMode('ask')}
        >
          Ask PDF
        </button>
      </div>

      {mode === 'edit' ? (
        <>
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
              Supported local commands: page navigation, rotation, reorder,
              delete, text watermarks and centered text notes.
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
                      onChange={(event) =>
                        setDeleteConfirmed(event.target.checked)
                      }
                    />
                    <span>I understand this page will be deleted.</span>
                  </label>
                </div>
              ) : null}
              {stale ? (
                <p className="assistant-error" role="alert">
                  The workspace changed after this proposal. Interpret the
                  command again before applying it.
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
        </>
      ) : (
        <AssistantSearchPanel
          pages={pages}
          state={localSearch.state}
          visibleResults={localSearch.visibleResults}
          pendingRedactionPageNumbers={localSearch.pendingRedactionPageNumbers}
          onSearch={(query) => void localSearch.search(query)}
          onCancel={localSearch.cancel}
          onNavigate={(pageId) => {
            if (scrollToPage(pageId)) onClose();
          }}
        />
      )}
    </PdfToolDialog>
  );
}
