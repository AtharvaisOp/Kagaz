import type { CSSProperties } from 'react';

import { pdfOrientedBoxToViewportQuad } from '../../pdf-annotations/geometry/coordinateTransforms';
import type {
  CoordinateViewport,
  ViewportQuad,
} from '../../pdf-annotations/geometry/coordinateTransforms';
import type { PageViewport } from 'pdfjs-dist';
import type {
  FormChoiceOption,
  FormFieldDefinition,
  FormFieldInitialValue,
  FormWidgetDefinition,
} from '../model/types';
import { getFormFieldLabel } from './formLabels';

interface FormWidgetLayerProps {
  readonly viewport: PageViewport;
  readonly fields: readonly FormFieldDefinition[];
  readonly widgets: readonly FormWidgetDefinition[];
}

function textValue(value: FormFieldInitialValue): string {
  return value.kind === 'text' ? value.current : '';
}

function selectedValues(value: FormFieldInitialValue): readonly string[] {
  return value.kind === 'choice' ? value.current : [];
}

function selectedValueForControl(
  field: FormFieldDefinition,
): string | readonly string[] {
  const values = selectedValues(field.initialValue);
  return field.kind === 'option-list' && field.multiSelect
    ? values
    : (values[0] ?? '');
}

function optionNodes(options: readonly FormChoiceOption[]) {
  return options.map((option) => (
    <option key={option.exportValue} value={option.exportValue}>
      {option.displayValue}
    </option>
  ));
}

function fieldControl(
  field: FormFieldDefinition,
  widget: FormWidgetDefinition,
  label: string,
) {
  const common = {
    'aria-label': label,
    'aria-required': field.required || undefined,
    'data-form-field-id': field.id,
    'data-form-widget-id': widget.id,
    tabIndex: -1,
    title: `${label} · viewing only`,
  } as const;

  switch (field.kind) {
    case 'text':
    case 'password':
      return (
        <input
          {...common}
          className="form-widget-control"
          type={field.kind === 'password' ? 'password' : 'text'}
          value={textValue(field.initialValue)}
          readOnly
          aria-readonly="true"
          autoComplete="off"
          maxLength={field.maxLength ?? undefined}
        />
      );
    case 'multiline-text':
      return (
        <textarea
          {...common}
          className="form-widget-control form-widget-control--multiline"
          value={textValue(field.initialValue)}
          readOnly
          aria-readonly="true"
          autoComplete="off"
          maxLength={field.maxLength ?? undefined}
        />
      );
    case 'checkbox':
      return (
        <input
          {...common}
          className="form-widget-control form-widget-control--check"
          type="checkbox"
          defaultChecked={
            field.initialValue.kind === 'checkbox' && field.initialValue.current
          }
          disabled
        />
      );
    case 'radio':
      return (
        <input
          {...common}
          className="form-widget-control form-widget-control--check"
          type="radio"
          defaultChecked={
            field.initialValue.kind === 'radio' &&
            field.initialValue.current !== null &&
            field.initialValue.current === widget.widgetValue
          }
          disabled
        />
      );
    case 'dropdown':
    case 'option-list':
      return (
        <select
          {...common}
          className="form-widget-control form-widget-control--choice"
          defaultValue={selectedValueForControl(field)}
          multiple={field.kind === 'option-list' && field.multiSelect}
          disabled
        >
          {optionNodes(field.options)}
        </select>
      );
    case 'signature':
      return (
        <div
          {...common}
          className="form-widget-placeholder"
          aria-label="Signature field"
        >
          <span aria-hidden="true">Signature field</span>
        </div>
      );
    case 'button':
      return (
        <div {...common} className="form-widget-placeholder">
          <span aria-hidden="true">Button field · viewing only</span>
        </div>
      );
    case 'unsupported':
      return (
        <div {...common} className="form-widget-placeholder">
          <span aria-hidden="true">Unsupported field · viewing only</span>
        </div>
      );
  }
}

function projectedFrame(quad: ViewportQuad): CSSProperties {
  const [first, second, , fourth] = quad;
  const width = Math.hypot(second.x - first.x, second.y - first.y);
  const height = Math.hypot(fourth.x - first.x, fourth.y - first.y);
  const opposite = {
    x: second.x + fourth.x - first.x,
    y: second.y + fourth.y - first.y,
  };
  const centerX = (first.x + second.x + fourth.x + opposite.x) / 4;
  const centerY = (first.y + second.y + fourth.y + opposite.y) / 4;
  const angle =
    (Math.atan2(second.y - first.y, second.x - first.x) * 180) / Math.PI;
  return {
    left: `${centerX - width / 2}px`,
    top: `${centerY - height / 2}px`,
    width: `${width}px`,
    height: `${height}px`,
    transform: `rotate(${angle}deg)`,
    transformOrigin: 'center center',
  };
}

export function FormWidgetLayer({
  viewport,
  fields,
  widgets,
}: FormWidgetLayerProps) {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const coordinateViewport: CoordinateViewport = viewport;
  return (
    <div className="form-widget-layer" aria-label="Form fields, viewing only">
      {widgets.map((widget) => {
        const field = fieldsById.get(widget.fieldId);
        if (!field) return null;
        const quad = pdfOrientedBoxToViewportQuad(
          widget.geometry,
          coordinateViewport,
        );
        const label = getFormFieldLabel(field, widget);
        return (
          <div
            key={widget.id}
            className="form-widget-frame"
            style={projectedFrame(quad)}
            data-form-widget-id={widget.id}
          >
            {fieldControl(field, widget, label)}
          </div>
        );
      })}
    </div>
  );
}
