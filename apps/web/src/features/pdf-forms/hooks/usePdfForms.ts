import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  discoverPdfForms,
  createDiscoveryError,
} from '../discovery/discoverPdfForms';
import { getFormExportBlockReason } from '../model/exportSafety';
import type {
  FormFieldDefinition,
  FormFieldId,
  FormSourceDefinition,
  FormWidgetDefinition,
} from '../model/types';
import type {
  PdfWorkspaceState,
  SourceDocumentId,
  WorkspacePage,
} from '../../pdf-workspace/model/types';
import type { SourceDocumentRegistry } from '../../pdf-workspace/runtime/sourceDocumentRegistry';

export interface PdfFormsController {
  readonly sources: ReadonlyMap<SourceDocumentId, FormSourceDefinition>;
  readonly getField: (fieldId: FormFieldId) => FormFieldDefinition | undefined;
  readonly getWidgetsForWorkspacePage: (
    page: WorkspacePage,
  ) => readonly FormWidgetDefinition[];
  readonly hasFormsForSource: (sourceId: SourceDocumentId) => boolean;
  readonly getExportBlockReason: (
    pages: readonly WorkspacePage[],
  ) => string | null;
}

function sourceSignature(workspace: PdfWorkspaceState): string {
  return workspace.sourceOrder
    .map(
      (sourceId) =>
        `${sourceId}:${workspace.sources[sourceId]?.status ?? 'missing'}`,
    )
    .join('|');
}

export function usePdfForms(
  workspace: PdfWorkspaceState,
  registry: SourceDocumentRegistry,
): PdfFormsController {
  const [sourceDefinitions, setSourceDefinitions] = useState<
    ReadonlyMap<SourceDocumentId, FormSourceDefinition>
  >(() => new Map());
  const generationRef = useRef(0);
  const signature = sourceSignature(workspace);

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
        } catch (error: unknown) {
          if (
            controller.signal.aborted ||
            generationRef.current !== generation ||
            (error instanceof DOMException && error.name === 'AbortError')
          ) {
            return;
          }
          setSourceDefinitions((previous) => {
            if (!previous.has(sourceId)) return previous;
            const next = new Map(previous);
            next.set(sourceId, createDiscoveryError(sourceId, error));
            return next;
          });
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [registry, signature, workspace.sourceOrder, workspace.sources]);

  const fields = useMemo(() => {
    const result = new Map<FormFieldId, FormFieldDefinition>();
    for (const source of sourceDefinitions.values()) {
      for (const field of source.fields) result.set(field.id, field);
    }
    return result;
  }, [sourceDefinitions]);

  const getField = useCallback(
    (fieldId: FormFieldId) => fields.get(fieldId),
    [fields],
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
      getFormExportBlockReason(pages, sourceDefinitions),
    [sourceDefinitions],
  );

  return {
    sources: sourceDefinitions,
    getField,
    getWidgetsForWorkspacePage,
    hasFormsForSource,
    getExportBlockReason,
  };
}
