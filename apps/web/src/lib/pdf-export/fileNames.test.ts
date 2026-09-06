import { describe, expect, it } from 'vitest';

import {
  getExtractExportFileName,
  getWorkspaceExportFileName,
  sanitizePdfFileName,
} from './fileNames';

describe('PDF export filenames', () => {
  it('uses sensible single and multi-source names', () => {
    expect(getWorkspaceExportFileName(['report.pdf'])).toBe(
      'report-edited.pdf',
    );
    expect(getWorkspaceExportFileName(['a.pdf', 'b.pdf'])).toBe(
      'kagaz-merged.pdf',
    );
    expect(getExtractExportFileName(['report.pdf'])).toBe('report-extract.pdf');
    expect(getExtractExportFileName(['a.pdf', 'b.pdf'])).toBe(
      'kagaz-extract.pdf',
    );
  });

  it('sanitizes hostile and empty names while keeping one extension', () => {
    expect(sanitizePdfFileName('..<>:"/\\|?* report.pdf')).toBe('report.pdf');
    expect(sanitizePdfFileName('   ')).toBe('kagaz.pdf');
    expect(sanitizePdfFileName('already.pdf.pdf')).toBe('already.pdf');
  });
});
