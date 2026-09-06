import { useRef, useState } from 'react';

import { FileIcon, UploadIcon } from './icons';
import { isPdfFile } from '../lib/pdf';

interface FilePickerProps {
  compact?: boolean;
  error?: string | null;
  onError: (message: string | null) => void;
  onSelect: (file: File) => void;
}

export function FilePicker({
  compact = false,
  error,
  onError,
  onSelect,
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const chooseFile = (file: File | undefined) => {
    if (!file) {
      return;
    }

    if (!isPdfFile(file)) {
      onError('Choose a PDF file. Other file formats are not supported yet.');
      return;
    }

    onError(null);
    onSelect(file);
  };

  if (compact) {
    return (
      <>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="application/pdf,.pdf"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            chooseFile(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        <button
          className="toolbar-button"
          type="button"
          onClick={() => inputRef.current?.click()}
        >
          <FileIcon className="size-4" />
          Replace PDF
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
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          chooseFile(event.target.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      <div
        className="upload-panel"
        data-dragging={isDragging || undefined}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
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
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          chooseFile(event.dataTransfer.files[0]);
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
            {isDragging ? 'Release to open' : 'Local PDF viewer'}
          </p>
          <h2>
            {isDragging ? 'Drop your PDF here' : 'Bring a document into focus.'}
          </h2>
          <p className="upload-copy">
            View every page, inspect the details, and zoom in without your file
            leaving this browser.
          </p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => inputRef.current?.click()}
        >
          Choose a PDF
          <UploadIcon className="size-4" />
        </button>
        <p className="upload-footnote">PDF only · processed on this device</p>
      </div>
      {error ? (
        <div className="inline-alert" role="alert">
          <span aria-hidden="true">!</span>
          {error}
        </div>
      ) : null}
    </div>
  );
}
