import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type {
  AssistantAnswerResponse,
  AssistantUsageStatus,
} from '@kagaz/shared-types';
import type { WorkspacePage } from '../../pdf-workspace/model/types';
import type { useLocalPdfSearch } from '../retrieval/useLocalPdfSearch';
import { REMOTE_CONTEXT_LIMITS } from '../retrieval/contextSharing';
import { useGoogleAuth } from './useGoogleAuth';
import type { User } from './firebaseAuth';
import {
  approveReviewedContext,
  reviewContext,
  type ContextReview,
} from './consent';
import {
  AssistantClientError,
  fetchAssistantUsage,
  generateAssistantAnswer,
} from './assistantClient';

interface ChatProps {
  readonly pages: readonly WorkspacePage[];
  readonly search: ReturnType<typeof useLocalPdfSearch>;
  readonly onNavigate: (pageId: string) => void;
}

export function AssistantChatPanel(props: ChatProps) {
  const auth = useGoogleAuth();
  return (
    <section className="assistant-chat" aria-labelledby="assistant-chat-title">
      <div className="assistant-search-intro">
        <h3 id="assistant-chat-title">AI Chat</h3>
        <p>
          Ask Groq about passages you choose. Every generation needs a fresh
          review.
        </p>
      </div>
      {auth.status === 'checking' ? (
        <p role="status" className="assistant-progress">
          Verifying your Google session…
        </p>
      ) : null}
      {auth.status === 'unavailable' ? (
        <div className="assistant-no-results" role="status">
          <h4>AI Chat is unavailable</h4>
          <p>
            The owner must configure Firebase Google sign-in. Edit PDF and Ask
            PDF remain available without an account.
          </p>
        </div>
      ) : null}
      {auth.status === 'signed-out' ? (
        <div className="assistant-chat-gate">
          <p>
            Sign in with Google to use remote answers. Signing in does not share
            your question or PDF text.
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={auth.busy}
            onClick={() => void auth.login()}
          >
            {auth.busy ? 'Opening Google…' : 'Sign in with Google'}
          </button>
          <details className="assistant-auth-redirect">
            <summary>Popup blocked or using a mobile browser?</summary>
            <p>
              Allow this site’s sign-in popup to keep your current PDF open.
              Redirect sign-in leaves this page: you will need to reopen your
              PDF and review passages again after returning. Kagaz does not save
              your document.
            </p>
            <button
              className="text-button"
              type="button"
              disabled={auth.busy}
              onClick={() => void auth.login(true)}
            >
              Sign in in this tab
            </button>
          </details>
        </div>
      ) : null}
      {auth.error ? (
        <p role="alert" className="assistant-error">
          {auth.error}
        </p>
      ) : null}
      {auth.status === 'signed-in' ? (
        <AuthenticatedChat
          key={`${auth.user.uid}:${auth.sessionEpoch}`}
          {...props}
          user={auth.user}
          isSessionCurrent={auth.isSessionCurrent}
          onSignOut={() => void auth.logout()}
        />
      ) : null}
    </section>
  );
}

function AuthenticatedChat({
  pages,
  search,
  onNavigate,
  user,
  isSessionCurrent,
  onSignOut,
}: ChatProps & {
  readonly user: User;
  readonly isSessionCurrent: () => boolean;
  readonly onSignOut: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [review, setReview] = useState<ContextReview | null>(null);
  const [response, setResponse] = useState<{
    readonly revision: string;
    readonly value: AssistantAnswerResponse;
    readonly context: ContextReview['context'];
  } | null>(null);
  const [usage, setUsage] = useState<AssistantUsageStatus | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const usageRef = useRef<AbortController | null>(null);
  const live = useRef(true);
  const revisionRef = useRef(search.contextRevision);
  const currentRef = useRef({ question, selectedIds, pages, search });
  const previousRevision = useRef(search.contextRevision);
  const reviewHeading = useRef<HTMLHeadingElement>(null);

  const clearPrivateState = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setGenerating(false);
    setReview(null);
    setResponse(null);
    setSelectedIds([]);
  }, []);

  useLayoutEffect(() => {
    revisionRef.current = search.contextRevision;
    currentRef.current = { question, selectedIds, pages, search };
    if (previousRevision.current !== search.contextRevision) {
      previousRevision.current = search.contextRevision;
      const hadTransmission = requestRef.current !== null;
      clearPrivateState();
      if (hadTransmission) setUsage(null);
      setMessage(
        hadTransmission
          ? 'The document or retrieval changed. The old request was cancelled and its answer discarded. Already shared text cannot be retracted; a generation attempt may be counted. Refresh usage before another request.'
          : 'The document or retrieval changed. Select passages and review again.',
      );
    }
  }, [clearPrivateState, pages, question, search, selectedIds]);

  useLayoutEffect(() => {
    if (review) reviewHeading.current?.focus({ preventScroll: true });
  }, [review]);

  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      requestRef.current?.abort();
      usageRef.current?.abort();
    };
  }, []);

  const refreshUsage = useCallback(async () => {
    usageRef.current?.abort();
    const controller = new AbortController();
    usageRef.current = controller;
    setUsageBusy(true);
    setUsage(null);
    try {
      const token = await user.getIdToken();
      if (controller.signal.aborted || !live.current) return;
      const value = await fetchAssistantUsage(token, controller.signal);
      if (controller.signal.aborted || !live.current) return;
      setUsage(value);
    } catch (cause) {
      if (!controller.signal.aborted && live.current)
        setError(
          cause instanceof AssistantClientError
            ? cause.message
            : 'Usage could not be verified. Check your Google session and connection.',
        );
    } finally {
      if (usageRef.current === controller && live.current) {
        usageRef.current = null;
        setUsageBusy(false);
      }
    }
  }, [user]);

  useEffect(() => {
    let active = true;
    // Wait for Firebase's asynchronous session boundary before requesting usage.
    void user
      .getIdToken()
      .then(() => {
        if (active) void refreshUsage();
      })
      .catch(() => {
        if (active)
          setError(
            'Your Google session could not be refreshed. Sign out and sign in again.',
          );
      });
    return () => {
      active = false;
    };
  }, [refreshUsage, user]);

  const makeCurrentReview = () => {
    const current = currentRef.current;
    return reviewContext(
      {
        question: current.question,
        selectedPassageIds: current.selectedIds,
        results: current.search.visibleResults,
        pages: current.pages,
        blockedSourcePages: current.search.blockedSourcePages,
      },
      revisionRef.current,
    );
  };

  const generate = async () => {
    const approved = review;
    if (
      !approved ||
      !isSessionCurrent() ||
      requestRef.current ||
      !usage?.available ||
      usage.remaining <= 0 ||
      usage.active
    )
      return;
    const request = approveReviewedContext(
      approved,
      makeCurrentReview(),
      crypto.randomUUID(),
      new Date().toISOString(),
    );
    if (!request) {
      clearPrivateState();
      setError(
        'The reviewed passages are stale. Search, select and review again.',
      );
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setGenerating(true);
    setReview(null); // Approval is consumed even if token refresh or generation fails.
    setResponse(null);
    setError(null);
    setMessage(
      'Sharing only the reviewed question and passages with Kagaz’s server and Groq…',
    );
    try {
      // Firebase refreshes short-lived ID tokens; no token is persisted by Kagaz.
      const token = await user.getIdToken(true);
      if (
        controller.signal.aborted ||
        !isSessionCurrent() ||
        !live.current ||
        approved.revision !== revisionRef.current ||
        !approveReviewedContext(
          approved,
          makeCurrentReview(),
          request.requestId,
          request.consent.reviewedAt,
        )
      )
        return;
      const answer = await generateAssistantAnswer(
        request,
        token,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        !isSessionCurrent() ||
        !live.current ||
        approved.revision !== revisionRef.current ||
        !approveReviewedContext(
          approved,
          makeCurrentReview(),
          request.requestId,
          request.consent.reviewedAt,
        )
      )
        return;
      setUsage(answer.usage);
      setResponse({
        revision: approved.revision,
        value: answer,
        context: approved.context,
      });
      setSelectedIds([]);
      setMessage(null);
    } catch (cause) {
      if (controller.signal.aborted || !live.current) return;
      setError(
        cause instanceof AssistantClientError
          ? cause.message
          : 'The request could not complete. A generation attempt may have been counted. Check your session and connection.',
      );
      if (cause instanceof AssistantClientError && cause.usage)
        setUsage(cause.usage);
    } finally {
      if (requestRef.current === controller && live.current) {
        requestRef.current = null;
        setGenerating(false);
        void refreshUsage();
      }
    }
  };

  const working =
    search.state.status === 'indexing' || search.state.status === 'searching';
  const canGenerate =
    usage?.available === true &&
    usage.remaining > 0 &&
    !usage.active &&
    !generating &&
    !usageBusy;
  const activeReview =
    review?.revision === search.contextRevision ? review : null;
  const activeResponse =
    response?.revision === search.contextRevision ? response : null;
  const resetDate = usage ? new Date(usage.resetAt) : null;

  return (
    <>
      <div className="assistant-chat-account">
        <div>
          <strong>{user.displayName ?? 'Google account'}</strong>
          {user.email ? <span>{user.email}</span> : null}
        </div>
        <button
          className="text-button"
          type="button"
          onClick={() => {
            clearPrivateState();
            setQuestion('');
            onSignOut();
          }}
        >
          Sign out
        </button>
      </div>
      <div className="assistant-chat-usage" aria-live="polite">
        {usageBusy ? (
          <p>Checking server usage…</p>
        ) : usage ? (
          <>
            <p>
              <strong>
                {usage.remaining} of {usage.dailyLimit}
              </strong>{' '}
              AI generations remaining today.
            </p>
            <p>
              Resets{' '}
              <time dateTime={usage.resetAt}>
                {resetDate?.toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>{' '}
              in your time zone · midnight UTC.
            </p>
            {!usage.available ? (
              <p role="status">
                {usage.unavailableReason ??
                  'AI generation is currently unavailable. The server’s provider and budget controls must be active.'}
              </p>
            ) : null}
            {usage.active ? (
              <p role="status">
                An AI generation is active for this account. Wait, then refresh
                usage.
              </p>
            ) : null}
          </>
        ) : (
          <p>Usage is unverified. Generation is disabled.</p>
        )}
        <button
          className="text-button"
          type="button"
          disabled={usageBusy || generating}
          onClick={() => {
            setError(null);
            void refreshUsage();
          }}
        >
          Refresh usage
        </button>
      </div>
      <form
        className="assistant-form assistant-chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          clearPrivateState();
          setMessage(null);
          setError(null);
          void search.search(question);
        }}
      >
        <label htmlFor="assistant-chat-question">
          Question for the selected PDF passages
        </label>
        <textarea
          id="assistant-chat-question"
          value={question}
          rows={3}
          maxLength={400}
          disabled={generating}
          aria-describedby="assistant-chat-scope"
          placeholder="When is payment due?"
          onChange={(event) => {
            setQuestion(event.target.value);
            setReview(null);
            setResponse(null);
          }}
        />
        <p id="assistant-chat-scope" className="assistant-hint">
          Find passages locally first. Only the question and passages shown in
          your next review are shared. No chat history is sent or saved.
        </p>
        <div className="assistant-actions">
          {working ? (
            <button
              className="text-button"
              type="button"
              onClick={search.cancel}
            >
              Cancel search
            </button>
          ) : null}
          <button
            className="text-button"
            type="submit"
            disabled={!question.trim() || generating}
          >
            Find passages locally
          </button>
        </div>
      </form>
      {search.pendingRedactionPageNumbers.length ? (
        <p className="assistant-redaction-notice" role="status">
          Pages {search.pendingRedactionPageNumbers.join(', ')} and their
          duplicate source pages are excluded because of pending redactions.
        </p>
      ) : null}
      {working ? (
        <p className="assistant-progress" role="status">
          Searching local PDF text · {search.state.progress.completedPages} of{' '}
          {search.state.progress.totalPages} pages…
        </p>
      ) : search.state.message ? (
        <p className="assistant-hint" role="status">
          {search.state.message}
        </p>
      ) : null}
      {search.visibleResults.length ? (
        <fieldset
          className="assistant-chat-passages"
          disabled={generating || working}
        >
          <legend>
            Select passages to share · {selectedIds.length}/
            {REMOTE_CONTEXT_LIMITS.maxPassages}
          </legend>
          <p className="assistant-hint">
            Up to five passages and 8,000 characters. The next review shows the
            exact bounded text.
          </p>
          <ol className="assistant-result-list">
            {search.visibleResults.map((result, index) => (
              <li className="assistant-result" key={result.id}>
                <label className="assistant-chat-passage-choice">
                  <input
                    type="checkbox"
                    aria-label={`Share passage ${index + 1} from page ${result.pageNumber}`}
                    checked={selectedIds.includes(result.id)}
                    disabled={
                      !selectedIds.includes(result.id) &&
                      selectedIds.length >= REMOTE_CONTEXT_LIMITS.maxPassages
                    }
                    onChange={(event) => {
                      setReview(null);
                      setSelectedIds((current) =>
                        event.target.checked
                          ? [...current, result.id]
                          : current.filter((id) => id !== result.id),
                      );
                    }}
                  />
                  <span>
                    Page {result.pageNumber} ·{' '}
                    {result.provenance === 'committed-form-value'
                      ? `Committed form value · ${result.fieldLabel ?? 'Unnamed field'}`
                      : 'Source PDF text'}
                  </span>
                </label>
                <blockquote>{result.excerpt}</blockquote>
              </li>
            ))}
          </ol>
        </fieldset>
      ) : null}
      <div className="assistant-actions">
        {generating ? (
          <button
            className="text-button"
            type="button"
            onClick={() => {
              requestRef.current?.abort();
              requestRef.current = null;
              setGenerating(false);
              setReview(null);
              setResponse(null);
              setSelectedIds([]);
              setMessage(
                'Cancelled. Text already sent to Kagaz’s server or Groq cannot be retracted. A generation attempt may still be counted.',
              );
              void refreshUsage();
            }}
          >
            Cancel generation
          </button>
        ) : (
          <button
            className="primary-button"
            type="button"
            disabled={
              !canGenerate || working || !question.trim() || !selectedIds.length
            }
            onClick={() => {
              const next = makeCurrentReview();
              setError(
                next
                  ? null
                  : 'These passages cannot be shared. Search and select fresh passages.',
              );
              setReview(next);
              setResponse(null);
            }}
          >
            Review context
          </button>
        )}
      </div>
      {activeReview ? (
        <section
          className="assistant-proposal assistant-context-review"
          aria-labelledby="assistant-context-review-title"
        >
          <h4
            id="assistant-context-review-title"
            ref={reviewHeading}
            tabIndex={-1}
          >
            Review what leaves your browser
          </h4>
          <p className="assistant-hint">
            {activeReview.context.privacyDisclosure}
          </p>
          <h5>Exact question</h5>
          <p className="assistant-chat-exact-question">
            {activeReview.context.question}
          </p>
          <h5>
            Exact passages ·{' '}
            {activeReview.context.contextCharacters.toLocaleString()} characters
          </h5>
          {activeReview.context.passages.map((passage) => (
            <div className="assistant-result" key={passage.passageId}>
              <strong>Page {passage.citation.pageNumber}</strong>
              <blockquote>{passage.text}</blockquote>
            </div>
          ))}
          <p className="assistant-hint">
            Your Google identity is verified by Kagaz’s server. One provider
            generation attempt uses your daily allowance, including chargeable
            failures. Cancelling cannot retract transmitted text.
          </p>
          <details className="assistant-context-data">
            <summary>Reviewed context data</summary>
            <pre>{JSON.stringify(activeReview.context, null, 2)}</pre>
          </details>
          <div className="assistant-actions assistant-proposal-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => setReview(null)}
            >
              Cancel review
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!canGenerate}
              onClick={() => void generate()}
            >
              Share and Generate
            </button>
          </div>
        </section>
      ) : null}
      <div aria-live="polite" aria-atomic="true" aria-busy={generating}>
        {message ? (
          <p
            className={
              generating ? 'assistant-progress' : 'assistant-cancelled'
            }
            role="status"
          >
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="assistant-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {activeResponse ? (
        <section
          className="assistant-proposal assistant-chat-answer"
          aria-labelledby="assistant-chat-answer-title"
        >
          <h4 id="assistant-chat-answer-title">
            {activeResponse.value.answer.status === 'answered'
              ? 'Answer from approved passages'
              : activeResponse.value.answer.status === 'refused'
                ? 'Unable to answer'
                : 'Insufficient evidence'}
          </h4>
          <p className="assistant-chat-answer-text">
            {activeResponse.value.answer.text}
          </p>
          <div className="assistant-chat-citations" aria-label="Answer sources">
            {activeResponse.value.answer.citations.map((id) => {
              const passage = activeResponse.context.passages.find(
                (candidate) => candidate.passageId === id,
              );
              const pageIndex = pages.findIndex(
                (page) => page.id === passage?.citation.workspacePageId,
              );
              return passage && pageIndex >= 0 ? (
                <button
                  className="assistant-result-citation"
                  type="button"
                  key={id}
                  aria-label={`Go to answer source page ${pageIndex + 1}`}
                  onClick={() => onNavigate(passage.citation.workspacePageId)}
                >
                  Page {pageIndex + 1}
                </button>
              ) : null;
            })}
          </div>
          <p className="assistant-hint">
            AI can be mistaken. Check the cited passages. This answer covers
            only your approved excerpts, not the entire document.
          </p>
        </section>
      ) : null}
    </>
  );
}
