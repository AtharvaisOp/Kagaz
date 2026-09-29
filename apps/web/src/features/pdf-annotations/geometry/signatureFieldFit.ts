import type { PdfOrientedBox } from '../model/types';

const FIELD_MARGIN_RATIO = 0.08;

function localPointToPdf(box: PdfOrientedBox, localX: number, localY: number) {
  switch (box.rotation) {
    case 0:
      return { x: box.origin.x + localX, y: box.origin.y + localY };
    case 90:
      return { x: box.origin.x - localY, y: box.origin.y + localX };
    case 180:
      return { x: box.origin.x - localX, y: box.origin.y - localY };
    case 270:
      return { x: box.origin.x + localY, y: box.origin.y - localX };
  }
}

/** Contains and centers an image in canonical PDF widget geometry. */
export function fitSignatureToField(
  fieldBox: PdfOrientedBox,
  imageWidth: number,
  imageHeight: number,
): PdfOrientedBox {
  const availableWidth = fieldBox.width * (1 - FIELD_MARGIN_RATIO * 2);
  const availableHeight = fieldBox.height * (1 - FIELD_MARGIN_RATIO * 2);
  const scale = Math.min(
    availableWidth / imageWidth,
    availableHeight / imageHeight,
  );
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const origin = localPointToPdf(
    fieldBox,
    (fieldBox.width - width) / 2,
    (fieldBox.height - height) / 2,
  );
  return { origin, width, height, rotation: fieldBox.rotation };
}
