# Devanagari source-removal fixture

`devanagari-positioned-source.pdf` is an immutable synthetic **source** fixture,
not evidence that Kagaz can export Devanagari annotations or watermarks.

- One 500 × 400 PDF-unit page; no rotation or UserUnit override.
- Text: `विद्यार्थी क्षेत्र मराठी भाषा`, font size 32, initial baseline (40, 260).
- The Noto Sans Devanagari Regular subset is embedded. The original font is
  219,212 bytes with SHA-256
  `385e78e6359a9d88a0f243d53b1209d7548361ba2194e2b9ec779bcaa7e8949d`.
- Fontkit 1.1.1 supplies glyph substitutions and positions; individual PDF text
  matrices preserve the returned advances and offsets. A research-only external
  regenerator-runtime shim was required by its Indic shaper. The fixture is
  generated externally, without adding that shim to Kagaz.
- pdf-lib 1.17.1 supplies the subset embedding and its ordinary ToUnicode map.
  Logical extraction remains imperfect for pre-base matras. This limitation is
  documented in `docs/phase5c-font-research.md`.
- PDF SHA-256:
  `6bd10ede38c46de838defdff89a732fab77c2d7e28600f1be494954fcd3752b9`.
- qpdf 12.4.2 `--check` exited 0. PDF size: 5,987 bytes.

The independent Phase 5C verifier proves visible source ink first, then redacts
the whole raw page ({ x: 0, y: 0, width: 500, height: 400 }) and checks final PDF
objects, text extraction and the actual embedded sanitized image. The resulting
page must contain no donor font or text and only the intended new foreground
watermark appearance over sanitized pixels.

The redistributed subset is covered by [OFL-Devanagari.txt](OFL-Devanagari.txt),
copied unmodified from the [official Noto repository license](https://github.com/notofonts/noto-fonts/blob/main/LICENSE).
The source font comes from the [official static TTF](https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf).
Do not advertise this fixture's font as a supported editor font.
