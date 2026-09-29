import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FormWidgetLayer } from './FormWidgetLayer';
import type { FormFieldDefinition, FormWidgetDefinition } from '../model/types';
import type { PageViewport } from 'pdfjs-dist';

const viewport = {
  width: 200,
  height: 100,
  viewBox: [0, 0, 200, 100],
  userUnit: 1,
  rotation: 0,
  transform: [1, 0, 0, -1, 0, 100],
  convertToPdfPoint: (x: number, y: number) => [x, 100 - y],
  convertToViewportPoint: (x: number, y: number) => [x, 100 - y],
} as unknown as PageViewport;

function field(
  kind: FormFieldDefinition['kind'],
  initialValue: FormFieldDefinition['initialValue'],
): FormFieldDefinition {
  return {
    id: `field-${kind}`,
    sourceDocumentId: 'source',
    name: `profile.${kind}`,
    fieldType: null,
    kind,
    initialValue,
    readOnly: false,
    required: true,
    alternativeText: null,
    options: [
      { exportValue: 'a', displayValue: 'Alpha' },
      { exportValue: 'b', displayValue: 'Beta' },
    ],
    multiSelect: kind === 'option-list',
    maxLength: null,
    widgetIds: [`widget-${kind}`],
    metadataWarnings: [],
  };
}

function widget(kind: string): FormWidgetDefinition {
  return {
    id: `widget-${kind}`,
    fieldId: `field-${kind}`,
    sourceDocumentId: 'source',
    sourcePageIndex: 0,
    pdfAnnotationId: `annotation-${kind}`,
    rawRect: [10, 20, 110, 50],
    geometry: {
      origin: { x: 10, y: 20 },
      width: 100,
      height: 30,
      rotation: 0,
    },
    rotation: 0,
    widgetValue: kind === 'radio' ? 'a' : null,
    alternativeText: null,
  };
}

describe('FormWidgetLayer', () => {
  it('renders editable native controls and an accessible visual-signature action', () => {
    const fields = [
      field('text', { kind: 'text', current: 'Ada', defaultValue: null }),
      field('multiline-text', {
        kind: 'text',
        current: 'Line one',
        defaultValue: null,
      }),
      field('password', {
        kind: 'text',
        current: 'secret',
        defaultValue: null,
      }),
      field('checkbox', {
        kind: 'checkbox',
        current: true,
        defaultValue: null,
      }),
      field('radio', { kind: 'radio', current: 'a', defaultValue: null }),
      field('dropdown', { kind: 'choice', current: ['a'], defaultValue: [] }),
      field('option-list', {
        kind: 'choice',
        current: ['a', 'b'],
        defaultValue: [],
      }),
      field('signature', { kind: 'none', current: null, defaultValue: null }),
    ];
    const widgets = fields.map((entry) => widget(entry.kind));
    const markup = renderToStaticMarkup(
      <FormWidgetLayer
        viewport={viewport}
        fields={fields}
        widgets={widgets}
        onPlaceVisualSignature={() => undefined}
      />,
    );
    expect(markup).toContain('type="password"');
    expect(markup).toContain('<textarea');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('type="radio"');
    expect(markup).toContain('<select');
    expect(markup).toContain('multiple=""');
    expect(markup).toContain('Place visual signature');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('data-form-editable="true"');
    expect(markup).toContain('not editable in Kagaz');
  });

  it('hides the action after placement and restores pass-through semantics', () => {
    const signature = field('signature', {
      kind: 'none',
      current: null,
      defaultValue: null,
    });
    const signatureWidget = widget('signature');
    const markup = renderToStaticMarkup(
      <FormWidgetLayer
        viewport={viewport}
        fields={[signature]}
        widgets={[signatureWidget]}
        onPlaceVisualSignature={() => undefined}
        targetedSignatureWidgetIds={new Set([signatureWidget.id])}
      />,
    );
    expect(markup).toContain('Visual signature placed');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('data-form-editable="true"');
  });
});
