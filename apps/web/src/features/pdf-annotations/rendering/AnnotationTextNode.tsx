import { useEffect, useMemo, useState } from 'react';
import type Konva from 'konva';
import { Image, Text } from 'react-konva';
import type { TextAnnotation } from '../model/types';
import { watermarkPreviewJobs } from '../../pdf-watermarks/runtime/previewJobQueue';

/** Keeps the transformable box stable while its local PDF appearance is replaced. */
export function AnnotationTextNode({
  annotation,
  width,
  height,
  common,
  nodeRef,
}: {
  readonly annotation: TextAnnotation;
  readonly width: number;
  readonly height: number;
  readonly common: Record<string, unknown>;
  readonly nodeRef: (node: Konva.Node | null) => void;
}) {
  const appearance = useMemo<TextAnnotation>(
    () => ({
      id: annotation.id,
      workspacePageId: annotation.workspacePageId,
      kind: 'text',
      text: annotation.text,
      fontFamily: annotation.fontFamily,
      fontSizeUserUnits: annotation.fontSizeUserUnits,
      lineHeight: annotation.lineHeight,
      align: annotation.align,
      color: {
        r: annotation.color.r,
        g: annotation.color.g,
        b: annotation.color.b,
      },
      opacity: annotation.opacity,
      box: {
        origin: { x: 0, y: 0 },
        width: annotation.box.width,
        height: annotation.box.height,
        rotation: 0,
      },
    }),
    [
      annotation.id,
      annotation.workspacePageId,
      annotation.text,
      annotation.fontFamily,
      annotation.fontSizeUserUnits,
      annotation.lineHeight,
      annotation.align,
      annotation.color.r,
      annotation.color.g,
      annotation.color.b,
      annotation.opacity,
      annotation.box.width,
      annotation.box.height,
    ],
  );
  const key = JSON.stringify([appearance, width, height]);
  const [state, setState] = useState<{
    key: string;
    canvas: HTMLCanvasElement | null;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    const cancellation = new AbortController();
    let ownedCanvas: HTMLCanvasElement | null = null;
    const timer = window.setTimeout(() => {
      void watermarkPreviewJobs
        .run(cancellation.signal, async () => {
          const { renderTextPreviewRaster } =
            await import('./textPreviewRaster');
          if (cancellation.signal.aborted) return;
          ownedCanvas = await renderTextPreviewRaster(
            appearance,
            width,
            height,
            cancellation.signal,
          );
          if (cancellation.signal.aborted) {
            ownedCanvas.width = 0;
            ownedCanvas.height = 0;
          } else setState({ key, canvas: ownedCanvas, error: false });
        })
        .catch(() => {
          if (!cancellation.signal.aborted)
            setState({ key, canvas: null, error: true });
        });
    }, 90);
    return () => {
      cancellation.abort();
      window.clearTimeout(timer);
      if (ownedCanvas) {
        ownedCanvas.width = 0;
        ownedCanvas.height = 0;
      }
    };
  }, [appearance, height, key, width]);
  if (state?.key === key && state.error)
    return (
      <Text
        ref={nodeRef}
        {...common}
        text="Text unavailable · resize the box or choose a supported font"
        fill="#991b1b"
        fontSize={12}
      />
    );
  return (
    <Image
      ref={nodeRef}
      {...common}
      image={state?.key === key ? (state.canvas ?? undefined) : undefined}
    />
  );
}
