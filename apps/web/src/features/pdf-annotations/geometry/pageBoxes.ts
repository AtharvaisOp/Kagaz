export type PdfPageBox = readonly [
  left: number,
  bottom: number,
  right: number,
  top: number,
];

function isFiniteBox(box: PdfPageBox): boolean {
  return (
    box.length === 4 &&
    box.every((value) => Number.isFinite(value)) &&
    box[2] > box[0] &&
    box[3] > box[1]
  );
}

export function intersectPageBoxes(
  first: PdfPageBox,
  second: PdfPageBox,
): PdfPageBox | null {
  if (!isFiniteBox(first) || !isFiniteBox(second)) {
    return null;
  }

  const left = Math.max(first[0], second[0]);
  const bottom = Math.max(first[1], second[1]);
  const right = Math.min(first[2], second[2]);
  const top = Math.min(first[3], second[3]);

  return right > left && top > bottom ? [left, bottom, right, top] : null;
}

export function pageBoxContainsPoint(
  box: PdfPageBox,
  point: { readonly x: number; readonly y: number },
): boolean {
  return (
    isFiniteBox(box) &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= box[0] &&
    point.x <= box[2] &&
    point.y >= box[1] &&
    point.y <= box[3]
  );
}
