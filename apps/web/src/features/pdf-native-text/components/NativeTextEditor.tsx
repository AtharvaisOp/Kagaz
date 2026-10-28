import type { WorkspacePage } from '../../pdf-workspace/model/types';
import type { PdfNativeTextController } from '../hooks/usePdfNativeText';

interface NativeTextEditorProps {
  readonly controller: PdfNativeTextController;
  readonly pages: readonly WorkspacePage[];
  readonly onChoosePage: (workspacePageId: string) => void;
}

function workspacePageLabel(
  pages: readonly WorkspacePage[],
  workspacePageId: string,
): string {
  const index = pages.findIndex((page) => page.id === workspacePageId);
  return index < 0 ? 'Removed page' : `Page ${index + 1}`;
}

/**
 * This panel deliberately has no page-overlay preview. A staged source edit is
 * an export transaction, not an annotation layered over the original canvas.
 */
export function NativeTextEditor({
  controller,
  pages,
  onChoosePage,
}: NativeTextEditorProps) {
  const { draft, state, resolving, error, announcement } = controller;
  const shouldRender =
    draft !== null ||
    resolving ||
    error !== null ||
    state.present.length > 0 ||
    announcement !== null;

  if (!shouldRender) return null;

  return (
    <section className="native-text-editor" aria-label="Source text editing">
      <div className="native-text-editor-header">
        <div>
          <p className="native-text-editor-eyebrow">Verified source text</p>
          <h2>Edit original PDF text</h2>
        </div>
        {draft ? (
          <button
            className="annotation-summary-action"
            type="button"
            onClick={controller.cancelDraft}
          >
            Cancel
          </button>
        ) : null}
      </div>
      <p className="native-text-editor-copy">
        Kagaz changes only a verified original text operand. The page preview
        stays unchanged until you export a new PDF.
      </p>
      {resolving ? (
        <p className="native-text-editor-status" role="status">
          Verifying the selected source-text run…
        </p>
      ) : null}
      {draft ? (
        <form
          className="native-text-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            controller.commitDraft();
          }}
        >
          <p className="native-text-editor-source">
            {workspacePageLabel(pages, draft.workspacePageId)} ·{' '}
            {draft.identity.fontBaseName} {draft.identity.fontSize} pt
          </p>
          <label className="native-text-editor-field">
            <span>Replacement text</span>
            <input
              autoFocus
              aria-label="Replacement source text"
              maxLength={512}
              value={draft.replacementText}
              onChange={(event) =>
                controller.updateDraft({
                  replacementText: event.currentTarget.value,
                })
              }
            />
          </label>
          <fieldset className="native-text-editor-position">
            <legend>Move in original PDF points</legend>
            <label className="native-text-editor-field">
              <span>Horizontal</span>
              <input
                aria-label="Move source text horizontally"
                type="number"
                step="1"
                value={draft.translationX}
                onChange={(event) =>
                  controller.updateDraft({
                    translationX: Number(event.currentTarget.value),
                  })
                }
              />
            </label>
            <label className="native-text-editor-field">
              <span>Vertical</span>
              <input
                aria-label="Move source text vertically"
                type="number"
                step="1"
                value={draft.translationY}
                onChange={(event) =>
                  controller.updateDraft({
                    translationY: Number(event.currentTarget.value),
                  })
                }
              />
            </label>
          </fieldset>
          <div className="native-text-editor-actions">
            <button className="primary-button" type="submit">
              Stage genuine edit
            </button>
            <button
              className="text-button"
              type="button"
              onClick={controller.cancelDraft}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {state.present.length > 0 ? (
        <ul
          className="native-text-editor-list"
          aria-label="Staged source-text edits"
        >
          {state.present.map((edit) => (
            <li key={edit.id}>
              <button
                className="native-text-editor-page"
                type="button"
                onClick={() => onChoosePage(edit.workspacePageId)}
              >
                {workspacePageLabel(pages, edit.workspacePageId)}
              </button>
              <span>
                “{edit.identity.originalText}” → “{edit.replacementText}”
                {edit.translationX || edit.translationY
                  ? ` · moved ${edit.translationX}, ${edit.translationY}`
                  : ''}
              </span>
              <span className="native-text-editor-item-actions">
                <button
                  className="annotation-summary-action"
                  type="button"
                  onClick={() => controller.editExisting(edit.id)}
                >
                  Edit
                </button>
                <button
                  className="annotation-summary-action annotation-summary-delete"
                  type="button"
                  onClick={() => controller.remove(edit.id)}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="native-text-editor-error" role="alert">
          {error}
        </p>
      ) : null}
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </section>
  );
}
