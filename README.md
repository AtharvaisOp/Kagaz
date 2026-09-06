# Kagaz

Kagaz is a browser-first PDF workspace built around a simple rule: when a document operation can happen safely on the user's device, it should. Phase 0 establishes the engineering foundation and delivers a polished local PDF viewer with multi-page rendering, vertical scrolling, lazy page activation, and zoom controls.

PDF files selected in the viewer are read directly by PDF.js in the browser. They are **not uploaded to the Kagaz API**. The API is currently a small deployment-ready foundation for later operations that genuinely require native server tooling.

## Phase 0 capabilities

- Choose or drag and drop a local PDF
- Validate the selected file and report corrupt/unsupported documents
- Render all pages in a vertically scrolling viewer
- Zoom from 50% to 200% in 10% steps
- Replace or close the active document cleanly
- Render nearby pages on demand with `IntersectionObserver`, releasing canvases that move well outside the viewport
- Render canvases at device-aware resolution for crisp output
- Serve a typed `GET /health` endpoint from the API

Merge, split, page editing, annotations, forms, signatures, OCR, conversion, accounts, and persistence are intentionally not part of Phase 0.

## Architecture

Kagaz is a pnpm/Turborepo TypeScript monorepo:

```text
Kagaz/
├── apps/
│   ├── web/                 React, Vite, Tailwind CSS, PDF.js
│   └── api/                 Express and TypeScript
├── packages/
│   └── shared-types/        Cross-application contracts
├── .github/workflows/ci.yml
├── AGENTS.md
├── design.md
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

The web app owns lightweight and privacy-sensitive PDF work. The API is reserved for future workloads that need tools such as Ghostscript, qpdf, Tesseract, or LibreOffice; none are installed in this phase.

## Technology

- Node.js 22.20.0 (minimum supported version: 22.13.0)
- pnpm 12.3.4
- Turborepo
- React 19, Vite, TypeScript, Tailwind CSS
- PDF.js through `pdfjs-dist`
- Express 5
- Docker for the backend deployment path
- GitHub Actions for lint, typecheck, and build verification

## Local development

Prerequisites: Node.js 22.13 or newer and Corepack.

```bash
corepack enable
pnpm install
pnpm dev
```

The web app defaults to [http://localhost:5173](http://localhost:5173), and the API defaults to [http://localhost:4000](http://localhost:4000). The viewer does not require the API.

Useful repository commands:

```bash
pnpm dev          # run web and API development servers
pnpm lint         # lint every workspace
pnpm typecheck    # typecheck every workspace
pnpm build        # build every workspace
pnpm format:check # check repository formatting
```

To run only one application:

```bash
pnpm --filter @kagaz/web dev
pnpm --filter @kagaz/api dev
```

### API environment

Copy `apps/api/.env.example` to `apps/api/.env` when custom local values are needed.

| Variable       | Required | Default                 | Purpose                                                      |
| -------------- | -------- | ----------------------- | ------------------------------------------------------------ |
| `PORT`         | No       | `4000`                  | HTTP port; hosting platforms may provide this automatically. |
| `CORS_ORIGINS` | No       | `http://localhost:5173` | Comma-separated browser origins allowed to call the API.     |

No secrets are required in Phase 0.

## Production builds

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
```

The web output is written to `apps/web/dist`. The compiled API entry point is `apps/api/dist/index.js`.

## Deploy the frontend to Vercel

Do not create a separate frontend repository. Configure the monorepo from its root:

1. In Vercel, choose **Add New → Project** and import `AtharvaisOp/Kagaz`.
2. Select the `main` branch.
3. Set **Root Directory** to the repository root (`./`), not `apps/web`.
4. Select **Vite** as the framework preset.
5. Set **Node.js Version** to `22.x`.
6. Set **Install Command** to `pnpm install --frozen-lockfile`.
7. Set **Build Command** to `pnpm --filter @kagaz/web build`.
8. Set **Output Directory** to `apps/web/dist`.
9. No frontend environment variables are required for Phase 0.
10. Deploy, then verify the upload flow at the assigned Vercel domain.

The root `packageManager` field pins pnpm, so Vercel can use Corepack consistently. If Vercel offers an "Include source files outside of the Root Directory" option, it is irrelevant with the repository-root configuration above.

## Deploy the backend to Render

Create the backend as a Docker web service so later phases can add native PDF binaries without replacing the deployment model:

1. In Render, choose **New → Web Service** and connect `https://github.com/AtharvaisOp/Kagaz`.
2. Select branch `main` and runtime **Docker**.
3. Use the repository root as the Docker build context.
4. Set **Dockerfile Path** to `apps/api/Dockerfile`.
5. Leave the Docker command blank; the image starts `node dist/index.js`.
6. Add `CORS_ORIGINS` with the exact deployed Vercel origin, for example `https://kagaz.example.vercel.app`. Multiple origins may be comma-separated.
7. Render supplies `PORT`; the API reads it automatically. No manual `PORT` value is normally needed.
8. Set **Health Check Path** to `/health`.
9. Deploy and verify `https://<render-service>.onrender.com/health` returns `status: "ok"`.

When the final Vercel domain changes, update `CORS_ORIGINS` in Render and redeploy the service. Do not add a trailing slash to origins.

To test the same image locally from the repository root:

```bash
docker build -f apps/api/Dockerfile -t kagaz-api .
docker run --rm -p 4000:4000 -e PORT=4000 -e CORS_ORIGINS=http://localhost:5173 kagaz-api
```

## Privacy model

The browser receives the PDF as a `File`, converts it to an in-memory byte array, and passes it directly to the bundled PDF.js worker. No object URL or network request is created for the document. Replacing or closing a PDF cancels active page renders and destroys the previous PDF.js document so its resources can be released. Page canvases are also cancelled and cleared after moving beyond an observer margin, which bounds rendering work as the user moves through a large document.

## Project status

Phase 0 is the viewing infrastructure only. The planned sequence adds client-side page operations, annotations, forms and signatures, then carefully scoped server-backed conversion/OCR work. The hybrid architecture and package boundaries established here should remain the default unless a later requirement provides a concrete reason to change them.
