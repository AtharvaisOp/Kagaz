import { useRef, useState } from 'react';

import { FileIssueList } from './FileIssueList';
import { FileIcon, UploadIcon } from './icons';
import { isPdfFile } from '../lib/pdf';

import type { FileLoadIssue } from '../features/pdf-workspace/loading/types';

interface FilePickerProps {
  readonly compact?: boolean;
  readonly disabled?: boolean;
  readonly issues?: readonly FileLoadIssue[];
  readonly onSelect: (
    files: readonly File[],
    issues: readonly FileLoadIssue[],
  ) => void;
}

function selectFiles(fileList: FileList | readonly File[]): {
  readonly files: readonly File[];
  readonly issues: readonly FileLoadIssue[];
} {
  const files = Array.from(fileList);
  const validFiles: File[] = [];
  const issues: FileLoadIssue[] = [];

  for (const file of files) {
    if (isPdfFile(file)) {
      validFiles.push(file);
    } else {
      issues.push({
        fileName: file.name,
        message: 'This file is not a PDF and was not opened.',
      });
    }
  }

  return { files: validFiles, issues };
}

export function FilePicker({
  compact = false,
  disabled = false,
  issues = [],
  onSelect,
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const chooseFiles = (fileList: FileList | readonly File[]) => {
    const selection = selectFiles(fileList);
    onSelect(selection.files, selection.issues);
  };

  if (compact) {
    return (
      <>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          aria-hidden="true"
          tabIndex={-1}
          disabled={disabled}
          onChange={(event) => {
            chooseFiles(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
          }}
        />
        <button
          className="toolbar-button"
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <FileIcon className="size-4" />
          Add PDF
        </button>
      </>
    );
  }

  return (
    <div className="upload-region">
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="application/pdf,.pdf"
        multiple
        aria-hidden="true"
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          chooseFiles(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
        }}
      />
      <div
        className="upload-panel"
        data-dragging={isDragging || undefined}
        data-disabled={disabled || undefined}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) {
            setIsDragging(true);
          }
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setIsDragging(false);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (!disabled) {
            chooseFiles(event.dataTransfer.files);
          }
        }}
      >
        <div className="upload-icon-shell" aria-hidden="true">
          {isDragging ? (
            <FileIcon className="size-7" />
          ) : (
            <UploadIcon className="size-7" />
          )}
        </div>
        <div>
          <p className="upload-kicker">
            {isDragging ? 'Release to open' : 'Local PDF workspace'}
          </p>
          <h2>
            {isDragging ? 'Drop your PDFs here' : 'Bring documents into focus.'}
          </h2>
          <p className="upload-copy">
            Open one or several PDFs locally, then inspect every page without
            your files leaving this browser.
          </p>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Choose PDF files
          <UploadIcon className="size-4" />
        </button>
        <p className="upload-footnote">PDF only · processed on this device</p>
      </div>
      <FileIssueList issues={issues} />
    </div>
  );
}
