import { describe, expect, it } from 'vitest';

import { applyAnnotationStyleDefaults } from './annotationStyle';
import { DEFAULT_ANNOTATION_STYLE } from './editorTypes';
import type { PdfAnnotation, RgbColor } from './types';

const black: RgbColor = { r: 0, g: 0, b: 0 };
const blue: RgbColor = { r: 0, g: 0, b: 1 };
const green: RgbColor = { r: 0, g: 1, b: 0 };
const red: RgbColor = { r: 1, g: 0, b: 0 };
const defaults = {
  ...DEFAULT_ANNOTATION_STYLE,
  strokeColor: red,
  fillColor: green,
  strokeWidth: 2,
  opacity: 0.6,
};
const box = {
  origin: { x: 10, y: 20 },
  width: 100,
  height: 50,
  rotation: 0 as const,
};

function stroke(color = black, widthUserUnits = 8, opacity = 0.9) {
  return { color, widthUserUnits, opacity };
}

describe('patch-local vector annotation styles', () => {
  it('changes highlight opacity without changing its color', () => {
    const annotation: PdfAnnotation = {
      id: 'highlight',
      workspacePageId: 'page-1',
      kind: 'highlight',
      box,
      fill: { color: blue, opacity: 0.2 },
    };
    expect(
      applyAnnotationStyleDefaults(annotation, defaults, { opacity: 0.6 }),
    ).toMatchObject({ fill: { color: blue, opacity: 0.6 } });
  });

  it('changes rectangle opacity without changing stroke color or width', () => {
    const annotation: PdfAnnotation = {
      id: 'rectangle-opacity',
      workspacePageId: 'page-1',
      kind: 'rectangle',
      box,
      stroke: stroke(),
      fill: { color: blue, opacity: 0.1 },
    };
    expect(
      applyAnnotationStyleDefaults(annotation, defaults, { opacity: 0.6 }),
    ).toMatchObject({
      stroke: { color: black, widthUserUnits: 8, opacity: 0.6 },
      fill: { color: blue, opacity: 0.25 },
    });
  });

  it('changes rectangle width without changing color or fill', () => {
    const annotation: PdfAnnotation = {
      id: 'rectangle-width',
      workspacePageId: 'page-1',
      kind: 'rectangle',
      box,
      stroke: stroke(black, 8, 0.7),
      fill: { color: blue, opacity: 0.15 },
    };
    expect(
      applyAnnotationStyleDefaults(annotation, defaults, { strokeWidth: 2 }),
    ).toMatchObject({
      stroke: { color: black, widthUserUnits: 2, opacity: 0.7 },
      fill: { color: blue, opacity: 0.15 },
    });
  });

  it('changes ellipse color without changing width or opacity', () => {
    const annotation: PdfAnnotation = {
      id: 'ellipse',
      workspacePageId: 'page-1',
      kind: 'ellipse',
      box,
      stroke: stroke(black, 8, 0.7),
      fill: null,
    };
    expect(
      applyAnnotationStyleDefaults(annotation, defaults, { strokeColor: red }),
    ).toMatchObject({
      stroke: { color: red, widthUserUnits: 8, opacity: 0.7 },
      fill: null,
    });
  });

  it('changes line opacity without changing its black wide stroke', () => {
    const annotation: PdfAnnotation = {
      id: 'line-opacity',
      workspacePageId: 'page-1',
      kind: 'line',
      start: { x: 10, y: 10 },
      end: { x: 50, y: 50 },
      stroke: stroke(),
    };
    expect(
      applyAnnotationStyleDefaults(annotation, defaults, { opacity: 0.6 }),
    ).toMatchObject({
      stroke: { color: black, widthUserUnits: 8, opacity: 0.6 },
    });
  });

  it('changes line color without changing width or opacity', () => {
    const annotation: PdfAnnotation = {
      id: 'line-color',
      workspacePageId: 'page-1',
      kind: 'line',
      start: { x: 10, y: 10 },
      end: { x: 50, y: 50 },
      stroke: stroke(black, 8, 0.7),
    };
    expect(
      applyAnnotationStyleDefaults(annotation, defaults, { strokeColor: red }),
    ).toMatchObject({
      stroke: { color: red, widthUserUnits: 8, opacity: 0.7 },
    });
  });

  it('changes freehand width without changing color or opacity', () => {
    const annotation: PdfAnnotation = {
      id: 'freehand',
      workspacePageId: 'page-1',
      kind: 'freehand',
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
      stroke: stroke(blue, 8, 0.7),
    };
    expect(
      applyAnnotationStyleDefaults(annotation, defaults, { strokeWidth: 2 }),
    ).toMatchObject({
      stroke: { color: blue, widthUserUnits: 2, opacity: 0.7 },
    });
  });
});
