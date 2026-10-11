/** Document-content fonts are separate from the application's Inter UI font. */
export type DocumentFontId = 'helvetica' | 'noto-sans';

export interface DocumentFontDefinition {
  readonly id: DocumentFontId;
  readonly label: string;
  readonly browserFamily: string;
  readonly support: string;
  readonly assetId: string;
  readonly supportedScripts: readonly string[];
  readonly shapingPolicy: 'standard14' | 'independent-nfc';
  readonly embedding: 'standard14' | 'static-ttf-full';
}

export const DOCUMENT_FONTS: readonly DocumentFontDefinition[] = [
  {
    id: 'helvetica',
    label: 'Helvetica (classic)',
    browserFamily: 'Arial, sans-serif',
    support: 'PDF Standard Helvetica character set',
    assetId: 'standard14-helvetica',
    supportedScripts: ['WinAnsi Latin'],
    shapingPolicy: 'standard14',
    embedding: 'standard14',
  },
  {
    id: 'noto-sans',
    label: 'Noto Sans (Unicode)',
    browserFamily: 'Kagaz Noto Sans',
    support: 'Latin, accented Latin, Greek and Cyrillic; composed accents',
    assetId: 'bundled-noto-sans-regular-b85c38ec',
    supportedScripts: ['Latin', 'Greek', 'Cyrillic'],
    shapingPolicy: 'independent-nfc',
    embedding: 'static-ttf-full',
  },
];

export function isDocumentFontId(value: unknown): value is DocumentFontId {
  return value === 'helvetica' || value === 'noto-sans';
}

export function documentFontLabel(fontId: DocumentFontId): string {
  return fontId === 'noto-sans' ? 'Noto Sans' : 'Helvetica';
}

export function cssFontFamily(fontId: DocumentFontId): string {
  return fontId === 'noto-sans' ? 'Kagaz Noto Sans' : 'Arial, sans-serif';
}
