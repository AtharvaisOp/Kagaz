import { expect, it } from 'vitest';
import type {
  FormFieldDefinition,
  FormWidgetDefinition,
  FormValue,
} from '../../pdf-forms/model/types';
import type { CoordinateViewport } from '../../pdf-annotations/geometry/coordinateTransforms';
import { projectThumbnailForms } from './thumbnailForms';
const viewport = {
  width: 200,
  height: 100,
  viewBox: [0, 0, 200, 100],
  userUnit: 1,
  rotation: 0,
  transform: [1, 0, 0, -1, 0, 100],
  convertToPdfPoint: (x: number, y: number) => [x, 100 - y],
  convertToViewportPoint: (x: number, y: number) => [x, 100 - y],
} satisfies CoordinateViewport;

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

it('projects committed text/multiline/checkbox/radio/choice values and every repeated widget', () => {
  const cases: [FormFieldDefinition['kind'], FormValue, string, boolean][] = [
    ['text', 'Edited', 'Edited', false],
    ['multiline-text', 'Line 1\nLine 2', 'Line 1\nLine 2', false],
    ['checkbox', true, '', true],
    ['radio', 'a', 'a', true],
    ['dropdown', 'b', 'Beta', false],
    ['option-list', ['a', 'b'], 'Alpha\nBeta', false],
  ];
  for (const [kind, value, text, checked] of cases) {
    const f = field(kind, { kind: 'none', current: null, defaultValue: null });
    const commands = projectThumbnailForms(
      [widget(kind), { ...widget(kind), id: 'repeated' }],
      () => f,
      () => value,
      viewport,
    );
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({
      text,
      checked,
      multiline: kind === 'multiline-text' || kind === 'option-list',
    });
    expect(commands[0]!.quad).toEqual([
      { x: 10, y: 80 },
      { x: 110, y: 80 },
      { x: 110, y: 50 },
      { x: 10, y: 50 },
    ]);
  }
});
it('never reads password/unsupported/signature values or mismatched source instances', () => {
  for (const kind of [
    'password',
    'unsupported',
    'signature',
    'button',
  ] as const) {
    expect(
      projectThumbnailForms(
        [widget(kind)],
        () =>
          field(kind, { kind: 'text', current: 'SECRET', defaultValue: null }),
        () => {
          throw new Error('must not read');
        },
        viewport,
      ),
    ).toEqual([]);
  }
  expect(
    projectThumbnailForms(
      [widget('text')],
      () => ({
        ...field('text', { kind: 'none', current: null, defaultValue: null }),
        sourceDocumentId: 'duplicate',
      }),
      () => 'Wrong source',
      viewport,
    ),
  ).toEqual([]);
});
it('preserves an explicitly cleared radio with a nonempty initial value', () => {
  const f = field('radio', { kind: 'radio', current: 'a', defaultValue: null });
  expect(
    projectThumbnailForms(
      [widget('radio')],
      () => f,
      () => null,
      viewport,
    )[0]!.checked,
  ).toBe(false);
});
it.each([0, 90, 180, 270])(
  'projects page rotation %s directly from canonical geometry at thumbnail scale',
  (rotation) => {
    const scale = 0.2;
    const rad = (rotation * Math.PI) / 180;
    const convert = (x: number, y: number) => [
      scale * (x * Math.cos(rad) - y * Math.sin(rad)),
      scale * (x * Math.sin(rad) + y * Math.cos(rad)),
    ];
    const v = { ...viewport, rotation, convertToViewportPoint: convert };
    const command = projectThumbnailForms(
      [widget('text')],
      () =>
        field('text', {
          kind: 'text',
          current: 'Original',
          defaultValue: null,
        }),
      () => 'New',
      v,
    )[0]!;
    const corners = [
      [10, 20],
      [110, 20],
      [110, 50],
      [10, 50],
    ];
    command.quad.forEach((point, i) => {
      const xy = convert(corners[i]![0]!, corners[i]![1]!);
      expect(point.x).toBeCloseTo(xy[0]!);
      expect(point.y).toBeCloseTo(xy[1]!);
    });
    expect(command.fontSize).toBeCloseTo(2.4);
  },
);
