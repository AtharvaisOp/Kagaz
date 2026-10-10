import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PdfWatermarkController } from '../hooks/usePdfWatermarks';
import { createDefaultWatermark } from '../model/watermark';
import { createWatermarkHistory } from '../model/reducer';
import { createAnnotationAssetRegistry } from '../../pdf-annotations/runtime/annotationAssetRegistry';
import { SourceDocumentRegistry } from '../../pdf-workspace/runtime/sourceDocumentRegistry';
import { WatermarkDialog } from './WatermarkDialog';

const pages = [
  {
    id: 'private-page-id',
    sourceDocumentId: 'source',
    sourcePageIndex: 0,
    rotationDelta: 0,
  },
] as const;
function controller(): PdfWatermarkController {
  const config = createDefaultWatermark('private-config-id');
  return {
    state: createWatermarkHistory(),
    draft: config,
    preview: config,
    assetRegistry: createAnnotationAssetRegistry({
      createId: () => 'asset',
      createObjectUrl: () => 'url',
      revokeObjectUrl: vi.fn(),
      decode: () =>
        Promise.resolve({
          width: 1,
          height: 1,
          image: {} as CanvasImageSource,
        }),
    }),
    open: vi.fn(),
    cancel: vi.fn(),
    updateDraft: vi.fn(),
    chooseImage: vi.fn(() => Promise.resolve()),
    applyDraft: vi.fn(() => Promise.resolve(true)),
    remove: vi.fn(),
    reset: vi.fn(),
    busy: false,
    error: null,
    announcement: null,
    hasUnsavedWork: true,
    historyParticipant: {
      canUndo: false,
      canRedo: false,
      undo: () => false,
      redo: () => false,
      discardFuture: vi.fn(),
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
function markup(active: PdfWatermarkController) {
  vi.stubGlobal('window', { innerWidth: 360 });
  return renderToStaticMarkup(
    <WatermarkDialog
      controller={active}
      pages={pages}
      currentPageId={pages[0].id}
      registry={new SourceDocumentRegistry()}
      onClose={vi.fn()}
    />,
  );
}
describe('watermark semantic management', () => {
  it('offers labelled text controls, keyboard page scope, truthful local-processing copy and Apply/Cancel', () => {
    const html = markup(controller());
    for (const label of [
      'Watermark text',
      'Watermark font size',
      'Watermark text color',
      'Watermark opacity',
      'Watermark size',
      'Watermark rotation',
      'Watermark position',
      'Watermark page scope',
      'Watermark preview page',
    ])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('aria-labelledby="watermark-title"');
    expect(html).toContain('All pages, including later additions');
    expect(html).toContain('Current page');
    expect(html).toContain('Selected pages');
    expect(html).toContain('Page ranges');
    expect(html).toContain(
      'Watermarks do not remove information or prevent copying',
    );
    expect(html).toContain('Apply watermark');
    expect(html).toContain('Cancel');
    expect(html).not.toContain('private-config-id');
  });
  it('offers an accessible file chooser, custom numeric coordinates, selected-page checkbox and removal', () => {
    const active = controller();
    const image = {
      ...active.draft!,
      kind: 'image' as const,
      assetId: '',
      position: 'custom' as const,
      target: { kind: 'pages' as const, pageIds: [pages[0].id] },
    };
    const html = markup({
      ...active,
      draft: image,
      state: { ...active.state, present: image },
    });
    expect(html).toContain('aria-label="Choose watermark image"');
    expect(html).toContain('accept="image/png,image/jpeg"');
    expect(html).toContain('aria-label="Watermark custom X"');
    expect(html).toContain('aria-label="Watermark custom Y"');
    expect(html).toContain('Y from bottom');
    expect(html).toContain('aria-label="Watermark page 1"');
    expect(html).toContain('Remove watermark');
  });
  it('announces safe errors and disables Apply for invalid targets or an active read', () => {
    const active = controller();
    const html = markup({
      ...active,
      busy: true,
      error: 'This image cannot be decoded safely.',
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('This image cannot be decoded safely.');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Preparing');
  });
});
