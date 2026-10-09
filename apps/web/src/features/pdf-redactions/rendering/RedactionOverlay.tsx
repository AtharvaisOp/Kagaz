import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { PageViewport } from 'pdfjs-dist';
import type { WorkspacePageId } from '../../pdf-workspace/model/types';
import type { PdfRedactionController } from '../hooks/usePdfRedactions';
import {
  boxWithinPage,
  clientToRedactionPoint,
  isRedactionBox,
  moveRedactionBox,
  projectRedactionBox,
  redactionBoxFromPoints,
  viewportPageBounds,
} from '../model/geometry';
import type { RedactionBox, RedactionRegion } from '../model/types';

interface Props {
  readonly pageId: WorkspacePageId;
  readonly viewport: PageViewport;
  readonly active: boolean;
  readonly regions: readonly RedactionRegion[];
  readonly selectedId: string | null;
  readonly onAdd: PdfRedactionController['add'];
  readonly onReplace: PdfRedactionController['replace'];
  readonly onSelect: PdfRedactionController['select'];
  readonly onRegisterBounds: PdfRedactionController['registerPageBounds'];
}

type Gesture = {
  readonly pointerId: number;
  readonly start: { x: number; y: number };
  readonly region: RedactionRegion | null;
  readonly mode: 'draw' | 'move' | 'resize';
  readonly resizeOffset: { x: number; y: number };
};

/** Editing preview only. No preview surface is ever used as export content. */
export function RedactionOverlay({
  pageId,
  viewport,
  active,
  regions,
  selectedId,
  onAdd,
  onReplace,
  onSelect,
  onRegisterBounds,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<{
    id: string | null;
    box: RedactionBox;
  } | null>(null);
  const pageBounds = viewportPageBounds(viewport);
  useEffect(() => {
    onRegisterBounds(pageId, viewportPageBounds(viewport));
  }, [onRegisterBounds, pageId, viewport]);
  useEffect(() => {
    const overlay = overlayRef.current;
    return () => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (gesture && overlay?.hasPointerCapture(gesture.pointerId))
        overlay.releasePointerCapture(gesture.pointerId);
    };
  }, [active, pageId, viewport]);

  const pointForEvent = (event: PointerEvent<HTMLDivElement>) =>
    clientToRedactionPoint(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
      viewport,
    );
  const boxForEvent = (
    event: PointerEvent<HTMLDivElement>,
    gesture: Gesture,
  ): RedactionBox => {
    const rawPoint = pointForEvent(event);
    const point = {
      x: Math.max(
        pageBounds.x,
        Math.min(
          pageBounds.x + pageBounds.width,
          rawPoint.x + gesture.resizeOffset.x,
        ),
      ),
      y: Math.max(
        pageBounds.y,
        Math.min(
          pageBounds.y + pageBounds.height,
          rawPoint.y + gesture.resizeOffset.y,
        ),
      ),
    };
    return gesture.mode === 'move' && gesture.region
      ? moveRedactionBox(
          gesture.region.box,
          point.x - gesture.start.x,
          point.y - gesture.start.y,
          pageBounds,
        )
      : redactionBoxFromPoints(gesture.start, point);
  };
  const cancelGesture = () => {
    gestureRef.current = null;
    setDraft(null);
  };

  return (
    <div
      ref={overlayRef}
      className={`redaction-overlay${active ? ' redaction-overlay--active' : ''}`}
      aria-hidden="true"
      onPointerDown={(event) => {
        if (!active || event.button !== 0 || gestureRef.current) return;
        event.preventDefault();
        const target = event.target instanceof Element ? event.target : null;
        const id = target?.closest<HTMLElement>('[data-redaction-id]')?.dataset
          .redactionId;
        const region = regions.find((candidate) => candidate.id === id) ?? null;
        const resizing = Boolean(target?.closest('[data-redaction-resize]'));
        let start = pointForEvent(event);
        let resizeOffset = { x: 0, y: 0 };
        if (region && resizing) {
          const projected = projectRedactionBox(region.box, viewport);
          const raw = viewport.convertToPdfPoint(projected.x, projected.y);
          const rawEnd = viewport.convertToPdfPoint(
            projected.x + projected.width,
            projected.y + projected.height,
          );
          if (
            typeof raw[0] !== 'number' ||
            typeof raw[1] !== 'number' ||
            typeof rawEnd[0] !== 'number' ||
            typeof rawEnd[1] !== 'number'
          )
            return;
          resizeOffset = { x: rawEnd[0] - start.x, y: rawEnd[1] - start.y };
          start = { x: raw[0], y: raw[1] };
        }
        gestureRef.current = {
          pointerId: event.pointerId,
          start,
          region,
          mode: region ? (resizing ? 'resize' : 'move') : 'draw',
          resizeOffset,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId || !active)
          return;
        event.preventDefault();
        setDraft({
          id: gesture.region?.id ?? null,
          box: boxForEvent(event, gesture),
        });
      }}
      onPointerUp={(event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const box = boxForEvent(event, gesture);
        cancelGesture();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        if (
          !active ||
          !isRedactionBox(box) ||
          !boxWithinPage(box, pageBounds)
        ) {
          if (active && gesture.mode === 'draw') onSelect(null);
          return;
        }
        if (gesture.region) onReplace({ ...gesture.region, box });
        else onAdd(pageId, box);
      }}
      onPointerCancel={cancelGesture}
      onLostPointerCapture={cancelGesture}
    >
      {regions.map((region) => {
        const box = draft?.id === region.id ? draft.box : region.box;
        const display = projectRedactionBox(box, viewport);
        const selected = selectedId === region.id;
        return (
          <div
            key={region.id}
            className={`redaction-proposal${selected ? ' redaction-proposal--selected' : ''}`}
            data-redaction-id={region.id}
            data-pdf-box={[
              region.box.x,
              region.box.y,
              region.box.width,
              region.box.height,
            ].join(',')}
            style={{
              left: display.x,
              top: display.y,
              width: display.width,
              height: display.height,
            }}
          >
            <span className="redaction-proposal-label">Pending</span>
            {active && selected ? (
              <span
                className="redaction-resize-handle"
                data-redaction-resize="true"
              />
            ) : null}
          </div>
        );
      })}
      {draft && !draft.id && isRedactionBox(draft.box) ? (
        <div
          className="redaction-proposal redaction-proposal--draft"
          style={(() => {
            const display = projectRedactionBox(draft.box, viewport);
            return {
              left: display.x,
              top: display.y,
              width: display.width,
              height: display.height,
            };
          })()}
        />
      ) : null}
    </div>
  );
}
