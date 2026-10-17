import type {
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFOptionList,
  PDFForm,
  PDFRef,
  PDFSignature,
  PDFWidgetAnnotation,
} from 'pdf-lib';
import type * as PdfLibModule from 'pdf-lib';

import {
  FormExportError,
  type FormExportFieldSnapshot,
  type FormExportSourceSnapshot,
} from './types';
import { preparePdfFont, type PdfFontContext } from '../../fonts/pdfFont';
import type { FontAssetSnapshot } from '../../fonts/fontAssets';
import { canonicalDocumentText } from '../../fonts/textPolicy';

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
  | 'TextAlignment'
  | 'cleanText'
  | 'layoutCombedText'
  | 'layoutMultilineText'
  | 'layoutSinglelineText'
  | 'mergeLines'
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

function appearanceTexts(
  item: ValidatedField,
  pdfLib: PdfLibRuntime,
  fileName: string,
): readonly string[] {
  const { field, snapshot } = item;
  if (snapshot.changed && !snapshot.readOnly) {
    if (snapshot.kind === 'text' || snapshot.kind === 'multiline-text') {
      return [assertStringValue(snapshot, fileName)];
    } else if (snapshot.kind === 'dropdown') {
      return item.choiceDisplayValues;
    } else if (snapshot.kind === 'option-list') {
      return field instanceof pdfLib.PDFOptionList ? field.getOptions() : [];
    }
    return [];
  }

  if (!field.needsAppearancesUpdate()) return [];
  if (field instanceof pdfLib.PDFTextField) {
    return [field.getText() ?? ''];
  } else if (field instanceof pdfLib.PDFDropdown) {
    return [field.getSelected()[0] ?? ''];
  } else if (field instanceof pdfLib.PDFOptionList) {
    return field.getOptions();
  }
  return [];
}

function validateFields(
  form: PDFForm,
  snapshot: FormExportSourceSnapshot,
  pdfLib: PdfLibRuntime,
  fileName: string,
): readonly ValidatedField[] {
  const fieldsByName = new Map(
    form.getFields().map((field) => [field.getName(), field]),
  );
  const validated = snapshot.fields.map((fieldSnapshot) => {
    const field = fieldsByName.get(fieldSnapshot.name);
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
  return validated;
}

/** Select one verified appearance font; existing clean source appearances stay intact. */
async function prepareAppearanceFont(
  document: PDFDocument,
  fields: readonly ValidatedField[],
  pdfLib: PdfLibRuntime,
  fileName: string,
  throwIfAborted: () => void,
  fontAssets?: FontAssetSnapshot,
): Promise<PdfFontContext> {
  const texts = fields.flatMap((item) =>
    appearanceTexts(item, pdfLib, fileName),
  );
  let font = await preparePdfFont(document, 'helvetica', fontAssets);
  throwIfAborted();
  try {
    for (const text of texts) font.validate(text);
  } catch {
    try {
      // Reject known shaping/script limits before loading or parsing any font.
      for (const text of texts) canonicalDocumentText(text, 'noto-sans');
    } catch (error) {
      throw formError(
        'unsupported-text-font',
        error instanceof Error
          ? error.message
          : 'This form text requires unsupported script shaping.',
        fileName,
      );
    }
    try {
      font = await preparePdfFont(document, 'noto-sans', fontAssets);
    } catch (error) {
      throw formError(
        'appearance-update-failed',
        error instanceof Error
          ? error.message
          : 'Kagaz could not load the bundled font for this form appearance.',
        fileName,
      );
    }
    throwIfAborted();
  }
  try {
    for (const text of texts) font.validate(text);
    for (const item of fields) {
      if (
        !(item.field instanceof pdfLib.PDFDropdown) &&
        !(item.field instanceof pdfLib.PDFOptionList)
      )
        continue;
      // The provider consumes exact source option labels. Rewriting those labels
      // would broaden field semantics; reject uncomposed labels explicitly.
      for (const text of appearanceTexts(item, pdfLib, fileName)) {
        if (font.validate(text) !== text)
          throw new Error(
            'This form option label uses a decomposed combining sequence. Kagaz cannot safely rewrite source option labels for Unicode export.',
          );
      }
    }
  } catch (error) {
    throw formError(
      'unsupported-text-font',
      error instanceof Error
        ? error.message
        : 'A form appearance contains text that cannot be safely exported with the supported fonts.',
      fileName,
    );
  }
  return font;
}

function appearanceFontSize(field: {
  getDefaultAppearance(): string | undefined;
}): number | undefined {
  // Match the exact numeric Tf grammar consumed by pdf-lib 1.17.1's default
  // appearance provider, including its last-operator-wins rule.
  const expression =
    /\/([^\0\t\n\f\r ]+)[\0\t\n\f\r ]+(\d*\.\d+|\d+)[\0\t\n\f\r ]+Tf/g;
  const matches = [
    ...(field.getDefaultAppearance() ?? '').matchAll(expression),
  ];
  const value = Number(matches.at(-1)?.[2]);
  return Number.isFinite(value) ? value : undefined;
}

/** A newly generated Unicode appearance must not silently clip glyphs/options. */
function validateUnicodeAppearanceGeometry(
  item: ValidatedField,
  font: PdfFontContext,
  pdfLib: PdfLibRuntime,
  fileName: string,
): void {
  const field = item.field;
  if (font.fontId !== 'noto-sans' || !field.needsAppearancesUpdate()) return;
  if (
    !(field instanceof pdfLib.PDFTextField) &&
    !(field instanceof pdfLib.PDFDropdown) &&
    !(field instanceof pdfLib.PDFOptionList)
  )
    return;
  const assertWidget = (widget: PDFWidgetAnnotation) => {
    const rectangle = widget.getRectangle();
    const rotation = widget.getAppearanceCharacteristics()?.getRotation() ?? 0;
    const border = widget.getBorderStyle()?.getWidth() ?? 0;
    if (
      !Number.isFinite(rotation) ||
      rotation % 90 !== 0 ||
      !Number.isFinite(border) ||
      border < 0
    )
      throw new Error('Unsupported Unicode widget geometry.');
    const sideways = Math.abs(rotation % 180) === 90;
    const width = sideways ? rectangle.height : rectangle.width;
    const height = sideways ? rectangle.width : rectangle.height;
    const combed = field instanceof pdfLib.PDFTextField && field.isCombed();
    const padding = combed ? 0 : 1;
    const bounds = {
      x: border + padding,
      y: border + padding,
      width: width - 2 * (border + padding),
      height: height - 2 * (border + padding),
    };
    if (!(bounds.width > 0 && bounds.height > 0))
      throw new Error('Unicode widget has no usable text area.');
    const fontSize =
      appearanceFontSize(widget) ?? appearanceFontSize(field.acroField);
    const optionLabels =
      field instanceof pdfLib.PDFOptionList ? field.getOptions() : [];
    if (field instanceof pdfLib.PDFOptionList && field.isSorted())
      optionLabels.sort();
    const text =
      field instanceof pdfLib.PDFTextField
        ? (field.getText() ?? '')
        : field instanceof pdfLib.PDFDropdown
          ? (field.getSelected()[0] ?? '')
          : optionLabels.join('\n');
    const options = {
      bounds,
      font: font.font,
      fontSize,
      alignment:
        field instanceof pdfLib.PDFTextField
          ? field.getAlignment()
          : pdfLib.TextAlignment.Left,
    };
    const layoutAtSize = (size: number | undefined) => {
      const sizedOptions = { ...options, fontSize: size };
      if (
        field instanceof pdfLib.PDFOptionList ||
        (field instanceof pdfLib.PDFTextField && field.isMultiline())
      ) {
        const layout = pdfLib.layoutMultilineText(text, sizedOptions);
        return { lines: layout.lines, fontSize: layout.fontSize };
      }
      if (field instanceof pdfLib.PDFTextField && field.isCombed()) {
        const layout = pdfLib.layoutCombedText(text, {
          ...sizedOptions,
          cellCount: field.getMaxLength() ?? 0,
        });
        // pdf-lib 1.17.1 stores the full line in each cell.text, although its
        // encoded appearance emits just that cell's character (or empty text).
        // Measure the emitted glyph, using the same preprocessing as its layout.
        const characters = Array.from(
          pdfLib.mergeLines(pdfLib.cleanText(text)),
        );
        return {
          lines: layout.cells.map((cell, index) => ({
            ...cell,
            text: characters[index] ?? '',
          })),
          fontSize: layout.fontSize,
        };
      }
      const layout = pdfLib.layoutSinglelineText(text, sizedOptions);
      return { lines: [layout.line], fontSize: layout.fontSize };
    };
    const fits = (layout: ReturnType<typeof layoutAtSize>) =>
      Number.isFinite(layout.fontSize) &&
      layout.fontSize > 0 &&
      layout.lines.every((line) => {
        if (!line.text.trim()) return true;
        const ink = font.measure(line.text, layout.fontSize).inkBounds;
        return (
          // The provider passes x/y=border/2 to drawTextField/drawOptionList;
          // those add border/2+padding. Their final clip equals these bounds.
          line.x + ink.minX >= bounds.x - 1e-6 &&
          line.x + ink.maxX <= bounds.x + bounds.width + 1e-6 &&
          line.y + ink.minY >= bounds.y - 1e-6 &&
          line.y + ink.maxY <= bounds.y + bounds.height + 1e-6
        );
      });
    if (!fits(layoutAtSize(fontSize))) {
      // Preserve a fitting saved size. When the font substitution would clip,
      // use pdf-lib's bounded auto-fit at or below that size, then recheck ink.
      const automatic = layoutAtSize(0);
      let fittedSize = Math.floor(
        fontSize && fontSize > 0
          ? Math.min(fontSize, automatic.fontSize)
          : automatic.fontSize,
      );
      // The provider's line-height estimate can still clip the last descender.
      // Recheck ink down to its documented 4pt floor, bounded by its 500pt cap.
      if (fittedSize < 4 || !fits(layoutAtSize(4)))
        throw new Error('Unicode form text would be clipped.');
      while (fittedSize > 4 && !fits(layoutAtSize(fittedSize))) fittedSize -= 1;
      const sourceAppearance =
        widget.getDefaultAppearance() ??
        field.acroField.getDefaultAppearance() ??
        '';
      const fontOperators = [
        ...sourceAppearance.matchAll(
          /\/([^\0\t\n\f\r ]+)[\0\t\n\f\r ]+(\d*\.\d+|\d+)[\0\t\n\f\r ]+Tf/g,
        ),
      ];
      const last = fontOperators.at(-1);
      const replacement = `/${font.font.name} ${fittedSize} Tf`;
      widget.setDefaultAppearance(
        last?.index !== undefined
          ? sourceAppearance.slice(0, last.index) +
              replacement +
              sourceAppearance.slice(last.index + last[0].length)
          : `${sourceAppearance}\n${replacement}`,
      );
    }
  };
  try {
    for (const widget of field.acroField.getWidgets()) assertWidget(widget);
  } catch {
    throw formError(
      'appearance-update-failed',
      "The Unicode form appearance cannot be safely fitted inside its source widget. Its saved alignment, padding or size clips glyphs. Shorten the value or adjust the source PDF's text area/alignment; Kagaz will not export clipped Unicode text.",
      fileName,
    );
  }
}

function applyFieldValue(
  item: ValidatedField,
  font: PdfFontContext,
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
        field.setText(font.validate(assertStringValue(snapshot, fileName)));
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
  fontAssets?: FontAssetSnapshot,
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
  const fields = validateFields(form, snapshot, pdfLib, fileName);
  const font = await prepareAppearanceFont(
    document,
    fields,
    pdfLib,
    fileName,
    throwIfAborted,
    fontAssets,
  );
  throwIfAborted();

  for (const field of fields) {
    applyFieldValue(field, font, pdfLib, fileName);
    // The default provider consumes PDFFont directly. Normalize source text only
    // when it already requires regeneration; no existing clean appearance is rewritten.
    if (
      field.field instanceof pdfLib.PDFTextField &&
      field.field.needsAppearancesUpdate()
    ) {
      const current = field.field.getText() ?? '';
      const normalized = font.validate(current);
      if (current !== normalized) field.field.setText(normalized);
    }
    validateUnicodeAppearanceGeometry(field, font, pdfLib, fileName);
    throwIfAborted();
  }

  try {
    form.updateFieldAppearances(font.font);
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
