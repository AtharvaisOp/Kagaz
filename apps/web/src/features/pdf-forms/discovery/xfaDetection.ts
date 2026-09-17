export interface XfaSignals {
  readonly isPureXfa?: boolean;
  readonly allXfaHtml?: unknown;
  readonly metadataInfo?: Readonly<Record<string, unknown>> | null;
}

export type XfaKind = 'pure' | 'hybrid';

export interface XfaDetection {
  readonly detected: boolean;
  readonly kind: XfaKind | null;
}

function isTruthyXfaMarker(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1';
}

export function detectXfa(signals: XfaSignals): XfaDetection {
  if (signals.isPureXfa === true || signals.allXfaHtml != null) {
    return { detected: true, kind: 'pure' };
  }

  if (isTruthyXfaMarker(signals.metadataInfo?.IsXFAPresent)) {
    return { detected: true, kind: 'hybrid' };
  }

  return { detected: false, kind: null };
}
