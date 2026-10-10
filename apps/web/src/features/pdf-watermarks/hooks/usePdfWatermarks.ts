import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type {
  EditorHistoryBridge,
  EditorHistoryParticipant,
} from '../../editor-history/types';
import {
  createBrowserAnnotationAssetRegistry,
  type AnnotationAssetRegistry,
} from '../../pdf-annotations/runtime/annotationAssetRegistry';
import { createBrowserIdFactory } from '../../pdf-workspace/runtime/ids';
import type { WorkspacePage } from '../../pdf-workspace/model/types';
import type { SourceDocumentRegistry } from '../../pdf-workspace/runtime/sourceDocumentRegistry';
import { snapshotAnnotationImageAssets } from '../../../lib/pdf-export/annotations/imageAssets';
import { watermarkImageFilePreflight } from '../../../lib/pdf-export/watermarks/imageSafety';
import {
  createWatermarkHistory,
  watermarkReducer,
  removedWatermarkTransactionIds,
  type WatermarkAction,
} from '../model/reducer';
import {
  createDefaultWatermark,
  equalWatermarks,
  snapshotWatermark,
  validateWatermarkModel,
  targetWatermarkPageIds,
} from '../model/watermark';
import type { WatermarkConfig, WatermarkHistoryState } from '../model/types';

export interface PdfWatermarkController {
  readonly state: WatermarkHistoryState;
  readonly draft: WatermarkConfig | null;
  readonly preview: WatermarkConfig | null;
  readonly assetRegistry: AnnotationAssetRegistry;
  readonly open: () => void;
  readonly cancel: () => void;
  readonly updateDraft: (config: WatermarkConfig) => void;
  readonly chooseImage: (file: File) => Promise<void>;
  readonly applyDraft: () => Promise<boolean>;
  readonly remove: () => void;
  readonly reset: () => void;
  readonly busy: boolean;
  readonly error: string | null;
  readonly announcement: string | null;
  readonly hasUnsavedWork: boolean;
  readonly historyParticipant: EditorHistoryParticipant;
}

export function collectWatermarkAssetIds(
  state: WatermarkHistoryState,
  draft: WatermarkConfig | null,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const config of [
    state.present,
    ...state.past.map((entry) => entry.config),
    ...state.future.map((entry) => entry.config),
    draft,
  ])
    if (config?.kind === 'image' && config.assetId) ids.add(config.assetId);
  return ids;
}

/** One committed configuration, separate drafts, and the existing image registry lifecycle. */
export function usePdfWatermarks(
  pages: readonly WorkspacePage[],
  registry: SourceDocumentRegistry,
  history?: EditorHistoryBridge,
): PdfWatermarkController {
  const [state, dispatch] = useReducer(
    watermarkReducer,
    undefined,
    createWatermarkHistory,
  );
  const stateRef = useRef(state);
  const [draft, setDraft] = useState<WatermarkConfig | null>(null);
  const draftRef = useRef(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const pageIdsRef = useRef(new Set(pages.map((page) => page.id)));
  const pagesRef = useRef(pages);
  const imageGeneration = useRef(0);
  const imageAbort = useRef<AbortController | null>(null);
  const applyGeneration = useRef(0);
  const applyBusy = useRef(false);
  const createId = useMemo(() => createBrowserIdFactory('watermark'), []);
  const createTransaction = useMemo(
    () => createBrowserIdFactory('watermark-edit'),
    [],
  );
  const createAssetId = useMemo(
    () => createBrowserIdFactory('watermark-asset'),
    [],
  );
  const assetRegistry = useMemo(
    () => createBrowserAnnotationAssetRegistry(createAssetId),
    [createAssetId],
  );
  const apply = useCallback((action: WatermarkAction) => {
    const next = watermarkReducer(stateRef.current, action);
    if (next === stateRef.current) return false;
    stateRef.current = next;
    dispatch(action);
    return true;
  }, []);
  const cancel = useCallback(() => {
    imageGeneration.current += 1;
    imageAbort.current?.abort();
    imageAbort.current = null;
    applyGeneration.current += 1;
    applyBusy.current = false;
    draftRef.current = null;
    setDraft(null);
    setBusy(false);
    setError(null);
  }, []);
  const updateDraft = useCallback((config: WatermarkConfig) => {
    if (!draftRef.current) return;
    if (draftRef.current.kind !== config.kind) {
      imageGeneration.current += 1;
      imageAbort.current?.abort();
      imageAbort.current = null;
      setBusy(false);
    }
    applyGeneration.current += 1;
    if (applyBusy.current) {
      applyBusy.current = false;
      setBusy(false);
    }
    draftRef.current = config;
    setDraft(config);
    setError(null);
  }, []);
  const open = useCallback(() => {
    cancel();
    const next = snapshotWatermark(
      stateRef.current.present ?? createDefaultWatermark(createId()),
    );
    draftRef.current = next;
    setDraft(next);
  }, [cancel, createId]);

  useLayoutEffect(() => {
    const nextIds = new Set(pages.map((page) => page.id));
    const removed = [...pageIdsRef.current].some((id) => !nextIds.has(id));
    const changed = pagesRef.current !== pages;
    if (changed && applyBusy.current) {
      applyGeneration.current += 1;
      applyBusy.current = false;
      setBusy(false);
      setError(
        'The workspace changed while preparing the watermark. Apply again to use its current pages.',
      );
    }
    pageIdsRef.current = nextIds;
    pagesRef.current = pages;
    if (!removed) return;
    const before = stateRef.current;
    apply({ type: 'PRUNE', pageIds: [...nextIds] });
    const removedTransactions = removedWatermarkTransactionIds(
      before,
      stateRef.current,
    );
    if (removedTransactions.length) history?.prune(removedTransactions);
    // Pending explicit selections are left visible for validation, never silently retargeted.
    if (!nextIds.size)
      queueMicrotask(() => {
        if (!pageIdsRef.current.size) cancel();
      });
  }, [apply, cancel, history, pages]);

  useEffect(() => {
    assetRegistry.reconcile(collectWatermarkAssetIds(state, draft));
  }, [assetRegistry, draft, state]);
  useEffect(
    () => () => {
      imageGeneration.current += 1;
      imageAbort.current?.abort();
      applyGeneration.current += 1;
      assetRegistry.destroyAll();
    },
    [assetRegistry],
  );

  const chooseImage = useCallback(
    async (file: File) => {
      if (draftRef.current?.kind !== 'image') return;
      const generation = ++imageGeneration.current;
      imageAbort.current?.abort();
      const abort = new AbortController();
      imageAbort.current = abort;
      setBusy(true);
      setError(null);
      try {
        const dimensions = await watermarkImageFilePreflight(file);
        if (
          generation !== imageGeneration.current ||
          draftRef.current?.kind !== 'image'
        )
          return;
        const reachable = collectWatermarkAssetIds(
          stateRef.current,
          draftRef.current,
        );
        let pixels = dimensions.width * dimensions.height;
        let bytes = file.size;
        for (const id of reachable) {
          const retained = assetRegistry.get(id);
          if (retained) {
            pixels += retained.width * retained.height;
            bytes += retained.blob.size;
          }
        }
        if (pixels > 32_000_000 || bytes > 30 * 1024 * 1024)
          throw new Error(
            'Watermark image history exceeds the 32-megapixel or 30-MiB asset budget. Start Over before adding more large images.',
          );
        const { prepareWatermarkImageFile } =
          await import('../../../lib/pdf-export/watermarks/nativeImage');
        if (
          generation !== imageGeneration.current ||
          draftRef.current?.kind !== 'image'
        )
          return;
        const prepared = await prepareWatermarkImageFile(file, abort.signal);
        if (
          generation !== imageGeneration.current ||
          draftRef.current?.kind !== 'image'
        )
          return;
        if (bytes - file.size + prepared.blob.size > 30 * 1024 * 1024)
          throw new Error(
            'The prepared watermark image exceeds the 30-MiB image history budget.',
          );
        // Keep the chosen filename while storing only the validated appearance.
        const preparedFile = new File([prepared.blob], file.name, {
          type: prepared.blob.type,
          lastModified: file.lastModified,
        });
        const asset = await assetRegistry.register(preparedFile, abort.signal);
        if (
          asset.width !== dimensions.width ||
          asset.height !== dimensions.height
        ) {
          assetRegistry.destroy(asset.assetId);
          throw new Error(
            'The decoded watermark image dimensions do not match its file.',
          );
        }
        if (
          generation !== imageGeneration.current ||
          draftRef.current?.kind !== 'image'
        ) {
          assetRegistry.destroy(asset.assetId);
          return;
        }
        updateDraft({ ...draftRef.current, assetId: asset.assetId });
      } catch (failure: unknown) {
        if (generation === imageGeneration.current)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Kagaz could not read the watermark image.',
          );
      } finally {
        if (generation === imageGeneration.current) {
          imageAbort.current = null;
          setBusy(false);
        }
      }
    },
    [assetRegistry, updateDraft],
  );

  const applyDraft = useCallback(async () => {
    const candidate = draftRef.current;
    if (!candidate || busy || applyBusy.current) return false;
    const message = validateWatermarkModel(candidate, pageIdsRef.current);
    if (message) {
      setError(message);
      return false;
    }
    const config = snapshotWatermark(candidate);
    const generation = ++applyGeneration.current;
    applyBusy.current = true;
    setBusy(true);
    setError(null);
    try {
      // Capture image Blobs before imports/reads; validate all target metadata without rendering pages.
      const imageAssets = snapshotAnnotationImageAssets(
        assetRegistry,
        config.kind === 'image' ? [config.assetId] : [],
      );
      void imageAssets.catch(() => undefined);
      const { createWatermarkGeometryValidator } =
        await import('../../../lib/pdf-export/watermarks/renderWatermark');
      const validateGeometry = await createWatermarkGeometryValidator(
        config,
        await imageAssets,
      );
      const targetPages = [...pagesRef.current];
      const targets = new Set(
        targetWatermarkPageIds(config.target, targetPages),
      );
      for (const workspacePage of targetPages) {
        if (!targets.has(workspacePage.id)) continue;
        if (generation !== applyGeneration.current) return false;
        const source = registry.getDocument(workspacePage.sourceDocumentId);
        if (!source)
          throw new Error('A selected watermark page is no longer available.');
        const page = await source.getPage(workspacePage.sourcePageIndex + 1);
        try {
          validateGeometry({
            viewBox: [...page.view],
            userUnit: page.userUnit,
            rotation: (page.rotate + workspacePage.rotationDelta) % 360,
          });
        } finally {
          page.cleanup();
        }
      }
      if (
        generation !== applyGeneration.current ||
        draftRef.current !== candidate
      )
        return false;
      const currentValidation = validateWatermarkModel(
        config,
        pageIdsRef.current,
      );
      if (currentValidation) {
        setError(currentValidation);
        return false;
      }
      const transactionId = createTransaction();
      const before = stateRef.current;
      if (apply({ type: 'APPLY', config, transactionId })) {
        const removed = removedWatermarkTransactionIds(
          before,
          stateRef.current,
        );
        if (removed.length) history?.prune(removed);
        history?.record([transactionId]);
        setAnnouncement(
          stateRef.current.past.length > 1
            ? 'Watermark updated.'
            : 'Watermark applied.',
        );
      }
      cancel();
      return true;
    } catch (failure: unknown) {
      if (generation === applyGeneration.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Kagaz could not apply the watermark.',
        );
      return false;
    } finally {
      if (generation === applyGeneration.current) {
        applyBusy.current = false;
        setBusy(false);
      }
    }
  }, [
    apply,
    assetRegistry,
    busy,
    cancel,
    createTransaction,
    history,
    registry,
  ]);

  const remove = useCallback(() => {
    const transactionId = createTransaction();
    const before = stateRef.current;
    if (apply({ type: 'REMOVE', transactionId })) {
      const removed = removedWatermarkTransactionIds(before, stateRef.current);
      if (removed.length) history?.prune(removed);
      history?.record([transactionId]);
      setAnnouncement('Watermark removed.');
    }
    cancel();
  }, [apply, cancel, createTransaction, history]);
  const reset = useCallback(() => {
    cancel();
    apply({ type: 'RESET' });
    assetRegistry.destroyAll();
    setAnnouncement(null);
  }, [apply, assetRegistry, cancel]);
  const historyParticipant = useMemo<EditorHistoryParticipant>(
    () => ({
      get canUndo() {
        return stateRef.current.past.length > 0;
      },
      get canRedo() {
        return stateRef.current.future.length > 0;
      },
      undo: () => apply({ type: 'UNDO' }),
      redo: () => apply({ type: 'REDO' }),
      discardFuture: () => {
        apply({ type: 'DISCARD_FUTURE' });
      },
    }),
    [apply],
  );
  const availablePageIds = useMemo(
    () => new Set(pages.map((page) => page.id)),
    [pages],
  );
  const preview =
    draft && !validateWatermarkModel(draft, availablePageIds)
      ? draft
      : state.present;
  return {
    state,
    draft,
    preview,
    assetRegistry,
    open,
    cancel,
    updateDraft,
    chooseImage,
    applyDraft,
    remove,
    reset,
    busy,
    error,
    announcement,
    hasUnsavedWork: Boolean(
      state.present || (draft && !equalWatermarks(draft, state.present)),
    ),
    historyParticipant,
  };
}
