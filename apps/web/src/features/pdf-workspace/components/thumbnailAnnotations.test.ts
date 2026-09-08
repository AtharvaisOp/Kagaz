import { describe, expect, it } from 'vitest';

import type { AnnotationViewport } from '../../pdf-annotations/rendering/annotationProjection';
import type { PdfAnnotation } from '../../pdf-annotations/model/types';
import { projectThumbnailAnnotations } from './thumbnailAnnotations';

const viewport: AnnotationViewport = {
  width: 100,
  height: 100,
  viewBox: [0, 0, 100, 100],
  userUnit: 1,
  rotation: 0,
  transform: [1, 0, 0, 1, 0, 0],
  convertToPdfPoint: (x, y) => [x, 100 - y],
  convertToViewportPoint: (x, y) => [x, 100 - y],
};

const box = {
  origin: { x: 10, y: 20 },
  width: 30,
  height: 20,
  rotation: 0 as const,
};

const annotations: PdfAnnotation[] = [
  {
    id: 'highlight',
    workspacePageId: 'page-1',
    kind: 'highlight',
    box,
    fill: { color: { r: 1, g: 0.8, b: 0 }, opacity: 0.4 },
  },
  {
    id: 'rectangle',
    workspacePageId: 'page-1',
    kind: 'rectangle',
    box,
    stroke: {
      color: { r: 0, g: 1, b: 0 },
      widthUserUnits: 2,
      opacity: 0.8,
    },
    fill: null,
  },
  {
    id: 'ellipse',
    workspacePageId: 'page-1',
    kind: 'ellipse',
    box,
    stroke: null,
    fill: { color: { r: 0, g: 0, b: 1 }, opacity: 0.25 },
  },
  {
    id: 'line',
    workspacePageId: 'page-1',
    kind: 'line',
    start: { x: 1, y: 2 },
    end: { x: 20, y: 30 },
    stroke: {
      color: { r: 1, g: 0, b: 0 },
      widthUserUnits: 1,
      opacity: 1,
    },
  },
  {
    id: 'freehand',
    workspacePageId: 'page-1',
    kind: 'freehand',
    points: [
      { x: 1, y: 2 },
      { x: 4, y: 5 },
    ],
    stroke: {
      color: { r: 1, g: 0, b: 1 },
      widthUserUnits: 3,
      opacity: 0.7,
    },
  },
  {
    id: 'text',
    workspacePageId: 'page-1',
    kind: 'text',
    box,
    text: 'Hello',
    fontFamily: 'helvetica',
    fontSizeUserUnits: 12,
    lineHeight: 1.2,
    align: 'left',
    color: { r: 0, g: 0, b: 0 },
    opacity: 1,
  },
  {
    id: 'image',
    workspacePageId: 'page-1',
    kind: 'image',
    box,
    assetId: 'asset-1',
    opacity: 0.9,
  },
];

describe('thumbnail annotation projection', () => {
  it('projects every annotation kind in source array order', () => {
    const commands = projectThumbnailAnnotations(annotations, viewport);

    expect(commands.map((command) => command.kind)).toEqual([
      'box',
      'box',
      'ellipse',
      'line',
      'freehand',
      'text',
      'image',
    ]);
    expect(commands[0]?.kind === 'box' && commands[0].points[0]).toEqual({
      x: 10,
      y: 80,
    });
    expect(commands[6]?.kind === 'image' && commands[6].image).toBeNull();
  });

  it('uses the canonical viewport conversion for rotated boxes and image assets', () => {
    const rotated: PdfAnnotation = {
      id: 'rotated',
      workspacePageId: 'page-1',
      kind: 'highlight',
      box: { ...box, rotation: 90 as const },
      fill: { color: { r: 1, g: 0.8, b: 0 }, opacity: 0.4 },
    };
    const image = annotations[6];
    if (!image || image.kind !== 'image')
      throw new Error('image fixture missing');
    const asset = { image: {} as CanvasImageSource };
    const commands = projectThumbnailAnnotations([rotated, image], viewport, {
      get: (assetId) => (assetId === 'asset-1' ? (asset as never) : null),
    });

    expect(commands[0]?.kind).toBe('box');
    expect(commands[1]?.kind).toBe('image');
    expect(commands[1]?.kind === 'image' && commands[1].image).toBe(
      asset.image,
    );
  });

  it('preserves orientation metadata and projected text sizing without a minimum clamp', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const rotated: PdfAnnotation = {
        id: `rotated-${rotation}`,
        workspacePageId: 'page-1',
        kind: 'text',
        box: { ...box, rotation },
        text: '  Hello  world\n\nlongunbrokentoken',
        fontFamily: 'helvetica',
        fontSizeUserUnits: 12,
        lineHeight: 1.2,
        align: rotation === 90 ? 'center' : rotation === 180 ? 'right' : 'left',
        color: { r: 0, g: 0, b: 0 },
        opacity: 1,
      };
      const commands = projectThumbnailAnnotations([rotated], {
        ...viewport,
        rotation,
        userUnit: 2,
        viewBox: [10, -20, 110, 80],
      });
      const command = commands[0];
      expect(command?.kind).toBe('text');
      if (command?.kind !== 'text') continue;
      expect(command.fontSize).toBe(12);
      expect(command.text).toContain('  Hello  world');
      expect(command.align).toBe(rotated.align);
      expect(command.points.every((point) => Number.isFinite(point.x))).toBe(
        true,
      );
    }
  });
});
