# Kagaz

Kagaz is a browser-first PDF workspace for combining and arranging documents
locally. Open one or several PDFs, inspect their pages, reorder them, rotate or
delete pages, extract a range, and download the result without sending PDF
bytes to a server.

## Phase 1 capabilities

- Open one or multiple PDF files, including drag-and-drop selection
- Keep valid files when a mixed selection contains invalid files
- View multi-page documents with lazy, viewport-aware rendering
- Navigate with the page manager and stable page identities
- Reorder pages with drag-and-drop or Move Up/Move Down controls
- Rotate pages in 90-degree increments
- Delete pages while protecting the final page in a workspace
- Add more PDFs to an existing workspace, including duplicate selections
- Merge sources according to the current workspace order
- Extract single pages, inclusive ranges, and comma-separated page expressions
- Download edited, merged, or extracted PDFs
- Keep PDF editing and export browser-local

The current workspace is intentionally lightweight: zoom is display state,
while page order, deletion, rotation, and selection are logical workspace
state. Start Over protects workspace, annotation, and meaningful in-progress
editor work with one discard confirmation.

## Phase 2 annotation capabilities

- Create and edit text, highlight, freehand, rectangle, ellipse, line, and
  image annotations
- Move, resize, style, select, delete, and undo/redo annotation edits
- Add PNG or JPEG images locally without uploading source bytes
- JPEGs containing non-default camera orientation metadata are rejected until
  they are saved or rotated normally
- Preview annotations in the page manager thumbnails and in a compact semantic
  annotation list for the current page
- Flatten all seven annotation kinds into browser-local Download and Extract
  output while preserving page order, rotation, and z-order

Text export currently uses PDF Standard Helvetica. Characters that Helvetica
cannot encode are rejected with an actionable export error rather than being
silently replaced.

## Privacy-first architecture

PDF source files stay in the browser for current Phase 1 operations. The
backend is not involved in PDF editing or export.

```text
Browser
│
├─ SourceDocumentRegistry
│    └─ PDF.js source documents and loading lifecycle
│
├─ WorkspacePage[]
│    └─ order, source page, rotation, selection
│
├─ Thumbnail / main viewer
│
└─ pdf-lib export
     └─ browser-local Blob download

Backend
└─ Express /health foundation for future server-heavy work
```

PDF.js is responsible for preview and rendering. The workspace and annotation
reducers store serializable logical edits. The source registry owns browser
`File` objects and PDF.js runtime resources, while the annotation asset
registry owns decoded PNG/JPEG runtime assets and their object URLs. The export
layer snapshots the required source files and annotation assets by stable IDs,
then lazy-loads pdf-lib only when creating output bytes in the browser.

## Technology

- React 19, Vite, TypeScript, and Tailwind CSS
- PDF.js through `pdfjs-dist`
- `pdf-lib` for browser-local output generation
- `@dnd-kit/react` for page reordering
- Vitest for deterministic model, lifecycle, and export tests
- pnpm workspaces and Turborepo
- Express 5 and Docker for the API foundation
- GitHub Actions, Vercel, and Render deployment paths

## Local development

Prerequisites: Node.js 22.13 or newer and pnpm 12.3.4.

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

The web app runs at `http://localhost:5173`; the API defaults to
`http://localhost:4000`. Phase 1 PDF editing does not require the API.

Run one application directly when useful:

```bash
pnpm --filter @kagaz/web dev
pnpm --filter @kagaz/api dev
```

The web production output is written to `apps/web/dist`. The API entry point
is `apps/api/dist/index.js`.

## API environment

Copy `apps/api/.env.example` to `apps/api/.env` only when custom local values
are needed.

| Variable       | Default                 | Purpose                                               |
| -------------- | ----------------------- | ----------------------------------------------------- |
| `PORT`         | `4000`                  | API listening port; hosting platforms may provide it. |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated API origins.                          |

No secrets are required for the current browser-local workflow.

## Deployment

### Vercel

The intended frontend configuration uses the repository root:

- Repository: `AtharvaisOp/Kagaz`
- Root Directory: `./`
- Framework: Vite
- Node.js: 22.x
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm --filter @kagaz/web build`
- Output Directory: `apps/web/dist`

The configured production-origin candidate is
`https://kagaz-personal.vercel.app`. The repository does not require a
frontend API environment variable for Phase 1.

During the final Phase 1 audit, that domain was reachable but still served
the older single-document viewer. Promote the latest `main` deployment before
using it as the Phase 1 product URL. The previously known preview URL was
Vercel-authenticated in the audit environment.

### Render

The API service is `kagaz-api` at
`https://kagaz-api.onrender.com`. Its health endpoint is:

```text
https://kagaz-api.onrender.com/health
```

The Render Blueprint uses the `main` branch, Docker, the Singapore region,
and `/health` as its health check. `CORS_ORIGINS` is configured for the
intended production frontend origin. Render is reserved for future operations
that genuinely need native tooling.

## Current limitations

- Password-protected PDFs cannot be opened; password entry is not available.
- There is no persistence or cloud collaboration yet.
- Forms, signatures, OCR, compression, and conversion are not implemented.
- Canvas annotations are projected visually; the current-page semantic list is
  the keyboard and screen-reader path for existing annotations.
- Text export is limited to glyphs supported by Standard Helvetica; custom
  font embedding is not implemented.
- There are no accounts, cloud storage, or collaboration features.
- Very large PDFs may create browser memory pressure.
- The page-copy export workflow may not preserve every document-level feature,
  such as outlines or advanced interactive structures.

## Roadmap

- Phase 2 — annotations (complete)
- Phase 3 — forms and signatures
- Phase 4 — server-backed heavy processing such as OCR and conversion

The browser-local architecture remains the default for operations that can be
performed safely on the device.
