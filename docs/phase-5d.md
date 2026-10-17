# Phase 5D — Performance and memory baseline

## Result

The scoped performance review passed without runtime changes. Current visible
page rendering is bounded, repeated exports remained stable, and Start Over
released PDF.js workers and canvas backing stores in the supported Chromium
verification. No measured bottleneck justified a rendering or export rewrite.

## Reproduction

With the web app serving locally, run `node scripts/measure-phase5d.mjs`. The
default URL is `http://127.0.0.1:5173`; set `KAGAZ_APP_URL` to use a production
preview instead. For that pass, build first and serve `apps/web/dist`, for
example with `pnpm --filter @kagaz/web preview --host 127.0.0.1 --port 4173`.
Set these variables:

- `KAGAZ_ARTIFACT_DIR` set to an existing directory outside the repository.
- `KAGAZ_PLAYWRIGHT_MODULE` set to the installed Playwright module directory.
- `KAGAZ_CHROME_PATH` set to a Playwright Chromium executable when it is not on
  the default Playwright path.

The script generates synthetic PDFs, measures a 100-page three-export session,
then loads three copies as a 300-page workspace and checks cleanup after Start
Over. It records results to `phase5d-repeated-export-results.json` in the
artifact directory. `scripts/verify-phase3g.mjs` adds the 80-page AcroForm case,
page/thumbnail counts, rotation output checks, mobile regression checks and
privacy assertions.

## Measurements

Host: Windows, Node 22.17.1, Playwright 1.62.1, Chromium 153.0.8010.12
(Playwright revision 1243), Vite development server, 1440×1100 viewport, DPR 1.
The browser and development server were local. These are repeatable host
observations, not production service targets.

| Scenario                      |    Load/discovery |       Export |          Output |                                Active canvases | Canvas backing estimate |                 JS heap after forced GC |
| ----------------------------- | ----------------: | -----------: | --------------: | ---------------------------------------------: | ----------------------: | --------------------------------------: |
| 100 plain pages               |          1,387 ms |       326 ms |        23,727 B | 4 ready main pages, 6 ready thumbnail surfaces |  not separately sampled |                                 87.7 MB |
| 80 form pages                 |          1,482 ms |       566 ms |        75,676 B | 4 ready main pages, 6 ready thumbnail surfaces |  not separately sampled |                                108.7 MB |
| 100 pages, 3 repeated exports | existing document |   328–398 ms | 24,765–24,767 B |               14 nonzero-sized canvas elements |                  5.1 MB | 46.8–49.5 MB across post-export samples |
| 3 × 100-page sources          |          2,170 ms | not measured |  not applicable |               14 nonzero-sized canvas elements |                  5.1 MB |                                 63.0 MB |

The Phase 3G page/thumbnail numbers count canvases whose render state is ready;
the repeated-export harness counts canvas elements with nonzero backing
dimensions. The harness separately reports all canvas elements (303 for one
100-page source, 903 for three), including zero-sized offscreen canvases. Only
14 had nonzero dimensions during the 300-page run. The measured DOM had 18,263
nodes with three sources; visible rendered surfaces remained bounded.

After Start Over, the three-source run had zero workers, zero canvas elements,
zero canvas backing estimate, 179 DOM nodes, and a 38.7 MB JavaScript heap
sample. The 100-page repeated-export run likewise returned to zero workers and
canvases, 136 DOM nodes and a 37.6 MB heap sample. Export samples did not show a
monotonic heap increase after forced garbage collection.

Two production-preview runs used fresh Chromium contexts against the local Vite
preview server. The app reached its upload layout in 138–141 ms; the navigation
`load` event took 73–78 ms. One JavaScript entry transferred 255,943 bytes
(encoded body 255,643 bytes). Paint timing was unavailable in these headless
samples. Production-preview exports took 197–334 ms, and the three-source
workspace loaded in 1,177–1,181 ms with 15,002–17,074 DOM nodes. Start Over
returned workers and canvas elements to zero. These local timings do not
include public-network or Vercel edge latency.

Heap values are Chromium `performance.memory.usedJSHeapSize` after CDP
`HeapProfiler.collectGarbage`; they describe JavaScript heap, not renderer
process RSS, GPU memory, a peak, or a leak proof. Canvas backing estimates use
`width × height × 4` and are accounting estimates, not observed hardware
allocations. The run did not expose reliable Windows browser-process RSS, so
that figure is not claimed. The PDFs are synthetic text-only documents; complex
image-heavy or unusually structured files may behave differently.

## Optimization decision

The current 100-page view rendered 4 main pages and 6 thumbnails in the
Phase 3G verifier. The 300-page test retained only 14 nonzero-sized canvases,
and teardown destroyed all three PDF.js workers and released all canvas
backing dimensions. Three exports stayed within a 70 ms range and showed no
monotonic retained-heap growth. Those results do not support replacing the
current page lifecycle, worker model, or export path. The remaining linear DOM
growth is measurable, but the 300-page workspace completed in 2.2 seconds and
did not demonstrate a responsiveness failure; retain it as a future profiling
target if real documents show a user-visible threshold.

No PDF fidelity, text extraction, redaction, cancellation, or bounded-resource
policy was changed.
