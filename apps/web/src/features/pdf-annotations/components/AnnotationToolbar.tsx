import { useEffect, useRef } from 'react';

import type { PdfAnnotationController } from '../hooks/usePdfAnnotations';
import type { AnnotationTool } from '../model/editorTypes';
import { shouldHandleAnnotationShortcut } from './annotationShortcuts';
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
}

const tools: readonly {
  tool: AnnotationTool;
  label: string;
  shortcut: string;
}[] = [
  { tool: 'select', label: 'Select', shortcut: 'V' },
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

export function AnnotationToolbar({ controller }: AnnotationToolbarProps) {
  const {
    activeTool,
    setActiveTool,
    styleDefaults,
    updateStyleDefaults,
    updateSelectedStyle,
    canUndo,
    canRedo,
    undo,
    redo,
    deleteSelected,
    clearSelection,
    selection,
  } = controller;
  const opacityInteractionRef = useRef<OpacityInteractionState>(
    IDLE_OPACITY_INTERACTION,
  );

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
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (key === 'escape') {
        event.preventDefault();
        setActiveTool('select');
        clearSelection();
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
  }, [clearSelection, deleteSelected, redo, setActiveTool, undo]);

  useEffect(() => {
    const interaction = opacityInteractionRef.current;
    if (
      interaction.status === 'active' &&
      !sameAnnotationSelection(interaction.target, selection)
    ) {
      opacityInteractionRef.current = IDLE_OPACITY_INTERACTION;
    }
  }, [selection]);

  const updateColor = (color: (typeof colors)[number][1]) => {
    updateStyleDefaults({ strokeColor: color, fillColor: color });
    updateSelectedStyle({ strokeColor: color, fillColor: color });
  };
  const updateWidth = (value: number) => {
    updateStyleDefaults({ strokeWidth: value });
    updateSelectedStyle({ strokeWidth: value });
  };
  const beginOpacity = () => {
    if (opacityInteractionRef.current.status === 'idle') {
      opacityInteractionRef.current = beginOpacityInteraction(
        selection,
        styleDefaults.opacity,
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
    opacityInteractionRef.current = updateOpacityInteraction(
      opacityInteractionRef.current,
      selection,
      value,
    );
    if (wasIdle) {
      commitOpacity();
    }
  };

  return (
    <div
      className="annotation-toolbar"
      role="toolbar"
      aria-label="Annotation tools"
    >
      <div className="annotation-tool-group" aria-label="Drawing tools">
        {tools.map(({ tool, label, shortcut }) => (
          <button
            key={tool}
            type="button"
            className="annotation-tool-button"
            aria-label={`${label} (${shortcut})`}
            aria-pressed={activeTool === tool}
            title={`${label} · ${shortcut}`}
            onClick={() => setActiveTool(tool)}
          >
            {label}
          </button>
        ))}
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
          disabled={!selection}
          onClick={deleteSelected}
          title="Delete selected annotation"
        >
          Delete
        </button>
      </div>
      <div className="annotation-style-controls" aria-label="Annotation style">
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
        <label className="annotation-opacity-label">
          <span>Opacity</span>
          <input
            aria-label="Annotation opacity"
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={styleDefaults.opacity}
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
    </div>
  );
}
