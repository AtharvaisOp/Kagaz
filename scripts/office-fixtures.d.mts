export const OFFICE_FIXTURES: readonly {
  name: string;
  format: 'docx' | 'pptx' | 'xlsx';
  pages: number;
  words: string[];
  image?: boolean;
}[];
export const OFFICE_ATTACKS: readonly string[];
export function officeFixture(name: string): Promise<Buffer>;
export function officeAttack(kind: string): Promise<Buffer>;
export function archiveEntries(bytes: Buffer): [string, Buffer][];
export function zipEntries(
  entries: [string, Buffer][],
  options?: { flags?: number; stored?: boolean; mode?: number },
): Buffer;
