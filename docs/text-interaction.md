# Checkpoint A — PDF text interaction

Status: PASS for selectable source text and highlighting. A separately bounded
native source-text edit mode is now available only for verified simple Latin
`Tj` runs; it is not universal PDF text editing. See
[native-text-editing.md](native-text-editing.md) for the exact contract.

## Reproduced cause and implementation

`PdfPage` rendered only a PDF.js canvas. The full-page Konva canvas also consumed
pointer events in empty space. Neither a canvas nor extracted strings constitute
a selectable text layer.

`PdfTextLayer` now streams text into the installed PDF.js TextLayer with the same
viewport as the completed page render. CSS implements that version's font,
scale, crop-origin and rotation contract, independently of canvas device pixels.
Only near-viewport pages mount layers; cancellation and shared page leases prevent
cleanup during extraction and discard obsolete layers on zoom/rotation/unload.
Workspace page IDs, not source indices, own highlights, including repeat imports.

Normal Select permits text selection between annotation hit regions. Select PDF
text explicitly passes through all annotations, including existing highlights;
form controls retain priority. Selecting an annotation in the semantic list
restores object interaction. Highlight selects text above the creation canvas;
dragging blank space still creates the original manual rectangle.

Selection ranges are intersected with individual PDF.js text runs, then converted
from CSS client rectangles through the actual viewport to canonical PDF boxes.
One page's selected fragments are committed in one history transaction. Export
uses the existing validated highlight drawing and redaction pipeline, with no
new document mutation format or upload. A selection is limited to 1,000 fragments
per page; larger selections receive an accessible message rather than a partial
highlight. Multi-page selections commit one transaction per participating page.

## Text classes and safe editing boundary

| Class                                             | Supported behavior                                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Embedded source characters with usable extraction | Select, copy and highlight. A narrow verified Standard-14 `Tj` subset may also be genuinely replaced or moved; see the native-editing contract.                 |
| Kagaz text annotation in the current workspace    | Select, drag, resize, edit, style, undo/redo, export as real drawn PDF text. After reopening an export it is source text, not a recoverable Kagaz edit session. |
| OCR invisible text                                | Select/copy if exposed by PDF.js; recognition may be wrong and does not make the visible scan editable.                                                         |
| Rasterized or outlined characters                 | No character selection without usable recognition; manual highlighting remains available.                                                                       |

PDF.js still supplies only selection/copy UI, not mutable PDF operand identity.
The native edit mode adds a separate bounded content-stream parser to bridge that
gap. It resolves the owning stream and literal operand, records source/stream
identity, rewrites a private copied page only after revalidation, and reparses
the result. It rejects shared/nested Form XObjects, encodings and subset fonts,
text matrices, kerning, clipping, and reading-order patterns outside its tiny
grammar. No white-rectangle replacement is implemented. The full supported and
unsupported set is intentionally maintained in
[native-text-editing.md](native-text-editing.md).

Highlights are visible annotations, never secure removal. Pending redactions do
not alter source bytes; only the existing sanitized export removes source content
on affected pages. Native source editing and redaction cannot be staged on the
same page, so neither workflow can make an ambiguous removal claim.

## Design and files

`design.md` was read completely. Inter/JetBrains Mono, dark surfaces, orange
actions, cyan selection/focus, existing controls and responsive page scrolling
remain. The required `gpt-taste` skill was read and applied to immediate selection
feedback, restrained hover/focus and useful status messaging. Its landing-page
randomization, typography and GSAP prescriptions conflict with the explicit
no-redesign task and repository design precedence, so were not applied. Selection
does not animate; existing reduced-motion rules remain.

Important changes: `features/pdf-viewer/{PdfTextLayer,textSelection,PdfPage,PdfViewer}`,
annotation overlay/hit-region geometry, batch history/controller, toolbar copy,
scoped CSS, browser regression script and CI integration. No dependency changes.

## Validation

- Focused geometry/history tests: 6 passed, including 0/90/180/270 degrees,
  scaled CSS surfaces, negative crop origin and UserUnit.
- Web regression suite: 888 passed across 86 files.
- `node scripts/verify-text-interaction.mjs`: passed. Real Chromium drag and
  clipboard copy, multiline highlighting, atomic undo/redo, manual highlight,
  zoom/rotation, form fill, text double-click/drag and semantic move/resize/edit,
  duplicate imports, reorder, lazy/mixed/scanned pages, download/reopen and no POST.
- Desktop and 390px mobile screenshots inspected; page-width horizontal scrolling
  is retained for zoomed documents. Synthetic artifacts stay outside Git under
  `C:/Users/athar/.codex/kagaz-reliability-artifacts/text-interaction` locally.
- Repository `pnpm lint`, `pnpm typecheck`, `pnpm build`: passed after repairing
  an external pnpm launcher. Existing large-chunk and ineffective-dynamic-import
  build warnings remain; no new bundle dependency was introduced.
- Full Linux/native/container/emulator verification runs in the PR CI. Local
  checks do not substitute for its final status.

## Acceptance checklist

- [x] Inspect lifecycle, transforms, overlays, extraction and export.
- [x] Implement selectable aligned PDF.js layer and multiline copying.
- [x] Handle zoom, cardinal rotation, reorder, repeated sources, scrolling/laziness.
- [x] Keep selection separate from annotation gestures, redactions and forms.
- [x] Persist text-aligned highlights; preserve manual rectangles.
- [x] Distinguish source, Kagaz annotations, invisible OCR and raster/outline text.
- [x] Verify existing annotation selection/move/resize/edit and undo/redo.
- [x] Investigate genuine source editing and provide a bounded future proposal.
- [x] Preserve source safety and sanitized redaction export.
- [x] Add focused and browser regression coverage plus CI integration.

No production deployment is performed by this checkpoint. Review and merge its
separate PR after CI; existing main deployments remain unchanged. Next agents
must retain the scoped PDF.js CSS contract and explicit annotation/text hit
priority, and must never describe highlighting as removal or OCR as editing.
