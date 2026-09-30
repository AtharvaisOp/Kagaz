import {
  pdfOrientedBoxToViewportQuad,
  type CoordinateViewport,
  type ViewportQuad,
} from '../../pdf-annotations/geometry/coordinateTransforms';
import { initialFormValue } from '../../pdf-forms/model/formValues';
import type {
  FormFieldDefinition,
  FormValue,
  FormWidgetDefinition,
} from '../../pdf-forms/model/types';

export interface ThumbnailFormCommand {
  readonly quad: ViewportQuad;
  readonly kind: 'text' | 'checkbox' | 'radio';
  readonly text: string;
  readonly checked: boolean;
  readonly multiline: boolean;
  readonly fontSize: number;
}

/** Committed values only. No native controls, form drafts, or password strings. */
export function projectThumbnailForms(
  widgets: readonly FormWidgetDefinition[],
  getField: (id: string) => FormFieldDefinition | undefined,
  getValue: (id: string) => FormValue | undefined,
  viewport: CoordinateViewport,
): readonly ThumbnailFormCommand[] {
  return widgets.flatMap<ThumbnailFormCommand>((widget) => {
    const field = getField(widget.fieldId);
    if (
      !field ||
      field.sourceDocumentId !== widget.sourceDocumentId ||
      ![
        'text',
        'multiline-text',
        'checkbox',
        'radio',
        'dropdown',
        'option-list',
      ].includes(field.kind)
    )
      return [];
    const committed = getValue(field.id);
    const value = committed === undefined ? initialFormValue(field) : committed;
    const selected: readonly string[] = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? [value]
        : [];
    const text =
      field.kind === 'dropdown' || field.kind === 'option-list'
        ? selected
            .map(
              (item) =>
                field.options.find((option) => option.exportValue === item)
                  ?.displayValue ?? item,
            )
            .join('\n')
        : typeof value === 'string'
          ? value
          : '';
    const quad = pdfOrientedBoxToViewportQuad(widget.geometry, viewport);
    const width = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
    return [
      {
        quad,
        kind:
          field.kind === 'checkbox' || field.kind === 'radio'
            ? field.kind
            : 'text',
        checked:
          field.kind === 'radio'
            ? value !== null && value === widget.widgetValue
            : value === true,
        text,
        multiline:
          field.kind === 'multiline-text' || field.kind === 'option-list',
        fontSize: (12 * width) / widget.geometry.width,
      },
    ];
  });
}

export function drawThumbnailForms(
  context: CanvasRenderingContext2D,
  commands: readonly ThumbnailFormCommand[],
  pixelRatio = 1,
): void {
  context.save();
  context.scale(pixelRatio, pixelRatio);
  for (const command of commands) {
    const [bottomLeft, , topRight, topLeft] = command.quad;
    const width = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
    const height = Math.hypot(
      bottomLeft.x - topLeft.x,
      bottomLeft.y - topLeft.y,
    );
    context.save();
    context.translate(topLeft.x, topLeft.y);
    context.rotate(Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x));
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = '#555555';
    context.lineWidth = 0.5;
    context.strokeRect(0, 0, width, height);
    context.fillStyle = '#18181b';
    if (command.kind === 'radio' && command.checked) {
      context.beginPath();
      context.arc(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.28,
        0,
        Math.PI * 2,
      );
      context.fill();
    } else if (command.kind === 'checkbox' && command.checked) {
      context.beginPath();
      context.moveTo(width * 0.2, height * 0.5);
      context.lineTo(width * 0.42, height * 0.75);
      context.lineTo(width * 0.82, height * 0.2);
      context.lineWidth = Math.max(0.6, Math.min(width, height) * 0.1);
      context.stroke();
    } else if (command.kind === 'text') {
      const fontSize = Math.min(command.fontSize, height * 0.7);
      context.font = `${fontSize}px Helvetica, Arial, sans-serif`;
      context.textBaseline = 'top';
      const padding = Math.min(1, width * 0.04);
      let line = '',
        y = padding;
      // Stop as soon as the visible rectangle is full, even for huge values.
      for (const character of command.text) {
        if (character === '\r') continue;
        if (
          character === '\n' ||
          context.measureText(line + character).width > width - padding * 2
        ) {
          context.fillText(line, padding, y);
          if (!command.multiline) {
            line = '';
            break;
          }
          y += fontSize * 1.15;
          if (y >= height) break;
          line = '';
          if (character === '\n') continue;
        }
        line += character;
      }
      if (y < height) context.fillText(line, padding, y);
    }
    context.restore();
  }
  context.restore();
}
