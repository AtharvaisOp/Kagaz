import type { FormSourceDefinition } from '../model/types';

interface FormStatusNoticeProps {
  readonly sourceName: string;
  readonly definition: FormSourceDefinition;
}

export function FormStatusNotice({
  sourceName,
  definition,
}: FormStatusNoticeProps) {
  if (definition.status === 'none' || definition.status === 'idle') return null;

  const message =
    definition.status === 'acroform'
      ? 'Form fields can be filled here. Form-safe Download and Extract are still being added.'
      : definition.status === 'unsupported-xfa'
        ? 'This PDF uses XFA forms, which Kagaz cannot support yet. Standard AcroForm PDFs are supported.'
        : definition.status === 'discovering'
          ? 'Checking this PDF for form fields…'
          : (definition.error ?? 'Form discovery could not be completed.');

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
