import { useCallback, useEffect, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PdfToolDialog } from '../../pdf-heavy-tools/PdfToolDialog';
import type { WorkspacePage } from '../../pdf-workspace/model/types';
import type { SourceDocumentRegistry } from '../../pdf-workspace/runtime/sourceDocumentRegistry';
import type { PdfWatermarkController } from '../hooks/usePdfWatermarks';
import type {
  WatermarkBase,
  WatermarkConfig,
  WatermarkPosition,
  WatermarkPreviewGeometry,
} from '../model/types';
import {
  targetWatermarkPageIds,
  validateWatermarkModel,
  watermarkTargetFromRange,
} from '../model/watermark';
import { WatermarkPreview } from '../rendering/WatermarkPreview';

function common(config: WatermarkConfig): WatermarkBase {
  return {
    id: config.id,
    opacity: config.opacity,
    rotation: config.rotation,
    scale: config.scale,
    position: config.position,
    customPosition: config.customPosition,
    target: config.target,
  };
}
function hex(color: {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}): string {
  return `#${[color.r, color.g, color.b]
    .map((value) =>
      Math.round(value * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function WatermarkDialog({
  controller,
  pages,
  currentPageId,
  registry,
  onClose,
}: {
  readonly controller: PdfWatermarkController;
  readonly pages: readonly WorkspacePage[];
  readonly currentPageId: string | null;
  readonly registry: SourceDocumentRegistry;
  readonly onClose: () => void;
}) {
  const draft = controller.draft;
  const { updateDraft } = controller;
  const [scope, setScope] = useState<'all' | 'current' | 'selected' | 'range'>(
    draft?.target.kind === 'all' ? 'all' : 'selected',
  );
  const [range, setRange] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [previewPageId, setPreviewPageId] = useState(
    currentPageId ?? pages[0]?.id ?? '',
  );
  const previewWorkspacePage = pages.find((page) => page.id === previewPageId);
  const geometryKey = `${previewPageId}:${previewWorkspacePage?.sourceDocumentId}:${previewWorkspacePage?.sourcePageIndex}:${previewWorkspacePage?.rotationDelta}`;
  const [geometryState, setGeometryState] = useState<{
    key: string;
    geometry: WatermarkPreviewGeometry;
  } | null>(null);
  const geometry =
    geometryState?.key === geometryKey ? geometryState.geometry : null;
  const [geometryFailure, setGeometryFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [previewFailure, setPreviewFailure] = useState<{
    config: WatermarkConfig | null;
    pageId: string;
    message: string | null;
  } | null>(null);
  const previewError =
    geometryFailure?.key === geometryKey
      ? geometryFailure.message
      : previewFailure?.config === draft &&
          previewFailure.pageId === previewPageId
        ? previewFailure.message
        : null;
  const [previewMaxWidth, setPreviewMaxWidth] = useState(() =>
    Math.min(320, Math.max(180, window.innerWidth - 96)),
  );
  const reportPreviewError = useCallback(
    (message: string | null) =>
      setPreviewFailure({ config: draft, pageId: previewPageId, message }),
    [draft, previewPageId],
  );
  useEffect(() => {
    if (scope !== 'range' || !draft) return;
    try {
      const target = watermarkTargetFromRange(range, pages);
      if (JSON.stringify(target) !== JSON.stringify(draft.target))
        updateDraft({ ...draft, target });
      queueMicrotask(() => setRangeError(null));
    } catch (failure: unknown) {
      if (draft.target.kind !== 'pages' || draft.target.pageIds.length)
        updateDraft({ ...draft, target: { kind: 'pages', pageIds: [] } });
      queueMicrotask(() =>
        setRangeError(
          failure instanceof Error ? failure.message : 'Use valid page ranges.',
        ),
      );
    }
  }, [updateDraft, draft, pages, range, scope]);
  useEffect(() => {
    const resize = () =>
      setPreviewMaxWidth(Math.min(320, Math.max(180, window.innerWidth - 96)));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    let active = true;
    let loadedPage: PDFPageProxy | null = null;
    const workspacePage = pages.find((page) => page.id === previewPageId);
    const document: PDFDocumentProxy | null | undefined = workspacePage
      ? registry.getDocument(workspacePage.sourceDocumentId)
      : undefined;
    if (workspacePage && document)
      void document
        .getPage(workspacePage.sourcePageIndex + 1)
        .then((page) => {
          loadedPage = page;
          if (!active) {
            page.cleanup();
            return;
          }
          setGeometryFailure(null);
          setGeometryState({
            key: geometryKey,
            geometry: {
              viewBox: [...page.view],
              userUnit: page.userUnit,
              rotation: (page.rotate + workspacePage.rotationDelta) % 360,
            },
          });
        })
        .catch(() => {
          if (active)
            setGeometryFailure({
              key: geometryKey,
              message: 'This page is unavailable for watermark preview.',
            });
        });
    return () => {
      active = false;
      loadedPage?.cleanup();
    };
  }, [geometryKey, pages, previewPageId, registry]);
  if (!draft) return null;
  const targetIds = targetWatermarkPageIds(draft.target, pages);
  const modelError = validateWatermarkModel(
    draft,
    new Set(pages.map((page) => page.id)),
  );
  const patch = (change: Partial<WatermarkBase>) =>
    controller.updateDraft({ ...draft, ...change });
  const changeScope = (next: typeof scope) => {
    setScope(next);
    setRangeError(null);
    if (next === 'all') patch({ target: { kind: 'all' } });
    else if (next === 'current')
      patch({
        target: {
          kind: 'pages',
          pageIds: currentPageId ? [currentPageId] : [],
        },
      });
    else if (next === 'selected')
      patch({
        target: {
          kind: 'pages',
          pageIds:
            draft.target.kind === 'pages'
              ? draft.target.pageIds
              : currentPageId
                ? [currentPageId]
                : [],
        },
      });
    else {
      try {
        patch({ target: watermarkTargetFromRange(range, pages) });
      } catch {
        patch({ target: { kind: 'pages', pageIds: [] } });
      }
    }
  };
  const visibleMessage = controller.error ?? rangeError ?? modelError;
  const orientedWidth = geometry
    ? geometry.rotation % 180
      ? geometry.viewBox[3]! - geometry.viewBox[1]!
      : geometry.viewBox[2]! - geometry.viewBox[0]!
    : 240;
  const orientedHeight = geometry
    ? geometry.rotation % 180
      ? geometry.viewBox[2]! - geometry.viewBox[0]!
      : geometry.viewBox[3]! - geometry.viewBox[1]!
    : 200;
  const previewScale = Math.min(
    previewMaxWidth / orientedWidth,
    250 / orientedHeight,
  );
  const previewWidth = orientedWidth * previewScale;
  const previewHeight = orientedHeight * previewScale;
  return (
    <PdfToolDialog id="watermark" title="Watermark" onClose={onClose}>
      <p id="watermark-privacy" className="watermark-hint">
        Adds a foreground mark locally. Watermarks do not remove information or
        prevent copying.
      </p>
      <form
        className="watermark-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!visibleMessage && !previewError)
            void controller.applyDraft().then((applied) => {
              if (applied) onClose();
            });
        }}
      >
        <fieldset className="watermark-mode">
          <legend>Watermark type</legend>
          <label>
            <input
              type="radio"
              name="watermark-kind"
              checked={draft.kind === 'text'}
              onChange={() =>
                controller.updateDraft({
                  ...common(draft),
                  kind: 'text',
                  text: 'DRAFT',
                  fontSize: 48,
                  color: { r: 0.5, g: 0.5, b: 0.5 },
                })
              }
            />
            Text
          </label>
          <label>
            <input
              type="radio"
              name="watermark-kind"
              checked={draft.kind === 'image'}
              onChange={() =>
                controller.updateDraft({
                  ...common(draft),
                  kind: 'image',
                  assetId: '',
                })
              }
            />
            Image
          </label>
        </fieldset>
        {draft.kind === 'text' ? (
          <>
            <label className="watermark-field">
              Watermark text
              <input
                aria-label="Watermark text"
                value={draft.text}
                maxLength={200}
                onChange={(event) =>
                  controller.updateDraft({ ...draft, text: event.target.value })
                }
              />
            </label>
            <div className="watermark-grid">
              <label className="watermark-field">
                Font size (points)
                <input
                  aria-label="Watermark font size"
                  type="number"
                  min={8}
                  max={144}
                  value={draft.fontSize}
                  onChange={(event) =>
                    controller.updateDraft({
                      ...draft,
                      fontSize: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="watermark-field">
                Text color
                <input
                  aria-label="Watermark text color"
                  type="color"
                  value={hex(draft.color)}
                  onChange={(event) => {
                    const value = event.target.value.slice(1);
                    controller.updateDraft({
                      ...draft,
                      color: {
                        r: parseInt(value.slice(0, 2), 16) / 255,
                        g: parseInt(value.slice(2, 4), 16) / 255,
                        b: parseInt(value.slice(4, 6), 16) / 255,
                      },
                    });
                  }}
                />
              </label>
            </div>
            <p className="watermark-hint">
              Standard Helvetica · unsupported characters show an error. Long
              text is fitted to the page.
            </p>
          </>
        ) : (
          <label className="watermark-field">
            Watermark image
            <input
              aria-label="Choose watermark image"
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void controller.chooseImage(file);
              }}
            />
            <span className="watermark-hint">
              {draft.assetId
                ? (controller.assetRegistry.get(draft.assetId)?.fileName ??
                  'Image selected')
                : 'PNG or JPEG · up to 10 MiB, 16 megapixels'}{' '}
              · proportions preserved
            </span>
          </label>
        )}
        <div className="watermark-grid">
          <label className="watermark-field">
            Opacity · {Math.round(draft.opacity * 100)}%
            <input
              aria-label="Watermark opacity"
              type="range"
              min={0}
              max={100}
              step={1}
              value={draft.opacity * 100}
              onChange={(event) =>
                patch({ opacity: Number(event.target.value) / 100 })
              }
            />
          </label>
          <label className="watermark-field">
            Size · {Math.round(draft.scale * 100)}%
            <input
              aria-label="Watermark size"
              type="range"
              min={5}
              max={100}
              step={1}
              value={draft.scale * 100}
              onChange={(event) =>
                patch({ scale: Number(event.target.value) / 100 })
              }
            />
          </label>
          <label className="watermark-field">
            Rotation (degrees)
            <input
              aria-label="Watermark rotation"
              type="number"
              min={-180}
              max={180}
              value={draft.rotation}
              onChange={(event) =>
                patch({ rotation: Number(event.target.value) })
              }
            />
          </label>
          <label className="watermark-field">
            Position
            <select
              aria-label="Watermark position"
              value={draft.position}
              onChange={(event) =>
                patch({ position: event.target.value as WatermarkPosition })
              }
            >
              <option value="center">Center</option>
              <option value="top-left">Top left</option>
              <option value="top-right">Top right</option>
              <option value="bottom-left">Bottom left</option>
              <option value="bottom-right">Bottom right</option>
              <option value="custom">Custom</option>
            </select>
          </label>
        </div>
        {draft.position === 'custom' ? (
          <div className="watermark-grid">
            <label className="watermark-field">
              X from left (%)
              <input
                aria-label="Watermark custom X"
                type="number"
                min={0}
                max={100}
                value={draft.customPosition.x * 100}
                onChange={(event) =>
                  patch({
                    customPosition: {
                      ...draft.customPosition,
                      x: Number(event.target.value) / 100,
                    },
                  })
                }
              />
            </label>
            <label className="watermark-field">
              Y from bottom (%)
              <input
                aria-label="Watermark custom Y"
                type="number"
                min={0}
                max={100}
                value={draft.customPosition.y * 100}
                onChange={(event) =>
                  patch({
                    customPosition: {
                      ...draft.customPosition,
                      y: Number(event.target.value) / 100,
                    },
                  })
                }
              />
            </label>
          </div>
        ) : null}
        <label className="watermark-field">
          Apply to
          <select
            aria-label="Watermark page scope"
            value={scope}
            onChange={(event) =>
              changeScope(event.target.value as typeof scope)
            }
          >
            <option value="all">All pages, including later additions</option>
            <option value="current">Current page</option>
            <option value="selected">Selected pages</option>
            <option value="range">Page ranges</option>
          </select>
        </label>
        {scope === 'range' ? (
          <label className="watermark-field">
            Page ranges
            <input
              aria-label="Watermark page ranges"
              placeholder="1-3, 5"
              value={range}
              onChange={(event) => {
                setRange(event.target.value);
                try {
                  patch({
                    target: watermarkTargetFromRange(event.target.value, pages),
                  });
                  setRangeError(null);
                } catch (failure) {
                  patch({ target: { kind: 'pages', pageIds: [] } });
                  setRangeError(
                    failure instanceof Error
                      ? failure.message
                      : 'Use valid page ranges.',
                  );
                }
              }}
            />
            <span className="watermark-hint">
              Current order at Apply. Repeated pages are included once.
            </span>
          </label>
        ) : null}
        {scope === 'selected' ? (
          <fieldset className="watermark-pages">
            <legend>Selected watermark pages</legend>
            {pages.map((page, index) => (
              <label key={page.id}>
                <input
                  type="checkbox"
                  aria-label={`Watermark page ${index + 1}`}
                  checked={targetIds.includes(page.id)}
                  onChange={(event) => {
                    const selected = new Set(targetIds);
                    if (event.target.checked) selected.add(page.id);
                    else selected.delete(page.id);
                    patch({
                      target: {
                        kind: 'pages',
                        pageIds: pages
                          .filter((item) => selected.has(item.id))
                          .map((item) => item.id),
                      },
                    });
                  }}
                />
                Page {index + 1}
              </label>
            ))}
          </fieldset>
        ) : null}
        <p className="watermark-target-status" role="status">
          {targetIds.length} of {pages.length} pages targeted
          {draft.target.kind === 'pages'
            ? ` · ${
                pages
                  .map((page, index) =>
                    targetIds.includes(page.id) ? index + 1 : null,
                  )
                  .filter(Boolean)
                  .join(', ') || 'none'
              }`
            : ' · added pages included'}
        </p>
        <div className="watermark-preview-section">
          <label className="watermark-field">
            Preview page
            <select
              aria-label="Watermark preview page"
              value={previewPageId}
              onChange={(event) => setPreviewPageId(event.target.value)}
            >
              {pages.map((page, index) => (
                <option key={page.id} value={page.id}>
                  Page {index + 1}
                  {targetIds.includes(page.id) ? '' : ' · not targeted'}
                </option>
              ))}
            </select>
          </label>
          <div
            className="watermark-preview-sheet"
            style={{ width: previewWidth, height: previewHeight }}
          >
            {geometry && !modelError && targetIds.includes(previewPageId) ? (
              <WatermarkPreview
                config={draft}
                geometry={geometry}
                assetRegistry={controller.assetRegistry}
                width={previewWidth}
                height={previewHeight}
                className="watermark-dialog-preview"
                onError={reportPreviewError}
              />
            ) : (
              <p className="watermark-preview-empty">
                {targetIds.includes(previewPageId)
                  ? 'Choose valid settings to preview'
                  : 'No watermark on this page'}
              </p>
            )}
          </div>
          <p className="watermark-hint">
            Mark placement preview · foreground above annotations and finalized
            redactions. Changes are committed only with Apply.
          </p>
        </div>
        {visibleMessage ? (
          <p className="extract-dialog-error" role="alert">
            {visibleMessage}
          </p>
        ) : null}
        <div className="extract-dialog-actions watermark-actions">
          {controller.state.present ? (
            <button
              type="button"
              className="text-button watermark-remove"
              disabled={controller.busy}
              onClick={() => {
                controller.remove();
                onClose();
              }}
            >
              Remove watermark
            </button>
          ) : null}
          <button type="button" className="text-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={
              controller.busy || Boolean(visibleMessage || previewError)
            }
          >
            {controller.busy ? 'Preparing…' : 'Apply watermark'}
          </button>
        </div>
      </form>
    </PdfToolDialog>
  );
}
