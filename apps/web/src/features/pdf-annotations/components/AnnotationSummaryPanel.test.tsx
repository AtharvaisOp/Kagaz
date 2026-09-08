import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { PdfAnnotationController } from '../hooks/usePdfAnnotations';
import type { PdfAnnotation } from '../model/types';
import { AnnotationSummary } from './AnnotationSummaryPanel';

function controllerFor(
  annotations: readonly PdfAnnotation[],
): PdfAnnotationController {
  return {
    selection: {
      workspacePageId: 'page-1',
      annotationId: annotations[0]?.id ?? '',
    },
    getAnnotationsForPage: () => annotations,
    assetRegistry: { get: () => null },
    selectAnnotation: vi.fn(),
    commitAnnotation: vi.fn(),
    dispatch: vi.fn(),
    editTextAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
  } as unknown as PdfAnnotationController;
}

describe('semantic annotation panel markup', () => {
  it('exposes native controls without rendering internal annotation ids', () => {
    const text: PdfAnnotation = {
      id: 'internal-secret-id',
      workspacePageId: 'page-1',
      kind: 'text',
      box: {
        origin: { x: 10, y: 20 },
        width: 100,
        height: 50,
        rotation: 0,
      },
      text: 'Quarterly review',
      fontFamily: 'helvetica',
      fontSizeUserUnits: 12,
      lineHeight: 1.2,
      align: 'left',
      color: { r: 0, g: 0, b: 0 },
      opacity: 1,
    };
    const markup = renderToStaticMarkup(
      <AnnotationSummary controller={controllerFor([text])} pageId="page-1" />,
    );

    expect(markup).toContain('<ol');
    expect(markup).toContain('<button');
    expect(markup).toContain('Quarterly review');
    expect(markup).toContain('Move Quarterly review left');
    expect(markup).toContain('increase width of Quarterly review');
    expect(markup).toContain('Move Quarterly review backward');
    expect(markup).toContain('Edit Quarterly review');
    expect(markup).toContain('Delete Quarterly review');
    expect(markup).not.toContain('internal-secret-id');
    expect(markup).not.toContain('role="application"');
  });
});
