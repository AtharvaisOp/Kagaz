import type { FormSourceDefinition } from '../model/types';
import {
  getFormExportCapability,
  getFormExportCapabilityMessage,
} from '../model/exportSafety';

interface FormStatusNoticeProps {
  readonly sourceName: string;
  readonly definition: FormSourceDefinition;
}

export function FormStatusNotice({
  sourceName,
  definition,
}: FormStatusNoticeProps) {
  if (definition.status === 'none' || definition.status === 'idle') return null;

  const capability = getFormExportCapability(definition);
  const hasUnsignedSignatureField = definition.fields.some(
    (field) => field.kind === 'signature',
  );
  const message =
    capability === 'safe-acroform'
      ? hasUnsignedSignatureField
        ? 'Unsigned signature fields accept a visual signature. Export flattens visual marks and supported form values.'
        : 'Form fields can be filled here. Exported PDFs flatten filled fields.'
      : capability === 'unsupported-xfa'
        ? 'This PDF uses XFA forms, which Kagaz cannot support yet. Standard AcroForm PDFs are supported.'
        : capability === 'discovering'
          ? 'Checking this PDF for form fields…'
          : (getFormExportCapabilityMessage(capability, definition.error) ??
            'Form discovery could not be completed.');

  return (
    <div
      className={`form-status-notice form-status-notice--${definition.status}`}
      role={definition.status === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className="form-status-notice-source">{sourceName}</span>
      <span>{message}</span>
    </div>
  );
}
