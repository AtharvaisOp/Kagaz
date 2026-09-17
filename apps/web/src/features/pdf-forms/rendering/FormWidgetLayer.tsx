import type {
  ChangeEvent,
  CSSProperties,
  KeyboardEvent,
  ReactNode,
} from 'react';

import { pdfOrientedBoxToViewportQuad } from '../../pdf-annotations/geometry/coordinateTransforms';
import type {
  CoordinateViewport,
  ViewportQuad,
} from '../../pdf-annotations/geometry/coordinateTransforms';
import type { PageViewport } from 'pdfjs-dist';
import type { FormTextEditSession } from '../hooks/usePdfForms';
import type {
  FormChoiceOption,
  FormFieldDefinition,
  FormValue,
  FormWidgetDefinition,
} from '../model/types';
import { getFormFieldLabel } from './formLabels';

interface FormWidgetLayerProps {
  readonly viewport: PageViewport;
  readonly fields: readonly FormFieldDefinition[];
  readonly widgets: readonly FormWidgetDefinition[];
  readonly getValue?: (fieldId: string) => FormValue | undefined;
  readonly textEditSession?: FormTextEditSession | null;
  readonly onBeginTextEdit?: (fieldId: string) => void;
  readonly onUpdateTextDraft?: (fieldId: string, draft: string) => void;
  readonly onCommitTextEdit?: (fieldId: string) => void;
  readonly onCancelTextEdit?: (fieldId: string) => void;
  readonly onSetCheckbox?: (fieldId: string, checked: boolean) => void;
  readonly onSelectRadio?: (fieldId: string, value: string | null) => void;
  readonly onSelectChoice?: (fieldId: string, value: FormValue) => void;
  readonly annotationTool?: string;
}

function editable(field: FormFieldDefinition): boolean {
  return (
    !field.readOnly &&
    [
      'text',
      'multiline-text',
      'checkbox',
      'radio',
      'dropdown',
      'option-list',
    ].includes(field.kind)
  );
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

function optionNodes(
  options: readonly FormChoiceOption[],
  selected: readonly string[],
): ReactNode {
  const known = new Set(options.map((option) => option.exportValue));
  const preserved = selected
    .filter((value) => !known.has(value))
    .map((value) => ({ exportValue: value, displayValue: value }));
  return [...options, ...preserved].map((option) => (
    <option key={option.exportValue} value={option.exportValue}>
      {option.displayValue}
    </option>
  ));
}

function isStringArray(
  value: FormValue | undefined,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === 'string')
  );
}

function selectedOptionValues(options: HTMLOptionsCollection): string[] {
  const values: string[] = [];
  for (let index = 0; index < options.length; index += 1) {
    const option = options.item(index);
    if (option?.selected) values.push(option.value);
  }
  return values;
}

function textHandlers(
  field: FormFieldDefinition,
  onCommit: () => void,
  onCancel: () => void,
) {
  const onKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      event.currentTarget.blur();
    } else if (event.key === 'Enter' && field.kind === 'text') {
      event.preventDefault();
      onCommit();
      event.currentTarget.blur();
    }
  };
  return { onBlur: onCommit, onKeyDown };
}

interface Handlers {
  readonly onBeginTextEdit: (fieldId: string) => void;
  readonly onUpdateTextDraft: (fieldId: string, draft: string) => void;
  readonly onCommitTextEdit: (fieldId: string) => void;
  readonly onCancelTextEdit: (fieldId: string) => void;
  readonly onSetCheckbox: (fieldId: string, checked: boolean) => void;
  readonly onSelectRadio: (fieldId: string, value: string | null) => void;
  readonly onSelectChoice: (fieldId: string, value: FormValue) => void;
}

function fieldControl(
  field: FormFieldDefinition,
  widget: FormWidgetDefinition,
  label: string,
  value: FormValue | undefined,
  session: FormTextEditSession | null,
  handlers: Handlers,
  interactionEnabled: boolean,
) {
  const isEditable = editable(field) && interactionEnabled;
  const textValue =
    session?.fieldId === field.id
      ? session.draft
      : typeof value === 'string'
        ? value
        : '';
  const common = {
    'aria-label': label,
    'aria-required': field.required || undefined,
    'data-form-field-id': field.id,
    'data-form-widget-id': widget.id,
    tabIndex: isEditable ? 0 : -1,
    title: isEditable ? label : `${label} · not editable in Kagaz`,
  } as const;
  if (field.kind === 'text' || field.kind === 'password') {
    const textProps = textHandlers(
      field,
      () => handlers.onCommitTextEdit(field.id),
      () => handlers.onCancelTextEdit(field.id),
    );
    return (
      <input
        {...common}
        className="form-widget-control"
        type={field.kind === 'password' ? 'password' : 'text'}
        value={textValue}
        readOnly={!isEditable || field.kind === 'password'}
        aria-readonly={
          !isEditable || field.kind === 'password' ? 'true' : undefined
        }
        autoComplete="off"
        maxLength={field.maxLength ?? undefined}
        onFocus={() => isEditable && handlers.onBeginTextEdit(field.id)}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          handlers.onUpdateTextDraft(field.id, event.target.value)
        }
        {...textProps}
      />
    );
  }
  if (field.kind === 'multiline-text') {
    const textProps = textHandlers(
      field,
      () => handlers.onCommitTextEdit(field.id),
      () => handlers.onCancelTextEdit(field.id),
    );
    return (
      <textarea
        {...common}
        className="form-widget-control form-widget-control--multiline"
        value={textValue}
        readOnly={!isEditable}
        aria-readonly={!isEditable ? 'true' : undefined}
        autoComplete="off"
        maxLength={field.maxLength ?? undefined}
        onFocus={() => isEditable && handlers.onBeginTextEdit(field.id)}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
          handlers.onUpdateTextDraft(field.id, event.target.value)
        }
        {...textProps}
      />
    );
  }
  if (field.kind === 'checkbox')
    return (
      <input
        {...common}
        className="form-widget-control form-widget-control--check"
        type="checkbox"
        checked={value === true}
        disabled={!isEditable}
        onChange={(event) =>
          handlers.onSetCheckbox(field.id, event.target.checked)
        }
      />
    );
  if (field.kind === 'radio')
    return (
      <input
        {...common}
        className="form-widget-control form-widget-control--check"
        type="radio"
        name={`form-radio-${field.id}`}
        checked={value === widget.widgetValue && widget.widgetValue !== null}
        disabled={!isEditable}
        onChange={() => handlers.onSelectRadio(field.id, widget.widgetValue)}
      />
    );
  if (field.kind === 'dropdown' || field.kind === 'option-list') {
    const multiple = field.kind === 'option-list' && field.multiSelect;
    const selected: readonly string[] = isStringArray(value)
      ? value
      : typeof value === 'string'
        ? [value]
        : [];
    return (
      <select
        {...common}
        className="form-widget-control form-widget-control--choice"
        value={multiple ? selected : (selected[0] ?? '')}
        multiple={multiple}
        disabled={!isEditable}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          multiple
            ? handlers.onSelectChoice(
                field.id,
                selectedOptionValues(event.currentTarget.options),
              )
            : handlers.onSelectChoice(
                field.id,
                event.currentTarget.value || null,
              )
        }
      >
        {optionNodes(field.options, selected)}
      </select>
    );
  }
  const description =
    field.kind === 'signature'
      ? 'Signature field · viewing only'
      : field.kind === 'button'
        ? 'Button field · viewing only'
        : 'Unsupported field · viewing only';
  return (
    <div
      {...common}
      className="form-widget-placeholder"
      aria-label={description}
    >
      <span aria-hidden="true">{description}</span>
    </div>
  );
}

export function FormWidgetLayer({
  viewport,
  fields,
  widgets,
  getValue = () => undefined,
  textEditSession = null,
  onBeginTextEdit = () => undefined,
  onUpdateTextDraft = () => undefined,
  onCommitTextEdit = () => undefined,
  onCancelTextEdit = () => undefined,
  onSetCheckbox = () => undefined,
  onSelectRadio = () => undefined,
  onSelectChoice = () => undefined,
  annotationTool = 'select',
}: FormWidgetLayerProps) {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const coordinateViewport: CoordinateViewport = viewport;
  // Select mode gives editable native controls the exact widget rectangle;
  // creation tools leave the layer pass-through so drawing gestures win.
  const formEditingPriority = annotationTool === 'select';
  return (
    <div className="form-widget-layer" aria-label="Form fields">
      {widgets.map((widget) => {
        const field = fieldsById.get(widget.fieldId);
        if (!field) return null;
        const quad = pdfOrientedBoxToViewportQuad(
          widget.geometry,
          coordinateViewport,
        );
        const label = getFormFieldLabel(field, widget);
        const isEditable = editable(field) && formEditingPriority;
        return (
          <div
            key={widget.id}
            className="form-widget-frame"
            data-form-widget-id={widget.id}
            data-form-editable={isEditable ? 'true' : undefined}
            style={projectedFrame(quad)}
          >
            {fieldControl(
              field,
              widget,
              label,
              getValue(field.id),
              textEditSession,
              {
                onBeginTextEdit,
                onUpdateTextDraft,
                onCommitTextEdit,
                onCancelTextEdit,
                onSetCheckbox,
                onSelectRadio,
                onSelectChoice,
              },
              formEditingPriority,
            )}
          </div>
        );
      })}
    </div>
  );
}
