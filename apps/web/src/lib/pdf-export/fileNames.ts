const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*]/g;

export function sanitizePdfFileName(value: string, fallback = 'kagaz'): string {
  const withoutExtension = value.replace(/(?:\.pdf)+$/i, '');
  const sanitized = withoutExtension
    .replace(INVALID_FILENAME_CHARACTERS, '-')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
    .replace(/^[.\s-]+/g, '')
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${sanitized || fallback}.pdf`;
}

export function getWorkspaceExportFileName(
  sourceFileNames: readonly string[],
): string {
  if (sourceFileNames.length === 1) {
    return sanitizePdfFileName(
      sourceFileNames[0] ?? 'report',
      'report',
    ).replace(/\.pdf$/i, '-edited.pdf');
  }
  return 'kagaz-merged.pdf';
}

export function getExtractExportFileName(
  sourceFileNames: readonly string[],
): string {
  if (sourceFileNames.length === 1) {
    const base = sanitizePdfFileName(sourceFileNames[0] ?? 'report', 'report')
      .replace(/\.pdf$/i, '')
      .replace(/-edited$/i, '');
    return `${base}-extract.pdf`;
  }
  return 'kagaz-extract.pdf';
}
