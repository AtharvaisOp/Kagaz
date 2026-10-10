import type { WorkspacePage } from '../../pdf-workspace/model/types';
import { parsePageRange } from '../../pdf-workspace/model/rangeParser';
import type { WatermarkConfig, WatermarkTarget } from './types';

export function createDefaultWatermark(id: string): WatermarkConfig {
  return {
    id,
    kind: 'text',
    text: 'DRAFT',
    fontSize: 48,
    color: { r: 0.5, g: 0.5, b: 0.5 },
    opacity: 0.3,
    rotation: 35,
    scale: 0.8,
    position: 'center',
    customPosition: { x: 0.5, y: 0.5 },
    target: { kind: 'all' },
  };
}

/** Serializable configuration only; runtime image resources remain registry-owned. */
export function snapshotWatermark(config: WatermarkConfig): WatermarkConfig {
  const target: WatermarkTarget =
    config.target.kind === 'all'
      ? Object.freeze({ kind: 'all' })
      : Object.freeze({
          kind: 'pages',
          pageIds: Object.freeze([...config.target.pageIds]),
        });
  const base = {
    ...config,
    customPosition: Object.freeze({ ...config.customPosition }),
    target,
  };
  return Object.freeze(
    config.kind === 'text'
      ? {
          ...base,
          kind: 'text',
          text: config.text,
          fontSize: config.fontSize,
          color: Object.freeze({ ...config.color }),
        }
      : { ...base, kind: 'image', assetId: config.assetId },
  );
}

export function watermarkAppliesToPage(
  config: WatermarkConfig | null,
  pageId: string,
): boolean {
  return Boolean(
    config &&
    (config.target.kind === 'all' || config.target.pageIds.includes(pageId)),
  );
}

export function targetWatermarkPageIds(
  target: WatermarkTarget,
  pages: readonly WorkspacePage[],
): readonly string[] {
  return pages
    .filter((page) => target.kind === 'all' || target.pageIds.includes(page.id))
    .map((page) => page.id);
}

/** Ranges resolve against current order once; committed IDs survive later reordering. */
export function watermarkTargetFromRange(
  expression: string,
  pages: readonly WorkspacePage[],
): WatermarkTarget {
  const result = parsePageRange(expression, pages.length);
  if (!result.ok)
    throw new Error(
      'Use valid current page numbers and ascending ranges, such as 1-3, 5.',
    );
  return {
    kind: 'pages',
    pageIds: result.indexes.map((index) => pages[index]!.id),
  };
}

export function validateWatermarkModel(
  config: WatermarkConfig,
  availablePageIds?: ReadonlySet<string>,
): string | null {
  const within = (value: number, min: number, max: number) =>
    Number.isFinite(value) && value >= min && value <= max;
  if (
    !config.id ||
    !within(config.opacity, 0, 1) ||
    !within(config.rotation, -180, 180) ||
    !within(config.scale, 0.05, 1)
  )
    return 'Use opacity 0–100%, rotation −180–180°, and size 5–100%.';
  if (
    ![
      'center',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
      'custom',
    ].includes(config.position) ||
    !within(config.customPosition.x, 0, 1) ||
    !within(config.customPosition.y, 0, 1)
  )
    return 'Choose a valid position with X and Y between 0 and 100%.';
  if (config.target.kind !== 'all') {
    if (config.target.kind !== 'pages' || config.target.pageIds.length === 0)
      return 'Choose at least one watermark page.';
    if (new Set(config.target.pageIds).size !== config.target.pageIds.length)
      return 'Each watermark page must be selected only once.';
    if (
      config.target.pageIds.some(
        (id) => !id || (availablePageIds && !availablePageIds.has(id)),
      )
    )
      return 'A selected watermark page was deleted. Choose the pages again.';
  }
  if (config.kind === 'text') {
    if (!config.text.trim()) return 'Enter watermark text.';
    if (
      config.text.length > 200 ||
      Array.from(config.text).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      return 'Use a single line of at most 200 characters without control characters.';
    if (!within(config.fontSize, 8, 144))
      return 'Use a font size between 8 and 144 points.';
    if (
      ![config.color.r, config.color.g, config.color.b].every((value) =>
        within(value, 0, 1),
      )
    )
      return 'Choose a valid text color.';
  } else if (config.kind !== 'image' || !config.assetId)
    return 'Choose a PNG or JPEG watermark image.';
  return null;
}

export function equalWatermarks(
  first: WatermarkConfig | null,
  second: WatermarkConfig | null,
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

export function pruneWatermark(
  config: WatermarkConfig | null,
  availablePageIds: ReadonlySet<string>,
): WatermarkConfig | null {
  if (!config || config.target.kind === 'all')
    return availablePageIds.size ? config : null;
  const pageIds = config.target.pageIds.filter((id) =>
    availablePageIds.has(id),
  );
  if (!pageIds.length) return null;
  return pageIds.length === config.target.pageIds.length
    ? config
    : snapshotWatermark({ ...config, target: { kind: 'pages', pageIds } });
}
