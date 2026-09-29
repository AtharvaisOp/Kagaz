import type {
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFOptionList,
  PDFFont,
  PDFForm,
  PDFRef,
  PDFSignature,
} from 'pdf-lib';
import type * as PdfLibModule from 'pdf-lib';

import {
  FormExportError,
  type FormExportFieldSnapshot,
  type FormExportSourceSnapshot,
} from './types';

type PdfLibRuntime = Pick<
  typeof PdfLibModule,
  | 'PDFCheckBox'
  | 'PDFButton'
  | 'PDFDropdown'
  | 'PDFOptionList'
  | 'PDFDict'
  | 'PDFName'
  | 'PDFNull'
  | 'PDFRadioGroup'
  | 'PDFRef'
  | 'PDFSignature'
  | 'PDFTextField'
  | 'StandardFonts'
>;

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

interface WidgetAnnotationRef {
  readonly page: ReturnType<PDFDocument['getPages']>[number];
  readonly ref: PDFRef;
}

function collectWidgetAnnotationRefs(
  document: PDFDocument,
  pdfLib: PdfLibRuntime,
): readonly WidgetAnnotationRef[] {
  const widgetRefs: WidgetAnnotationRef[] = [];
  const subtypeKey = pdfLib.PDFName.of('Subtype');

  for (const page of document.getPages()) {
    const annotations = page.node.Annots();
    if (!annotations) continue;

    for (let index = 0; index < annotations.size(); index += 1) {
      const ref = annotations.get(index);
      if (!(ref instanceof pdfLib.PDFRef)) continue;
      const annotation = document.context.lookupMaybe(ref, pdfLib.PDFDict);
      const subtype = annotation?.lookupMaybe(subtypeKey, pdfLib.PDFName);
      if (subtype?.toString() === '/Widget') {
        widgetRefs.push({ page, ref });
      }
    }
  }

  return widgetRefs;
}

interface ValidatedField {
  readonly snapshot: FormExportFieldSnapshot;
  readonly field: PDFField;
  readonly choiceDisplayValues: readonly string[];
}

function validateActualFieldInventory(
  form: PDFForm,
  snapshot: FormExportSourceSnapshot,
  pdfLib: PdfLibRuntime,
  fileName: string,
): readonly PDFSignature[] {
  const snapshotNames = new Set(snapshot.fields.map((field) => field.name));
  const unsignedSignatures: PDFSignature[] = [];
  for (const field of form.getFields()) {
    if (field instanceof pdfLib.PDFSignature) {
      let value: ReturnType<PDFSignature['acroField']['V']>;
      try {
        value = field.acroField.V();
      } catch {
        throw formError(
          'existing-digital-signature',
          'This PDF contains a digital-signature value that Kagaz cannot safely inspect. Kagaz does not modify digitally signed PDFs.',
          fileName,
        );
      }
      if (value !== undefined && value !== pdfLib.PDFNull) {
        throw formError(
          'existing-digital-signature',
          'This PDF already contains a digital signature. Kagaz does not modify digitally signed PDFs because changes can invalidate that signature.',
          fileName,
        );
      }
      unsignedSignatures.push(field);
      continue;
    }
    if (field instanceof pdfLib.PDFButton) {
      throw formError(
        'unsupported-source',
        'This PDF contains a push button. Button actions cannot be safely flattened for export.',
        fileName,
      );
    }
    if (field instanceof pdfLib.PDFTextField && field.isPassword()) {
      throw formError(
        'unsupported-source',
        'This PDF contains a password field, so Kagaz cannot safely flatten it for export yet.',
        fileName,
      );
    }
    if (
      !(field instanceof pdfLib.PDFTextField) &&
      !(field instanceof pdfLib.PDFCheckBox) &&
      !(field instanceof pdfLib.PDFRadioGroup) &&
      !(field instanceof pdfLib.PDFDropdown) &&
      !(field instanceof pdfLib.PDFOptionList)
    ) {
      throw formError(
        'unsupported-source',
        'This PDF contains a form field that Kagaz cannot safely flatten yet.',
        fileName,
      );
    }
    if (!snapshotNames.has(field.getName())) {
      throw formError(
        'missing-field',
        'Form safety information is missing for a field in the source PDF.',
        fileName,
      );
    }
  }
  return unsignedSignatures;
}

/**
 * pdf-lib 1.17.1 removeField() requires an appearance ref even for unsigned
 * signature widgets. Supply a temporary empty appearance so the public field
 * removal path can clean the field tree; stale page /Annots refs are removed
 * by the shared cleanup captured before this call.
 */
function removeUnsignedSignatureFields(
  document: PDFDocument,
  form: PDFForm,
  fields: readonly PDFSignature[],
  fileName: string,
): void {
  const temporaryAppearances: PDFRef[] = [];
  try {
    for (const field of fields) {
      for (const widget of field.acroField.getWidgets()) {
        const { width, height } = widget.getRectangle();
        const appearance = document.context.formXObject([], {
          BBox: document.context.obj([0, 0, width, height]),
        });
        const appearanceRef = document.context.register(appearance);
        temporaryAppearances.push(appearanceRef);
        widget.setNormalAppearance(appearanceRef);
      }
      form.removeField(field);
    }
  } catch {
    throw formError(
      'signature-field-removal-failed',
      'Kagaz could not safely remove an unsigned signature field for export.',
      fileName,
    );
  } finally {
    for (const ref of temporaryAppearances) document.context.delete(ref);
  }
}

function formError(
  code: ConstructorParameters<typeof FormExportError>[0],
  message: string,
  fileName: string,
): FormExportError {
  return new FormExportError(code, message, fileName);
}

function assertStringValue(
  snapshot: FormExportFieldSnapshot,
  fileName: string,
): string {
  if (typeof snapshot.value !== 'string') {
    throw formError(
      'invalid-value',
      'A text form value has an unexpected type.',
      fileName,
    );
  }
  return snapshot.value;
}

function validateFieldType(
  snapshot: FormExportFieldSnapshot,
  field: PDFField,
  pdfLib: PdfLibRuntime,
  fileName: string,
): void {
  const matches = (() => {
    switch (snapshot.kind) {
      case 'text':
        return field instanceof pdfLib.PDFTextField && !field.isMultiline();
      case 'multiline-text':
        return field instanceof pdfLib.PDFTextField && field.isMultiline();
      case 'checkbox':
        return field instanceof pdfLib.PDFCheckBox;
      case 'radio':
        return field instanceof pdfLib.PDFRadioGroup;
      case 'dropdown':
        return field instanceof pdfLib.PDFDropdown;
      case 'option-list':
        return field instanceof pdfLib.PDFOptionList;
    }
  })();

  if (!matches) {
    throw formError(
      'field-type-mismatch',
      'A PDF form field no longer matches the type Kagaz discovered.',
      fileName,
    );
  }
}

function canonicalChoiceValues(
  snapshot: FormExportFieldSnapshot,
  fileName: string,
): readonly string[] {
  if (snapshot.kind === 'dropdown' || !snapshot.multiSelect) {
    if (snapshot.value === null) return [];
    if (typeof snapshot.value !== 'string') {
      throw formError(
        'invalid-value',
        'A single-choice form value has an unexpected type.',
        fileName,
      );
    }
    return [snapshot.value];
  }
  if (!isStringArray(snapshot.value)) {
    throw formError(
      'invalid-value',
      'A multi-select form value has an unexpected type.',
      fileName,
    );
  }
  return snapshot.value.slice();
}

function displayValuesForChoice(
  snapshot: FormExportFieldSnapshot,
  field: PDFDropdown | PDFOptionList,
  fileName: string,
): readonly string[] {
  const selected = canonicalChoiceValues(snapshot, fileName);
  const displayValues = selected.map((value) => {
    const option = snapshot.options.find(
      (candidate) => candidate.exportValue === value,
    );
    if (!option) {
      throw formError(
        'invalid-choice',
        'A selected form option is no longer available in the source PDF.',
        fileName,
      );
    }
    return option.displayValue;
  });
  const pdfLibOptions = field.getOptions();
  if (displayValues.some((value) => !pdfLibOptions.includes(value))) {
    throw formError(
      'invalid-choice',
      'A selected form option does not match the source PDF options.',
      fileName,
    );
  }
  return displayValues;
}

function validateHelvetica(
  font: PDFFont,
  text: string,
  fileName: string,
): void {
  try {
    for (const line of text.split(/\r\n|\r|\n/)) font.encodeText(line);
  } catch {
    throw formError(
      'unsupported-text-font',
      'A filled form value contains characters unsupported by Standard Helvetica.',
      fileName,
    );
  }
}

function validateAppearanceText(
  item: ValidatedField,
  font: PDFFont,
  pdfLib: PdfLibRuntime,
  fileName: string,
): void {
  const { field, snapshot } = item;
  if (snapshot.changed) {
    if (snapshot.kind === 'text' || snapshot.kind === 'multiline-text') {
      validateHelvetica(font, assertStringValue(snapshot, fileName), fileName);
    } else if (snapshot.kind === 'dropdown') {
      for (const value of item.choiceDisplayValues)
        validateHelvetica(font, value, fileName);
    } else if (snapshot.kind === 'option-list') {
      for (const option of snapshot.options)
        validateHelvetica(font, option.displayValue, fileName);
    }
    return;
  }

  if (!field.needsAppearancesUpdate()) return;
  if (field instanceof pdfLib.PDFTextField) {
    validateHelvetica(font, field.getText() ?? '', fileName);
  } else if (field instanceof pdfLib.PDFDropdown) {
    validateHelvetica(font, field.getSelected()[0] ?? '', fileName);
  } else if (field instanceof pdfLib.PDFOptionList) {
    for (const option of field.getOptions())
      validateHelvetica(font, option, fileName);
  }
}

function validateFields(
  form: PDFForm,
  snapshot: FormExportSourceSnapshot,
  font: PDFFont,
  pdfLib: PdfLibRuntime,
  fileName: string,
): readonly ValidatedField[] {
  const validated = snapshot.fields.map((fieldSnapshot) => {
    const field = form.getFieldMaybe(fieldSnapshot.name);
    if (!field) {
      throw formError(
        'missing-field',
        'A form field required for export is missing from the source PDF.',
        fileName,
      );
    }
    validateFieldType(fieldSnapshot, field, pdfLib, fileName);
    const choiceDisplayValues =
      fieldSnapshot.kind === 'dropdown' && field instanceof pdfLib.PDFDropdown
        ? displayValuesForChoice(fieldSnapshot, field, fileName)
        : fieldSnapshot.kind === 'option-list' &&
            field instanceof pdfLib.PDFOptionList
          ? displayValuesForChoice(fieldSnapshot, field, fileName)
          : [];
    return { snapshot: fieldSnapshot, field, choiceDisplayValues };
  });
  for (const item of validated)
    validateAppearanceText(item, font, pdfLib, fileName);
  return validated;
}

function applyFieldValue(
  item: ValidatedField,
  pdfLib: PdfLibRuntime,
  fileName: string,
): void {
  const { field, snapshot } = item;
  if (!snapshot.changed || snapshot.readOnly) return;

  try {
    switch (snapshot.kind) {
      case 'text':
      case 'multiline-text':
        if (!(field instanceof pdfLib.PDFTextField)) break;
        field.setText(assertStringValue(snapshot, fileName));
        return;
      case 'checkbox':
        if (!(field instanceof pdfLib.PDFCheckBox)) break;
        if (typeof snapshot.value !== 'boolean') {
          throw formError(
            'invalid-value',
            'A checkbox form value has an unexpected type.',
            fileName,
          );
        }
        if (snapshot.value) field.check();
        else field.uncheck();
        return;
      case 'radio':
        if (!(field instanceof pdfLib.PDFRadioGroup)) break;
        if (snapshot.value === null) field.clear();
        else {
          const value = assertStringValue(snapshot, fileName);
          if (!field.getOptions().includes(value)) {
            throw formError(
              'invalid-choice',
              'A selected radio option is no longer available in the source PDF.',
              fileName,
            );
          }
          field.select(value);
        }
        return;
      case 'dropdown':
        if (!(field instanceof pdfLib.PDFDropdown)) break;
        if (item.choiceDisplayValues.length === 0) field.clear();
        else field.select(item.choiceDisplayValues[0]!);
        return;
      case 'option-list':
        if (!(field instanceof pdfLib.PDFOptionList)) break;
        if (item.choiceDisplayValues.length === 0) field.clear();
        else
          field.select(
            snapshot.multiSelect
              ? [...item.choiceDisplayValues]
              : item.choiceDisplayValues[0]!,
          );
        return;
    }
  } catch (error: unknown) {
    if (error instanceof FormExportError) throw error;
    throw formError(
      snapshot.kind === 'radio' ||
        snapshot.kind === 'dropdown' ||
        snapshot.kind === 'option-list'
        ? 'invalid-choice'
        : 'invalid-value',
      'Kagaz could not apply a form value to the source PDF.',
      fileName,
    );
  }

  throw formError(
    'field-type-mismatch',
    'A PDF form field no longer matches the type Kagaz discovered.',
    fileName,
  );
}

export async function prepareFormSource(
  document: PDFDocument,
  snapshot: FormExportSourceSnapshot,
  pdfLib: PdfLibRuntime,
  fileName: string,
  throwIfAborted: () => void,
): Promise<void> {
  const form = document.getForm();
  if (form.hasXFA()) {
    throw formError(
      'unsupported-source',
      'This PDF uses XFA forms, which Kagaz cannot support yet.',
      fileName,
    );
  }
  const unsignedSignatureFields = validateActualFieldInventory(
    form,
    snapshot,
    pdfLib,
    fileName,
  );
  const widgetAnnotationRefs = collectWidgetAnnotationRefs(document, pdfLib);
  removeUnsignedSignatureFields(
    document,
    form,
    unsignedSignatureFields,
    fileName,
  );
  const font = await document.embedFont(pdfLib.StandardFonts.Helvetica);
  const fields = validateFields(form, snapshot, font, pdfLib, fileName);
  throwIfAborted();

  for (const field of fields) {
    applyFieldValue(field, pdfLib, fileName);
    throwIfAborted();
  }

  try {
    form.updateFieldAppearances(font);
  } catch {
    throw formError(
      'appearance-update-failed',
      "Kagaz could not regenerate this PDF form's field appearances.",
      fileName,
    );
  }
  throwIfAborted();

  try {
    form.flatten({ updateFieldAppearances: false });
    // pdf-lib 1.17.1 can leave widget references in /Annots after deleting
    // their objects. Remove the captured widget refs so copied pages never
    // serialize dangling annotations.
    for (const { page, ref } of widgetAnnotationRefs) {
      page.node.removeAnnot(ref);
    }
    if (form.getFields().length !== 0) throw new Error('Form fields remain.');
    for (const page of document.getPages()) {
      for (const ref of page.node.Annots()?.asArray() ?? []) {
        const annotation = document.context.lookup(ref);
        if (
          !(annotation instanceof pdfLib.PDFDict) ||
          annotation.get(pdfLib.PDFName.of('Subtype'))?.toString() === '/Widget'
        )
          throw new Error('A widget or unresolved annotation remains.');
      }
    }
  } catch {
    throw formError(
      'form-flatten-failed',
      'Kagaz could not safely flatten this PDF form for export.',
      fileName,
    );
  }
}
