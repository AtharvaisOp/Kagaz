# Bounded native PDF text editing

Kagaz can make a genuine edit to a very small, verified subset of existing PDF
text. This is intentionally not a general-purpose PDF word processor. A source
text edit replaces the original `Tj` operand in page content; it is never a
white rectangle, annotation, or preview-only overlay.

## Why this needs a separate pipeline

PDF.js provides the rendered text layer used for selection and copying. Its
extracted strings do not identify the exact content-stream operand that produced
them. `pdf-lib` can load, copy, and save objects, but does not offer a safe
general content-stream editor. Kagaz therefore uses a small parser and
transformer rather than pretending that a selected browser string is mutable
source text.

The pipeline is deliberately fail-closed:

1. The PDF.js text layer supplies a complete user selection.
2. A fresh `pdf-lib` parse proves the ordered PDF.js/raw-run sequence and maps
   the selected visual item to its exact source-run ordinal. It records a
   SHA-256 source-file fingerprint, decoded-stream fingerprint, Standard-14
   font identity, size, and text matrix.
3. The staged edit is workspace-local and participates in the existing
   immutable editor history. The original `File` and its source document are
   never changed.
4. On export, Kagaz reads the source again and verifies its file fingerprint,
   content stream, font, ordinal, text, and matrix before copying the requested
   page occurrence into a private temporary document.
5. It replaces only verified byte ranges for the literal `Tj` operand and the
   `e`/`f` translation terms of that run's `Tm`. The rewritten stream is parsed
   and verified before the isolated page is copied into the final reconstructed
   output.

This is a sanitized reconstruction/page-copy export, not an incremental update
to the original PDF. Page order, duplicate workspace occurrences, rotation,
annotations, and normal export behavior remain owned by the existing exporter.

## Exact supported subset

All of these conditions must hold.

- The selected source page has one direct `/Contents` raw stream, and that
  stream has exactly one reference in the PDF object graph.
- The stream is unfiltered or `FlateDecode` without `/DecodeParms`, is at most
  256 KiB compressed and 1 MiB decoded, and inflates within a five-second
  bound.
- The entire decoded stream consists only of balanced `q`/`Q` and independent
  `BT`/`ET` objects of this exact logical form:

  ```pdf
  BT
  /FontResource 12 Tf
  1 0 0 1 x y Tm
  (printable ASCII text) Tj
  ET
  ```

- Each text object has one `Tf`, one identity `Tm`, and one literal `Tj`.
  Text is printable ASCII, 1–512 characters. The browser selection must be
  exactly one complete rendered PDF.js `TextItem`; Kagaz proves the complete
  ordered sequence of non-empty PDF.js items has the same text and
  `[fontSize, 0, 0, fontSize, x, y]` values as the parsed runs before it maps
  that item to a source operand. Partial, cross-run, normalized, merged, or
  split selections are rejected. The selected literal must occur only once in
  the strict page stream, so removal can be proved from the exported text and
  content streams.
- The page explicitly defines `/Resources`, whose only keys are `/Font` and
  optional `/ProcSet`. Its run font is an unembedded Standard-14 Type1 Courier,
  Helvetica, or Times variant with Standard, WinAnsi, or MacRoman encoding. The
  resource and font dictionaries may be indirect, but they are only read and
  never modified.
- Replacement text uses the same printable-ASCII bound. Repositioning changes
  only the original PDF-user-space `x`/`y` values, before page rotation. A
  page `/UserUnit` must be absent or exactly `1`.
- Multiple independently verified runs on one page may be staged, but they are
  resolved from the original stream and rewritten atomically.

Within this subset, the retained source font and content operator produce
searchable text after export. Shorter and longer replacements are valid; Kagaz
does not claim automatic reflow, line wrapping, kerning, or collision avoidance.

## Explicitly unsupported

Kagaz rejects the operation, without changing workspace state or source bytes,
for scans, outlines, raster images, OCR text that cannot meet the stream subset,
and arbitrary vector artwork. It also rejects:

- `TJ`, quote operators, `Td`/`TD`, `T*`, text spacing/scaling/rise/render-mode
  operators, `cm`, `Do`, clipping, marked content, paths, comments, arrays,
  non-identity matrices, or any other content operator;
- embedded, subset, CID/Type0, custom, Unicode-mapped, or otherwise unverifiable
  fonts; complex shaping, RTL scripts, emoji, and non-Latin text;
- inherited or multiple content streams, shared streams, XObjects, unexpected
  resource types, repeated literals, unprovable merged or split PDF.js runs,
  malformed input, and inputs that exceed parser/decompression limits;
- encrypted, signed, JavaScript-bearing, or AcroForm PDFs; source pages with a
  pending redaction; cancelled verification; and sources whose bytes changed
  after selection.

The UI reports the safe reason, for example that the selected text must be one
complete verified Latin source run, rather than claiming the document was edited.

## Integrity and security boundaries

Source identity is verified twice: when selection becomes a draft and again
immediately before export. The exporter also repeats the source file limit and
the native document graph limit before signature/action traversal, checks the
actual AcroForm catalog rather than relying only on a cached form snapshot, and
rejects a native edit where a redaction is pending. Abort signals,
compressed/decoded size limits, token limits, character limits, and a bounded
inflate deadline apply during inspection. The source file is capped at 25 MiB;
native inspection permits at most 10,000 indirect objects, 50,000 direct graph
nodes, and 100,000 nodes while proving source-stream ownership.

Only the private copied page is mutated. Its output stream is reparsed and
checked for each replacement and adjusted matrix before it enters the final
document. This prevents an eligible page occurrence from retaining the replaced
operand in its live page content. If a user intentionally keeps a second,
unmodified duplicate page, that independent page naturally still contains its
own original text; editing one workspace occurrence never silently edits the
other.

The source parser rejects PDF comments so an old sentinel cannot merely survive
as an inert comment. It does not mutate shared resources. Resource ownership is
not required because the final output receives a copied private page and the
feature never writes a resource dictionary.

## Verification design

The deterministic unit/export fixtures create raw source streams and inspect
the actual saved PDF bytes. They verify shorter and longer replacements,
movement, multiple runs on one page, intrinsic cardinal rotations, duplicate
page isolation, source identity mismatch, real AcroForms, redaction conflicts,
signature-like structures, comments, `TJ`, and shared-stream rejection.

For unique test sentinels, every decoded raw stream in the saved output is
searched to prove the old operand is absent. The output is also reopened with
PDF.js to verify logical extraction, while parsed stream matrices verify the
requested position. Browser verification separately exercises the inline editor
and renders the exported PDF so visual behavior is checked in addition to the
byte-level and logical checks.

## Next extension, if needed

The next safe expansion would add one explicitly modeled operator pattern at a
time, beginning with an independently addressable simple-font run using a
non-identity but provably invertible text matrix. It needs new byte-level,
logical-extraction, and rendered-output fixtures before it is enabled. Supporting
general `TJ`, subset fonts, Form XObjects, shaping, or layout reflow requires a
different content-layout engine and a separate security review; it must not be
silently broadened from this subset.
