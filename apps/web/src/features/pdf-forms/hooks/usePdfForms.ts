import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import {
  discoverPdfForms,
  createDiscoveryError,
} from '../discovery/discoverPdfForms';
import { getFormExportBlockReason } from '../model/exportSafety';
import { snapshotFormsForPages } from '../model/exportSnapshot';
import { createFormHistoryState } from '../model/history';
import { initialFormValue } from '../model/formValues';
import { formReducer } from '../model/reducer';
import type {
  FormFieldDefinition,
  FormFieldId,
  FormHistoryState,
  FormSourceDefinition,
  FormValue,
  FormWidgetDefinition,
} from '../model/types';
import type {
  EditorHistoryBridge,
  EditorHistoryParticipant,
} from '../../editor-history/types';
import type {
  PdfWorkspaceState,
  SourceDocumentId,
  WorkspacePage,
} from '../../pdf-workspace/model/types';
import type { SourceDocumentRegistry } from '../../pdf-workspace/runtime/sourceDocumentRegistry';
import type { FormExportSnapshot } from '../../../lib/pdf-export/forms/types';

export interface FormTextEditSession {
  readonly sessionId: string;
  readonly fieldId: FormFieldId;
  readonly draft: string;
  readonly initial: string;
}

export interface PdfFormsController {
  readonly sources: ReadonlyMap<SourceDocumentId, FormSourceDefinition>;
  readonly state: FormHistoryState;
  readonly dirty: boolean;
  readonly hasUnsavedWork: boolean;
  readonly textEditSession: FormTextEditSession | null;
  readonly getField: (fieldId: FormFieldId) => FormFieldDefinition | undefined;
  readonly getValue: (fieldId: FormFieldId) => FormValue | undefined;
  readonly getWidgetsForWorkspacePage: (
    page: WorkspacePage,
  ) => readonly FormWidgetDefinition[];
  readonly hasFormsForSource: (sourceId: SourceDocumentId) => boolean;
  readonly getExportBlockReason: (
    pages: readonly WorkspacePage[],
  ) => string | null;
  readonly snapshotForExport: (
    pages: readonly WorkspacePage[],
  ) => FormExportSnapshot;
  readonly beginTextEdit: (fieldId: FormFieldId) => void;
  readonly updateTextDraft: (fieldId: FormFieldId, draft: string) => void;
  readonly commitTextEdit: (fieldId: FormFieldId) => void;
  readonly cancelTextEdit: (fieldId?: FormFieldId) => void;
  readonly setCheckbox: (fieldId: FormFieldId, checked: boolean) => void;
  readonly selectRadio: (fieldId: FormFieldId, value: string | null) => void;
  readonly selectChoice: (fieldId: FormFieldId, value: FormValue) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly resetForms: () => void;
  readonly historyParticipant: EditorHistoryParticipant;
}

function sourceSignature(workspace: PdfWorkspaceState): string {
  return workspace.sourceOrder
    .map(
      (sourceId) =>
        `${sourceId}:${workspace.sources[sourceId]?.status ?? 'missing'}`,
    )
    .join('|');
}

function isEditableField(field: FormFieldDefinition): boolean {
  return (
    !field.readOnly &&
    [
      'text',
      'multiline-text',
      'checkbox',
      'radio',
      'dropdown',
      'option-list',
    ].includes(field.kind)
  );
}

function valueAsText(value: FormValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function valueMatchesField(
  field: FormFieldDefinition,
  value: FormValue,
): boolean {
  if (field.kind === 'text' || field.kind === 'multiline-text')
    return typeof value === 'string';
  if (field.kind === 'checkbox') return typeof value === 'boolean';
  if (field.kind === 'radio' || field.kind === 'dropdown')
    return value === null || typeof value === 'string';
  if (field.kind === 'option-list')
    return field.multiSelect
      ? Array.isArray(value)
      : value === null || typeof value === 'string';
  return false;
}

function initialValuesFor(
  source: FormSourceDefinition,
): Readonly<Record<FormFieldId, FormValue>> {
  const values: Record<FormFieldId, FormValue> = {};
  if (source.status !== 'acroform') return values;
  for (const field of source.fields) values[field.id] = initialFormValue(field);
  return values;
}

export function usePdfForms(
  workspace: PdfWorkspaceState,
  registry: SourceDocumentRegistry,
  history?: EditorHistoryBridge,
): PdfFormsController {
  const [sourceDefinitions, setSourceDefinitions] = useState<
    ReadonlyMap<SourceDocumentId, FormSourceDefinition>
  >(() => new Map());
  const [state, dispatch] = useReducer(
    formReducer,
    undefined,
    createFormHistoryState,
  );
  const [textEditSession, setTextEditSession] =
    useState<FormTextEditSession | null>(null);
  const generationRef = useRef(0);
  const stateRef = useRef(state);
  const sessionRef = useRef(textEditSession);
  const sessionCounterRef = useRef(0);
  const activeFieldIdsRef = useRef<ReadonlySet<FormFieldId> | null>(null);
  const sourceDefinitionsRef = useRef(sourceDefinitions);
  const signature = sourceSignature(workspace);

  useLayoutEffect(() => {
    stateRef.current = state;
    sessionRef.current = textEditSession;
    sourceDefinitionsRef.current = sourceDefinitions;
  }, [sourceDefinitions, state, textEditSession]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const controller = new AbortController();
    const readySourceIds = workspace.sourceOrder.filter(
      (sourceId) =>
        workspace.sources[sourceId]?.status === 'ready' &&
        registry.getDocument(sourceId) !== null,
    );
    setSourceDefinitions((previous) => {
      const next = new Map<SourceDocumentId, FormSourceDefinition>();
      for (const sourceId of readySourceIds) {
        next.set(sourceId, {
          sourceDocumentId: sourceId,
          status: 'discovering',
          fields: previous.get(sourceId)?.fields ?? [],
          widgets: previous.get(sourceId)?.widgets ?? [],
          error: null,
        });
      }
      return next;
    });
    void (async () => {
      for (const sourceId of readySourceIds) {
        if (controller.signal.aborted || generationRef.current !== generation)
          return;
        const document = registry.getDocument(sourceId);
        if (!document) continue;
        try {
          const definition = await discoverPdfForms(sourceId, document, {
            signal: controller.signal,
          });
          if (controller.signal.aborted || generationRef.current !== generation)
            return;
          setSourceDefinitions((previous) => {
            if (!previous.has(sourceId)) return previous;
            const next = new Map(previous);
            next.set(sourceId, definition);
            return next;
          });
          dispatch({
            type: 'INITIALIZE_SOURCE',
            initialValues: initialValuesFor(definition),
          });
        } catch (error: unknown) {
          if (
            controller.signal.aborted ||
            generationRef.current !== generation ||
            (error instanceof DOMException && error.name === 'AbortError')
          )
            return;
          setSourceDefinitions((previous) => {
            if (!previous.has(sourceId)) return previous;
            const next = new Map(previous);
            next.set(sourceId, createDiscoveryError(sourceId, error));
            return next;
          });
        }
      }
    })();
    return () => controller.abort();
  }, [registry, signature, workspace.sourceOrder, workspace.sources]);

  const fields = useMemo(() => {
    const result = new Map<FormFieldId, FormFieldDefinition>();
    for (const source of sourceDefinitions.values())
      for (const field of source.fields) result.set(field.id, field);
    return result;
  }, [sourceDefinitions]);

  const activeFieldIds = useMemo(() => {
    const activePages = new Set(
      workspace.pages.map(
        (page) => `${page.sourceDocumentId}:${page.sourcePageIndex}`,
      ),
    );
    const ids = new Set<FormFieldId>();
    for (const source of sourceDefinitions.values()) {
      for (const widget of source.widgets)
        if (
          activePages.has(
            `${widget.sourceDocumentId}:${widget.sourcePageIndex}`,
          )
        )
          ids.add(widget.fieldId);
    }
    return [...ids];
  }, [sourceDefinitions, workspace.pages]);

  useEffect(() => {
    const previous = activeFieldIdsRef.current;
    const active = new Set(activeFieldIds);
    dispatch({ type: 'PRUNE_FIELDS', fieldIds: activeFieldIds });
    if (history && previous) {
      const removedFieldIds = [...previous].filter(
        (fieldId) => !active.has(fieldId),
      );
      if (removedFieldIds.length > 0) history.prune(removedFieldIds);
    }
    activeFieldIdsRef.current = active;
  }, [activeFieldIds, history]);

  const getField = useCallback(
    (fieldId: FormFieldId) => fields.get(fieldId),
    [fields],
  );
  const getValue = useCallback(
    (fieldId: FormFieldId) => state.present.byField[fieldId],
    [state.present],
  );
  const getWidgetsForWorkspacePage = useCallback(
    (page: WorkspacePage) =>
      sourceDefinitions
        .get(page.sourceDocumentId)
        ?.widgets.filter(
          (widget) => widget.sourcePageIndex === page.sourcePageIndex,
        ) ?? [],
    [sourceDefinitions],
  );
  const hasFormsForSource = useCallback(
    (sourceId: SourceDocumentId) => {
      const status = sourceDefinitions.get(sourceId)?.status;
      return status === 'acroform' || status === 'unsupported-xfa';
    },
    [sourceDefinitions],
  );
  const getExportBlockReason = useCallback(
    (pages: readonly WorkspacePage[]) =>
      getFormExportBlockReason(
        pages,
        sourceDefinitions,
        textEditSession !== null &&
          textEditSession.draft !== textEditSession.initial,
      ),
    [sourceDefinitions, textEditSession],
  );
  const snapshotForExport = useCallback(
    (pages: readonly WorkspacePage[]) =>
      snapshotFormsForPages(
        pages,
        sourceDefinitionsRef.current,
        stateRef.current,
        sessionRef.current,
      ),
    [],
  );

  const commitValue = useCallback(
    (fieldId: FormFieldId, value: FormValue) => {
      const field = fields.get(fieldId);
      if (!field || !isEditableField(field) || !valueMatchesField(field, value))
        return;
      const next = formReducer(stateRef.current, {
        type: 'COMMIT_FIELD_VALUE',
        fieldId,
        value,
      });
      if (next === stateRef.current) return;
      dispatch({ type: 'COMMIT_FIELD_VALUE', fieldId, value });
      history?.record([fieldId]);
    },
    [fields, history],
  );

  const beginTextEdit = useCallback(
    (fieldId: FormFieldId) => {
      const field = fields.get(fieldId);
      if (
        !field ||
        !isEditableField(field) ||
        (field.kind !== 'text' && field.kind !== 'multiline-text')
      )
        return;
      const initial = valueAsText(stateRef.current.present.byField[fieldId]);
      const session = {
        sessionId: `form-text-${++sessionCounterRef.current}`,
        fieldId,
        draft: initial,
        initial,
      } satisfies FormTextEditSession;
      sessionRef.current = session;
      setTextEditSession(session);
    },
    [fields],
  );

  const updateTextDraft = useCallback(
    (fieldId: FormFieldId, draft: string) => {
      const session = sessionRef.current;
      if (!session || session.fieldId !== fieldId) return;
      const maxLength = fields.get(fieldId)?.maxLength;
      const nextDraft =
        maxLength !== null &&
        maxLength !== undefined &&
        session.initial.length <= maxLength
          ? draft.slice(0, maxLength)
          : draft;
      const next = { ...session, draft: nextDraft };
      sessionRef.current = next;
      setTextEditSession(next);
    },
    [fields],
  );

  const cancelTextEdit = useCallback((fieldId?: FormFieldId) => {
    const session = sessionRef.current;
    if (!session || (fieldId && session.fieldId !== fieldId)) return;
    sessionRef.current = null;
    setTextEditSession(null);
  }, []);

  const commitTextEdit = useCallback(
    (fieldId: FormFieldId) => {
      const session = sessionRef.current;
      if (!session || session.fieldId !== fieldId) return;
      sessionRef.current = null;
      setTextEditSession(null);
      if (session.draft !== session.initial)
        commitValue(fieldId, session.draft);
    },
    [commitValue],
  );

  const setCheckbox = useCallback(
    (fieldId: FormFieldId, checked: boolean) => {
      if (fields.get(fieldId)?.kind === 'checkbox')
        commitValue(fieldId, checked);
    },
    [commitValue, fields],
  );
  const selectRadio = useCallback(
    (fieldId: FormFieldId, value: string | null) => {
      if (fields.get(fieldId)?.kind === 'radio') commitValue(fieldId, value);
    },
    [commitValue, fields],
  );
  const selectChoice = useCallback(
    (fieldId: FormFieldId, value: FormValue) => {
      const field = fields.get(fieldId);
      if (field?.kind === 'dropdown' || field?.kind === 'option-list')
        commitValue(fieldId, value);
    },
    [commitValue, fields],
  );

  const domainUndo = useCallback(() => {
    if (stateRef.current.past.length === 0) return false;
    dispatch({ type: 'UNDO' });
    return true;
  }, []);
  const domainRedo = useCallback(() => {
    if (stateRef.current.future.length === 0) return false;
    dispatch({ type: 'REDO' });
    return true;
  }, []);
  const historyParticipant = useMemo<EditorHistoryParticipant>(
    () => ({
      get canUndo() {
        return stateRef.current.past.length > 0;
      },
      get canRedo() {
        return stateRef.current.future.length > 0;
      },
      undo: domainUndo,
      redo: domainRedo,
      discardFuture: () => dispatch({ type: 'DISCARD_FUTURE' }),
    }),
    [domainRedo, domainUndo],
  );
  const undo = useMemo(
    () => history?.undo ?? (() => void domainUndo()),
    [domainUndo, history],
  );
  const redo = useMemo(
    () => history?.redo ?? (() => void domainRedo()),
    [domainRedo, history],
  );
  const resetForms = useCallback(() => {
    sessionRef.current = null;
    setTextEditSession(null);
    dispatch({ type: 'RESET_FORMS' });
  }, []);
  const hasUnsavedWork =
    state.dirty ||
    (textEditSession !== null &&
      textEditSession.draft !== textEditSession.initial);

  return useMemo(
    () => ({
      sources: sourceDefinitions,
      state,
      dirty: state.dirty,
      hasUnsavedWork,
      textEditSession,
      getField,
      getValue,
      getWidgetsForWorkspacePage,
      hasFormsForSource,
      getExportBlockReason,
      snapshotForExport,
      beginTextEdit,
      updateTextDraft,
      commitTextEdit,
      cancelTextEdit,
      setCheckbox,
      selectRadio,
      selectChoice,
      undo,
      redo,
      canUndo: history?.canUndo ?? state.past.length > 0,
      canRedo: history?.canRedo ?? state.future.length > 0,
      resetForms,
      historyParticipant,
    }),
    [
      beginTextEdit,
      cancelTextEdit,
      commitTextEdit,
      getExportBlockReason,
      getField,
      getValue,
      getWidgetsForWorkspacePage,
      hasFormsForSource,
      hasUnsavedWork,
      history,
      historyParticipant,
      redo,
      resetForms,
      selectChoice,
      selectRadio,
      setCheckbox,
      snapshotForExport,
      sourceDefinitions,
      state,
      textEditSession,
      undo,
      updateTextDraft,
    ],
  );
}
