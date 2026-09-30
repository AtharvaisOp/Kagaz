import { useEffect, useRef, useState } from 'react';

import type { SignatureMethod } from '../model/types';

interface SignatureCreatorProps {
  readonly open: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onCreate: (blob: Blob, method: SignatureMethod) => Promise<void>;
  readonly onUpload: (file: File) => Promise<void>;
}

type Point = readonly [number, number];

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 220;
const MAX_TYPED_LENGTH = 80;

function canvasPoint(
  event: React.PointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
): Point {
  const bounds = canvas.getBoundingClientRect();
  return [
    ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * CANVAS_WIDTH,
    ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * CANVAS_HEIGHT,
  ];
}

function drawStrokes(
  canvas: HTMLCanvasElement | null,
  strokes: readonly (readonly Point[])[],
): void {
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.strokeStyle = '#18181b';
  context.lineWidth = 5;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of strokes) {
    const first = stroke[0];
    if (!first) continue;
    context.beginPath();
    context.moveTo(first[0], first[1]);
    for (const point of stroke.slice(1)) context.lineTo(point[0], point[1]);
    context.stroke();
  }
}

function drawTypedText(canvas: HTMLCanvasElement | null, value: string): void {
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.fillStyle = '#18181b';
  context.font = "italic 58px 'Segoe Print', 'Bradley Hand', cursive";
  context.textBaseline = 'middle';
  context.textAlign = 'center';
  context.fillText(value, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
}

function canvasBlob(canvas: HTMLCanvasElement | null): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (!canvas) {
      resolve(null);
      return;
    }
    canvas.toBlob(resolve, 'image/png');
  });
}

export function SignatureCreator({
  open,
  error,
  onClose,
  onCreate,
  onUpload,
}: SignatureCreatorProps) {
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const typeCanvasRef = useRef<HTMLCanvasElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const generationRef = useRef(0);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<SignatureMethod>('draw');
  const [strokes, setStrokes] = useState<readonly (readonly Point[])[]>([]);
  const [activeStroke, setActiveStroke] = useState<readonly Point[] | null>(
    null,
  );
  const [typedValue, setTypedValue] = useState('');

  useEffect(() => {
    drawStrokes(
      drawCanvasRef.current,
      activeStroke ? [...strokes, activeStroke] : strokes,
    );
  }, [activeStroke, strokes, method]);

  useEffect(() => {
    drawTypedText(typeCanvasRef.current, typedValue);
  }, [typedValue, method]);

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'Tab') {
        const items = [
          ...(dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
          ) ?? []),
        ].filter((item) => item.getClientRects().length > 0);
        const first = items[0];
        const last = items[items.length - 1];
        if (
          first &&
          last &&
          (event.shiftKey
            ? document.activeElement === first
            : document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      generationRef.current += 1;
      window.removeEventListener('keydown', handleKeyDown);
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const acceptCanvas = async (kind: 'draw' | 'type') => {
    if (
      busyRef.current ||
      (kind === 'draw' ? strokes.length === 0 : !typedValue.trim())
    )
      return;
    busyRef.current = true;
    setBusy(true);
    const generation = generationRef.current;
    try {
      const blob = await canvasBlob(
        kind === 'draw' ? drawCanvasRef.current : typeCanvasRef.current,
      );
      if (!blob || generation !== generationRef.current) return;
      await onCreate(blob, kind);
    } finally {
      busyRef.current = false;
      if (generation === generationRef.current) setBusy(false);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event, event.currentTarget);
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveStroke([point]);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeStroke) return;
    setActiveStroke([...activeStroke, canvasPoint(event, event.currentTarget)]);
  };

  const finishStroke = () => {
    if (activeStroke && activeStroke.length > 1) {
      setStrokes([...strokes, activeStroke]);
    }
    setActiveStroke(null);
  };

  const displayedStrokes = activeStroke ? [...strokes, activeStroke] : strokes;

  return (
    <div className="signature-dialog-scrim" role="presentation">
      <section
        ref={dialogRef}
        className="signature-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signature-dialog-title"
        aria-busy={busy}
      >
        <div className="signature-dialog-heading">
          <div>
            <p className="signature-dialog-kicker">Visual signature</p>
            <h2 id="signature-dialog-title">Create a signature</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close signature creator"
            onClick={onClose}
          >
            Ã—
          </button>
        </div>
        <p className="signature-dialog-hint">
          This creates a visual mark for this browser session. It is not a
          cryptographic signature.
        </p>
        <div
          className="signature-method-tabs"
          role="tablist"
          aria-label="Signature method"
        >
          {(['draw', 'type', 'upload'] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              disabled={busy}
              aria-selected={method === item}
              tabIndex={method === item ? 0 : -1}
              className="annotation-tool-button"
              onClick={() => setMethod(item)}
              onKeyDown={(event) => {
                const methods = ['draw', 'type', 'upload'] as const;
                const index = methods.indexOf(item);
                const next =
                  event.key === 'ArrowRight'
                    ? (index + 1) % 3
                    : event.key === 'ArrowLeft'
                      ? (index + 2) % 3
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 2
                          : null;
                if (next === null) return;
                event.preventDefault();
                setMethod(methods[next]!);
                const tabs =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  );
                tabs?.item(next).focus();
              }}
            >
              {item.charAt(0).toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
        {method === 'draw' ? (
          <div className="signature-draw-panel">
            <p className="signature-draw-note">
              Draw with a mouse, touch, or stylus. Keyboard drawing is not
              available; Type and Upload are available alternatives.
            </p>
            <canvas
              ref={drawCanvasRef}
              className="signature-pad"
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              aria-label="Signature drawing pad"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
              onPointerLeave={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  finishStroke();
                }
              }}
            />
            <div className="signature-inline-actions">
              <button
                type="button"
                className="text-button"
                onClick={() => setStrokes([])}
              >
                Clear
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy || strokes.length === 0}
                onClick={() => setStrokes(strokes.slice(0, -1))}
              >
                Undo stroke
              </button>
            </div>
          </div>
        ) : null}
        {method === 'type' ? (
          <div className="signature-type-panel">
            <label htmlFor="signature-text">Signature text</label>
            <input
              id="signature-text"
              value={typedValue}
              maxLength={MAX_TYPED_LENGTH}
              autoComplete="off"
              onChange={(event) => setTypedValue(event.target.value)}
              placeholder="Type your name"
            />
            <canvas
              ref={typeCanvasRef}
              className="signature-pad signature-type-preview"
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              aria-label="Typed signature preview"
            />
          </div>
        ) : null}
        {method === 'upload' ? (
          <div className="signature-upload-panel">
            <p>Use a PNG or JPEG image. PNG transparency is preserved.</p>
            <button
              type="button"
              className="primary-button"
              onClick={() => uploadRef.current?.click()}
            >
              Choose image
            </button>
            <input
              ref={uploadRef}
              className="annotation-file-input"
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Choose signature image"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void onUpload(file);
              }}
            />
          </div>
        ) : null}
        {error ? (
          <p className="signature-dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="signature-dialog-actions">
          <button type="button" className="text-button" onClick={onClose}>
            Cancel
          </button>
          {method === 'draw' ? (
            <button
              type="button"
              className="primary-button"
              disabled={busy || strokes.length === 0}
              onClick={() => void acceptCanvas('draw')}
            >
              Use signature
            </button>
          ) : null}
          {method === 'type' ? (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !typedValue.trim()}
              onClick={() => void acceptCanvas('type')}
            >
              Use signature
            </button>
          ) : null}
        </div>
        <canvas
          className="signature-canvas-buffer"
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          aria-hidden="true"
          data-signature-strokes={displayedStrokes.length}
        />
      </section>
    </div>
  );
}
