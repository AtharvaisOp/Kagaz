import { useLayoutEffect, useRef, useState } from 'react';
import type {
  WorkspacePage,
  WorkspacePageId,
} from '../../pdf-workspace/model/types';
import type { PdfRedactionController } from '../hooks/usePdfRedactions';
import type { RedactionBox, RedactionRegion } from '../model/types';

interface Props {
  readonly controller: PdfRedactionController;
  readonly pageId: WorkspacePageId | null;
  readonly pages: readonly WorkspacePage[];
  readonly onChoosePage: (pageId: WorkspacePageId) => void;
  readonly onActivate: () => void;
}

function geometryValues(box: RedactionBox) {
  return {
    x: String(box.x),
    y: String(box.y),
    width: String(box.width),
    height: String(box.height),
  };
}

function RedactionGeometryEditor({
  region,
  controller,
}: {
  readonly region: RedactionRegion;
  readonly controller: PdfRedactionController;
}) {
  const [working, setWorking] = useState(() => ({
    region,
    values: geometryValues(region.box),
  }));
  // Synchronize committed pointer/history edits without remounting focused controls.
  if (working.region !== region)
    setWorking({ region, values: geometryValues(region.box) });
  const values = working.values;
  return (
    <form
      className="redaction-geometry"
      onSubmit={(event) => {
        event.preventDefault();
        controller.replace({
          ...region,
          box: {
            x: Number(values.x),
            y: Number(values.y),
            width: Number(values.width),
            height: Number(values.height),
          },
        });
      }}
    >
      <p className="redaction-coordinates-note">
        PDF coordinates · origin at bottom left
      </p>
      {(['x', 'y', 'width', 'height'] as const).map((name) => (
        <label key={name}>
          <span>
            {name === 'x' || name === 'y' ? name.toUpperCase() : name}
          </span>
          <input
            type="number"
            step="any"
            required
            aria-label={`Redaction ${name === 'x' || name === 'y' ? name.toUpperCase() : name}`}
            value={values[name]}
            onChange={(event) =>
              setWorking((current) => ({
                ...current,
                values: { ...current.values, [name]: event.target.value },
              }))
            }
          />
        </label>
      ))}
      <button type="submit" className="annotation-summary-action">
        Apply redaction geometry
      </button>
    </form>
  );
}

export function RedactionSummary({
  controller,
  pageId,
  pages,
  onChoosePage,
  onActivate,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [chosenPageId, setChosenPageId] = useState<WorkspacePageId | null>(
    null,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterRemove = useRef<string | null>(null);
  const selectedRegion = controller.state.present.find(
    (region) => region.id === controller.selectionId,
  );
  // Explicit management context survives focus scrolling and visible-page changes.
  // Selecting a proposal on the canvas still reveals its own page's controls.
  const targetPageId =
    selectedRegion?.pageId ??
    (pages.some((page) => page.id === chosenPageId) ? chosenPageId : pageId);
  const targetPageNumber =
    pages.findIndex((page) => page.id === targetPageId) + 1;
  const regions = targetPageId
    ? controller.getRegionsForPage(targetPageId)
    : [];
  const bounds = targetPageId
    ? controller.getPageBounds(targetPageId)
    : undefined;
  const allCount = controller.state.present.length;
  useLayoutEffect(() => {
    const focus = focusAfterRemove.current;
    focusAfterRemove.current = null;
    if (focus === 'heading') headingRef.current?.focus();
    else if (focus) buttonsRef.current.get(focus)?.focus();
  }, [controller.state.present]);
  if (!controller.active && allCount === 0) return null;
  return (
    <section
      className="annotation-summary redaction-summary"
      aria-labelledby="redaction-summary-title"
    >
      <div className="annotation-summary-header">
        <h2 id="redaction-summary-title" ref={headingRef} tabIndex={-1}>
          Pending redactions
        </h2>
        <span aria-label={`${allCount} pending redactions in workspace`}>
          {allCount}
        </span>
        <button
          type="button"
          className="annotation-summary-toggle"
          aria-expanded={expanded}
          aria-controls="redaction-summary-content"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>
      <div
        id="redaction-summary-content"
        className="annotation-summary-content"
        hidden={!expanded}
      >
        <p className="redaction-explanation">
          Proposals remain editable here. Export permanently removes covered
          information. Affected pages become images and lose selectable text;
          other pages keep their existing content.
        </p>
        <div className="redaction-management-controls">
          <label className="annotation-select-label redaction-page-picker">
            <span id="redaction-page-choice-label">Redactions on page</span>
            <select
              aria-labelledby="redaction-page-choice-label"
              value={targetPageId ?? ''}
              disabled={pages.length === 0}
              onChange={(event) => {
                const id = event.target.value;
                setChosenPageId(id);
                controller.select(null);
                onChoosePage(id);
              }}
            >
              {pages.map((page, index) => (
                <option key={page.id} value={page.id}>
                  Page {index + 1}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="annotation-summary-action"
            disabled={!targetPageId || !bounds}
            onClick={() => {
              if (!targetPageId || !bounds) return;
              onActivate();
              controller.add(targetPageId, {
                x: bounds.x + bounds.width * 0.25,
                y: bounds.y + bounds.height * 0.45,
                width: bounds.width * 0.5,
                height: bounds.height * 0.1,
              });
            }}
          >
            Add redaction region
          </button>
        </div>
        {targetPageId && !bounds ? (
          <p className="annotation-summary-empty" role="status">
            Page {targetPageNumber} is loading. Wait for its preview before
            adding a redaction.
          </p>
        ) : null}
        {regions.length === 0 ? (
          <p className="annotation-summary-empty">
            No pending redactions on this page. Draw a region or use Add
            redaction region.
          </p>
        ) : (
          <ol className="annotation-summary-list redaction-summary-list">
            {regions.map((region, index) => (
              <li key={region.id} className="annotation-summary-item">
                <button
                  ref={(node) => {
                    if (node) buttonsRef.current.set(region.id, node);
                    else buttonsRef.current.delete(region.id);
                  }}
                  type="button"
                  className="annotation-summary-select"
                  aria-label={`Pending redaction ${index + 1}`}
                  aria-pressed={controller.selectionId === region.id}
                  onClick={() => {
                    onActivate();
                    controller.select(region.id);
                  }}
                >
                  <span className="annotation-summary-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="annotation-summary-label">
                    Pending redaction
                  </span>
                </button>
                {controller.selectionId === region.id ? (
                  <div className="annotation-summary-actions">
                    <RedactionGeometryEditor
                      key={region.id}
                      region={region}
                      controller={controller}
                    />
                    <button
                      type="button"
                      className="annotation-summary-action annotation-summary-delete"
                      aria-label={`Remove pending redaction ${index + 1}`}
                      onClick={() => {
                        focusAfterRemove.current =
                          regions[index + 1]?.id ??
                          regions[index - 1]?.id ??
                          'heading';
                        controller.remove(region.id);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <p className="redaction-status" role="status">
          {controller.announcement ? (
            <span>{controller.announcement} </span>
          ) : null}
          {allCount
            ? `${allCount} proposal${allCount === 1 ? '' : 's'} will be finalized in exported PDFs.`
            : 'Redact is ready. The opened workspace is unchanged.'}
        </p>
        {controller.error ? (
          <p className="annotation-error" role="alert">
            {controller.error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
