import type {
  CompressionPreset,
  CompressionMetadata,
} from '@kagaz/shared-types';
import type { PdfExportController } from '../pdf-workspace/hooks/usePdfExport';
import {
  usePdfDerivative,
  type DerivativeState,
} from '../pdf-heavy-tools/usePdfDerivative';
import { uploadCompression } from './compressionClient';
export type CompressionState = DerivativeState<CompressionMetadata>;
export function usePdfCompression(
  prepareWorkspace: PdfExportController['prepareWorkspace'],
) {
  return usePdfDerivative<CompressionPreset, CompressionMetadata>(
    prepareWorkspace,
    uploadCompression,
    'compressed',
  );
}
