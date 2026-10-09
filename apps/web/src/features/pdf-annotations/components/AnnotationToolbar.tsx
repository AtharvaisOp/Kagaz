import { useCallback, useEffect, useRef } from 'react';
import type { PdfRedactionController } from '../../pdf-redactions/hooks/usePdfRedactions';

import type { PdfAnnotationController } from '../hooks/usePdfAnnotations';
import type { AnnotationTool } from '../model/editorTypes';
import type { PdfAnnotation, RgbColor } from '../model/types';
import { shouldHandleAnnotationShortcut } from './annotationShortcuts';
import { SignatureCreator } from './SignatureCreator';
import {
  beginOpacityInteraction,
  completeOpacityInteraction,
  IDLE_OPACITY_INTERACTION,
  isOpacityAdjustmentKey,
  sameAnnotationSelection,
  updateOpacityInteraction,
  type OpacityInteractionState,
} from './annotationStyleInteraction';

interface AnnotationToolbarProps {
  readonly controller: PdfAnnotationController;
  readonly redactionController?: PdfRedactionController;
}

const tools: readonly {
  tool: Exclude<AnnotationTool, 'image'>;
  label: string;
  shortcut: string;
}[] = [
  { tool: 'select', label: 'Select', shortcut: 'V' },
  { tool: 'text', label: 'Text', shortcut: 'T' },
  { tool: 'highlight', label: 'Highlight', shortcut: 'H' },
  { tool: 'freehand', label: 'Pencil', shortcut: 'P' },
  { tool: 'rectangle', label: 'Rectangle', shortcut: 'R' },
  { tool: 'ellipse', label: 'Ellipse', shortcut: 'E' },
  { tool: 'line', label: 'Line', shortcut: 'L' },
];

const colors = [
  ['#facc15', { r: 0.98, g: 0.8, b: 0.08 }],
  ['#fb923c', { r: 0.98, g: 0.57, b: 0.24 }],
  ['#f87171', { r: 0.97, g: 0.44, b: 0.44 }],
  ['#22d3ee', { r: 0.13, g: 0.83, b: 0.93 }],
  ['#60a5fa', { r: 0.38, g: 0.65, b: 0.98 }],
  ['#4ade80', { r: 0.29, g: 0.86, b: 0.5 }],
  ['#18181b', { r: 0.09, g: 0.09, b: 0.11 }],
  ['#ffffff', { r: 1, g: 1, b: 1 }],
] as const;

function findSelectedAnnotation(
  controller: PdfAnnotationController,
): PdfAnnotation | null {
  const { selection } = controller;
  return selection
    ? (controller
        .getAnnotationsForPage(selection.workspacePageId)
        .find((annotation) => annotation.id === selection.annotationId) ?? null)
    : null;
}

function annotationOpacity(annotation: PdfAnnotation | null): number | null {
  if (!annotation) return null;
  switch (annotation.kind) {
    case 'text':
    case 'image':
    case 'signature':
      return annotation.opacity;
    case 'highlight':
      return annotation.fill.opacity;
    case 'freehand':
    case 'line':
      return annotation.stroke.opacity;
    case 'rectangle':
    case 'ellipse':
      return annotation.stroke?.opacity ?? annotation.fill?.opacity ?? null;
  }
}

export function AnnotationToolbar({
  controller,
  redactionController,
}: AnnotationToolbarProps) {
  const {
    activeTool,
    setActiveTool: setAnnotationTool,
    styleDefaults,
    updateStyleDefaults,
    updateSelectedStyle,
    canUndo,
    canRedo,
    undo,
    redo,
    deleteSelected: deleteSelectedAnnotation,
    clearSelection,
    selection,
    pendingImage,
    pendingSignature,
    signatureCreatorOpen,
    openSignatureCreator,
    closeSignatureCreator,
    beginSignatureAsset,
    chooseSignatureUpload,
    cancelPendingImage,
    chooseImage,
    imageError,
    textEditSession,
    updateTextEditSession,
    editSelectedText,
  } = controller;
  const setActiveTool = useCallback(
    (tool: AnnotationTool) => {
      redactionController?.setActive(false);
      redactionController?.select(null);
      setAnnotationTool(tool);
    },
    [redactionController, setAnnotationTool],
  );
  const deleteSelected = useCallback(() => {
    if (redactionController?.selectionId) redactionController.removeSelected();
    else deleteSelectedAnnotation();
  }, [deleteSelectedAnnotation, redactionController]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const opacityInteractionRef = useRef<OpacityInteractionState>(
    IDLE_OPACITY_INTERACTION,
  );
  const selectedAnnotation = findSelectedAnnotation(controller);
  const textContext =
    textEditSession !== null ||
    selectedAnnotation?.kind === 'text' ||
    activeTool === 'text';
  const imageContext =
    selectedAnnotation?.kind === 'image' ||
    activeTool === 'image' ||
    pendingImage !== null ||
    selectedAnnotation?.kind === 'signature' ||
    activeTool === 'signature' ||
    pendingSignature !== null;
  const vectorContext = !textContext && !imageContext;
  const displayedOpacity =
    textEditSession?.opacity ??
    annotationOpacity(selectedAnnotation) ??
    styleDefaults.opacity;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleAnnotationShortcut(event)) return;
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.ctrlKey && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (key === 's') {
        event.preventDefault();
        redactionController?.setActive(false);
        openSignatureCreator();
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (key === 'escape') {
        event.preventDefault();
        if (pendingImage) cancelPendingImage();
        else if (pendingSignature || signatureCreatorOpen) {
          closeSignatureCreator();
          setActiveTool('select');
        } else {
          setActiveTool('select');
          clearSelection();
        }
        return;
      }
      const shortcut = tools.find(
        (item) => item.shortcut.toLowerCase() === key,
      );
      if (shortcut) {
        event.preventDefault();
        setActiveTool(shortcut.tool);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    cancelPendingImage,
    clearSelection,
    deleteSelected,
    pendingImage,
    pendingSignature,
    signatureCreatorOpen,
    closeSignatureCreator,
    openSignatureCreator,
    redo,
    setActiveTool,
    undo,
    redactionController,
  ]);

  useEffect(() => {
    const interaction = opacityInteractionRef.current;
    if (
      interaction.status === 'active' &&
      !sameAnnotationSelection(interaction.target, selection)
    ) {
      opacityInteractionRef.current = IDLE_OPACITY_INTERACTION;
    }
  }, [selection]);

  const updateTextWorkingStyle = (
    patch: Partial<{
      color: RgbColor;
      fontSizeUserUnits: number;
      align: 'left' | 'center' | 'right';
      opacity: number;
    }>,
  ) => {
    if (!textEditSession) return false;
    updateTextEditSession(textEditSession.sessionId, patch);
    return true;
  };
  const updateColor = (color: RgbColor) => {
    updateStyleDefaults({ strokeColor: color, fillColor: color });
    if (!updateTextWorkingStyle({ color })) {
      updateSelectedStyle({ strokeColor: color, fillColor: color });
    }
  };
  const updateWidth = (value: number) => {
    updateStyleDefaults({ strokeWidth: value });
    updateSelectedStyle({ strokeWidth: value });
  };
  const updateFontSize = (value: number) => {
    updateStyleDefaults({ fontSize: value });
    if (!updateTextWorkingStyle({ fontSizeUserUnits: value })) {
      updateSelectedStyle({ fontSize: value });
    }
  };
  const updateTextAlign = (value: 'left' | 'center' | 'right') => {
    updateStyleDefaults({ textAlign: value });
    if (!updateTextWorkingStyle({ align: value })) {
      updateSelectedStyle({ textAlign: value });
    }
  };
  const beginOpacity = () => {
    if (opacityInteractionRef.current.status === 'idle') {
      opacityInteractionRef.current = beginOpacityInteraction(
        textEditSession ? null : selection,
        displayedOpacity,
      );
    }
  };
  const commitOpacity = () => {
    const result = completeOpacityInteraction(opacityInteractionRef.current);
    opacityInteractionRef.current = result.state;
    if (
      result.commit &&
      sameAnnotationSelection(result.commit.target, selection)
    ) {
      updateSelectedStyle({ opacity: result.commit.opacity });
    }
  };
  const cancelOpacity = () => {
    opacityInteractionRef.current = IDLE_OPACITY_INTERACTION;
  };
  const updateOpacity = (value: number) => {
    const wasIdle = opacityInteractionRef.current.status === 'idle';
    updateStyleDefaults({ opacity: value });
    updateTextWorkingStyle({ opacity: value });
    opacityInteractionRef.current = updateOpacityInteraction(
      opacityInteractionRef.current,
      textEditSession ? null : selection,
      value,
    );
    if (wasIdle) commitOpacity();
  };
  return (
    <div
      className="annotation-toolbar"
      role="toolbar"
      aria-label="Annotation tools"
    >
      <div className="annotation-tool-group" aria-label="Annotation tools">
        {tools.map(({ tool, label, shortcut }) => (
          <button
            key={tool}
            type="button"
            className="annotation-tool-button"
            aria-label={`${label} (${shortcut})`}
            aria-pressed={!redactionController?.active && activeTool === tool}
            title={`${label} · ${shortcut}`}
            onClick={() => setActiveTool(tool)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="annotation-tool-button"
          aria-label="Place image"
          aria-pressed={activeTool === 'image'}
          title="Place PNG or JPEG"
          onClick={() => imageInputRef.current?.click()}
        >
          Image
        </button>
        <button
          type="button"
          className="annotation-tool-button"
          aria-label="Create visual signature"
          aria-keyshortcuts="S"
          aria-pressed={activeTool === 'signature' || pendingSignature !== null}
          title="Create visual signature"
          onClick={() => {
            redactionController?.setActive(false);
            redactionController?.select(null);
            openSignatureCreator();
          }}
        >
          Sign
        </button>
        {redactionController ? (
          <button
            type="button"
            className="annotation-tool-button"
            aria-label="Redact"
            aria-pressed={redactionController.active}
            title="Propose permanent redactions for export"
            onClick={() => {
              const nextActive = !redactionController.active;
              if (textEditSession)
                controller.cancelTextEdit(textEditSession.sessionId);
              setAnnotationTool('select');
              clearSelection();
              redactionController.setActive(nextActive);
              if (!nextActive) redactionController.select(null);
            }}
          >
            Redact
          </button>
        ) : null}
        <input
          ref={imageInputRef}
          className="annotation-file-input"
          type="file"
          accept="image/png,image/jpeg"
          aria-label="Choose annotation image"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
              redactionController?.setActive(false);
              redactionController?.select(null);
              void chooseImage(file);
            }
          }}
        />
      </div>
      <div
        className="annotation-tool-group annotation-history-group"
        aria-label="Annotation history"
      >
        <button
          type="button"
          className="annotation-tool-button"
          disabled={!canUndo}
          onClick={undo}
          title="Undo (Ctrl/Cmd+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          className="annotation-tool-button"
          disabled={!canRedo}
          onClick={redo}
          title="Redo (Ctrl/Cmd+Shift+Z)"
        >
          Redo
        </button>
        <button
          type="button"
          className="annotation-tool-button annotation-delete-button"
          disabled={!selection && !redactionController?.selectionId}
          onClick={deleteSelected}
          title={
            redactionController?.selectionId
              ? 'Remove selected pending redaction'
              : 'Delete selected annotation'
          }
        >
          Delete
        </button>
        {selectedAnnotation?.kind === 'text' && !textEditSession ? (
          <button
            type="button"
            className="annotation-tool-button"
            onClick={editSelectedText}
          >
            Edit text
          </button>
        ) : null}
        {pendingImage || pendingSignature ? (
          <span className="annotation-pending" role="status" aria-live="polite">
            Click or drag a page to place{' '}
            {pendingSignature ? 'signature' : 'image'}
          </span>
        ) : null}
      </div>
      <div
        className="annotation-style-controls"
        aria-label="Annotation style"
        hidden={redactionController?.active}
      >
        {!imageContext ? (
          <div className="annotation-color-row" aria-label="Annotation color">
            {colors.map(([hex, color]) => (
              <button
                key={hex}
                type="button"
                className="annotation-color-swatch"
                style={{ backgroundColor: hex }}
                aria-label={`Use ${hex} annotation color`}
                title={`Color ${hex}`}
                onClick={() => updateColor(color)}
              />
            ))}
          </div>
        ) : null}
        {vectorContext ? (
          <label className="annotation-select-label">
            <span>Width</span>
            <select
              aria-label="Annotation stroke width"
              value={styleDefaults.strokeWidth}
              onChange={(event) => updateWidth(Number(event.target.value))}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={4}>4</option>
              <option value={8}>8</option>
            </select>
          </label>
        ) : null}
        {textContext ? (
          <>
            <label className="annotation-select-label">
              <span>Size</span>
              <select
                aria-label="Text font size"
                value={
                  textEditSession?.fontSizeUserUnits ??
                  (selectedAnnotation?.kind === 'text'
                    ? selectedAnnotation.fontSizeUserUnits
                    : styleDefaults.fontSize)
                }
                onChange={(event) => updateFontSize(Number(event.target.value))}
              >
                {[10, 12, 14, 16, 20, 24, 32].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <label className="annotation-select-label">
              <span>Align</span>
              <select
                aria-label="Text alignment"
                value={
                  textEditSession?.align ??
                  (selectedAnnotation?.kind === 'text'
                    ? selectedAnnotation.align
                    : styleDefaults.textAlign)
                }
                onChange={(event) =>
                  updateTextAlign(
                    event.target.value as 'left' | 'center' | 'right',
                  )
                }
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
          </>
        ) : null}
        <label className="annotation-opacity-label">
          <span>Opacity</span>
          <input
            aria-label="Annotation opacity"
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={displayedOpacity}
            onChange={(event) => updateOpacity(Number(event.target.value))}
            onPointerDown={beginOpacity}
            onPointerUp={commitOpacity}
            onPointerCancel={cancelOpacity}
            onKeyDown={(event) => {
              if (isOpacityAdjustmentKey(event.key)) beginOpacity();
            }}
            onKeyUp={(event) => {
              if (isOpacityAdjustmentKey(event.key)) commitOpacity();
            }}
            onBlur={commitOpacity}
          />
        </label>
      </div>
      {imageError ? (
        <div className="annotation-error" role="alert">
          {imageError}
        </div>
      ) : null}
      {signatureCreatorOpen ? (
        <SignatureCreator
          open
          error={imageError}
          onClose={closeSignatureCreator}
          onCreate={beginSignatureAsset}
          onUpload={chooseSignatureUpload}
        />
      ) : null}
    </div>
  );
}
