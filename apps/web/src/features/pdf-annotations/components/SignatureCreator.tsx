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
  }, [activeStroke, strokes]);

  useEffect(() => {
    drawTypedText(typeCanvasRef.current, typedValue);
  }, [typedValue]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const acceptDraw = async () => {
    const blob = await canvasBlob(drawCanvasRef.current);
    if (strokes.length === 0 || !blob) return;
    await onCreate(blob, 'draw');
  };

  const acceptType = async () => {
    if (!typedValue.trim()) return;
    const blob = await canvasBlob(typeCanvasRef.current);
    if (!blob) return;
    await onCreate(blob, 'type');
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
        className="signature-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signature-dialog-title"
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
            ×
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
              aria-selected={method === item}
              className="annotation-tool-button"
              onClick={() => setMethod(item)}
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
                disabled={strokes.length === 0}
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
              disabled={strokes.length === 0}
              onClick={() => void acceptDraw()}
            >
              Use signature
            </button>
          ) : null}
          {method === 'type' ? (
            <button
              type="button"
              className="primary-button"
              disabled={!typedValue.trim()}
              onClick={() => void acceptType()}
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
