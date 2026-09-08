export const TEXT_BOX_INSET_USER_UNITS = 0;

export function textBoxContentDimensions(
  width: number,
  height: number,
): { readonly width: number; readonly height: number } {
  const inset = TEXT_BOX_INSET_USER_UNITS * 2;
  return {
    width: Math.max(0, width - inset),
    height: Math.max(0, height - inset),
  };
}
