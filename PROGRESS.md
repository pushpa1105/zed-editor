# Progress / resume notes

_Last updated: 2026-11-21 (session 1, in progress)_

## How to run

```sh
pnpm install
pnpm build                       # packages/zeditor: ESM entries + browser bundle + CSS + d.ts
pnpm test                        # unit + randomized tests (vitest, Node)
pnpm --filter @z-packages/zeditor exec playwright install chromium firefox webkit   # once
pnpm test:browser                # Playwright: Chromium, Firefox, WebKit
pnpm playground                  # http://127.0.0.1:4173/  (playground + examples/html)
```

Fast rebuild while iterating on browser tests: `cd packages/zeditor && SKIP_TYPES=1 node build.mjs`.

## State

| Milestone | Status |
| --- | --- |
| 1. Engine, native input, serialization, selection, history, both modes, plain HTML example | done, tested |
| 2. Extension API, default UI, React/Vue adapters, three customization examples | adapters written; examples in progress |
| 3. Advanced blocks, tables, rich clipboard, media, import/export | done, tested |
| 4. Collaboration, comments, suggestions, offline recovery, version history | comments / suggestions / versions / autosave done; Yjs collab module not started |
| 5. Feature matrix, browser compat, benchmarks, packed release verification | not started |

See FEATURE_MATRIX.md for per-capability status and evidence (to be written in milestone 5).

## Notes for whoever resumes

- Shell heredocs are unreliable in this environment; write files with an editor tool or a script file.
- Package name is `@z-packages/zeditor` because `zeditor` is taken on npm. Renaming is a search/replace.
- Moves are remove+insert steps: `Block` objects are re-created, so never hold a `Block` across a
  `tr.move` / `tr.remove`+`tr.insert`; look it up again by id.
