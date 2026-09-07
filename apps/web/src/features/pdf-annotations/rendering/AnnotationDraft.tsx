import { Ellipse, Line, Rect } from 'react-konva';

import { colorToRgba, flattenViewportPoints } from './annotationProjection';
import {
  normalizeViewportRect,
  type CreationDraft,
} from './annotationCreation';
import { pdfUserLengthToViewportPixels } from '../geometry/coordinateTransforms';
import type { AnnotationStyleDefaults } from '../model/editorTypes';

interface AnnotationDraftProps {
  readonly draft: CreationDraft;
  readonly styles: AnnotationStyleDefaults;
}

export function AnnotationDraft({ draft, styles }: AnnotationDraftProps) {
  const fill = colorToRgba(styles.fillColor, styles.opacity);
  const stroke = colorToRgba(styles.strokeColor, styles.opacity);
  const strokeWidth = pdfUserLengthToViewportPixels(
    styles.strokeWidth,
    draft.viewport,
  );
  if (draft.tool === 'line') {
    return (
      <Line
        points={[
          draft.start.x,
          draft.start.y,
          draft.current.x,
          draft.current.y,
        ]}
        stroke={stroke}
        strokeWidth={strokeWidth}
        lineCap="round"
        listening={false}
      />
    );
  }
  if (draft.tool === 'freehand') {
    return (
      <Line
        points={flattenViewportPoints(draft.points)}
        stroke={stroke}
        strokeWidth={strokeWidth}
        lineCap="round"
        lineJoin="round"
        tension={0.15}
        listening={false}
      />
    );
  }
  const rect = normalizeViewportRect(draft.start, draft.current);
  if (draft.tool === 'ellipse') {
    return (
      <Ellipse
        x={rect.x + rect.width / 2}
        y={rect.y + rect.height / 2}
        radiusX={rect.width / 2}
        radiusY={rect.height / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        listening={false}
      />
    );
  }
  return (
    <Rect
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      fill={fill}
      stroke={
        draft.tool === 'rectangle' ||
        draft.tool === 'text' ||
        draft.tool === 'image'
          ? stroke
          : undefined
      }
      dash={
        draft.tool === 'text' || draft.tool === 'image' ? [6, 4] : undefined
      }
      strokeWidth={strokeWidth}
      listening={false}
    />
  );
}
