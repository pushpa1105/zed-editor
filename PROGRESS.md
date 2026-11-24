# Progress / resume notes

_Last updated: 2026-11-25, end of session 3._

## State

All five milestones of the brief have a working, tested implementation. Nothing is known to be
failing. npm publication has **not** been done (owner action).

| Milestone | Status |
| --- | --- |
| 1. Engine, native input, serialization, selection, history, both modes, plain HTML example | done |
| 2. Extension API, default UI, React / Vue adapters, three customization examples | done |
| 3. Advanced blocks, tables, rich clipboard, media, import / export | done |
| 4. Collaboration, comments, suggestions, offline recovery, version history | done |
| 5. Feature matrix, browser compatibility, benchmarks, packed-release verification | done |
| Added on request: multi-page documents (page tabs, sheet view, page breaks) | done |
| Added on request: SEO / SSR rendering, tree-shakeable packaging, performance work | done |
| Added on request (session 2): Notion-style databases (table / board / list / gallery, typed properties, filters, sorts, grouping, calculations, rows as pages) and workspace blocks (table of contents, bookmarks, page links, dates, template buttons, toggle headings) | done — see docs/databases.md |
| Added on request (session 3): formula / relation / rollup properties, custom property types, calendar and timeline views, match-any filters, column resize and drag reorder, card reordering, redesigned database UI and scrollbars, toolbar Insert menu, sub-pages with breadcrumbs, synced copies | done — see docs/databases.md |

Per-capability status, evidence and the list of known gaps: [FEATURE_MATRIX.md](FEATURE_MATRIX.md).

## Last verified results (this machine, 2026-11-25)

| Check | Command | Result |
| --- | --- | --- |
| Type check | `pnpm typecheck` | clean |
| Unit + randomized + collaboration | `pnpm test` | 103 passed |
| Browser | `pnpm test:browser` | 203 passed, 4 skipped, 0 failed (69 tests × Chromium, Firefox, WebKit; skips are the CDP IME test and the OS-clipboard test outside Chromium) |
| Packed release | `pnpm pack:verify` | 10 / 10 checks passed (`docs/pack-verify.json`) |
| Benchmarks | `pnpm bench` | `docs/benchmarks.md` |

## How to run

```sh
pnpm install
pnpm build
pnpm --filter @z-packages/zeditor exec playwright install chromium firefox webkit   # once
pnpm check             # build, typecheck, unit, browser (builds examples), pack verify
pnpm playground        # http://127.0.0.1:4173/
```

Fast rebuild while iterating on browser tests: `cd packages/zeditor && SKIP_TYPES=1 node build.mjs`.
Browser tests load `packages/zeditor/dist` and `examples/*/dist`, so rebuild before running them.

## Failing tests

None.

## Next unfinished tasks (in suggested order)

These are gaps, not regressions. All are listed in FEATURE_MATRIX.md §6.

1. **Manual test pass** — run the checklist in `docs/testing.md` (real IMEs, iOS / Android
   keyboards, screen readers). Nothing in it has been executed; it is the largest unverified area.
2. **Verify parity claims against Lexical 0.53.0** — the inventory of packages / plugins was
   taken at the tag, but behaviours were not compared side by side. Install `lexical@0.53.0`,
   run its playground, and update the "expected behaviour" column or mark rows verified.
3. **Collaboration backend** — the WebSocket relay in `docs/collaboration.md` is not run by any
   test. Add `ws` as a dev dependency, an `examples/collab-server`, and a Playwright test that
   uses `webSocketTransport` with two pages. Also exercise `broadcastChannelTransport` with two
   pages of one browser context.
4. **Databases, next steps** (docs/databases.md "Not implemented"): finer-grained
   collaboration (cells of one row and the schema are still last-writer-wins — moving cells and
   properties into their own shared maps in `collab.ts` would fix that), row virtualization,
   two-way relations, nested filter groups, linked databases, row templates, dragging calendar
   cards / timeline bars to change dates, editable (two-way) synced blocks.
   Bundle: databases are still part of the base bundle, which grew from 84.9 to 95.7 kB gzipped
   in session 3 (style.css 6.8 → 9.3 kB); splitting them into an optional entry is the fix.
   Templates: template buttons exist; a cross-document template gallery does not.
5. **Equation rendering** — ship an optional `@z-packages/zeditor/katex` entry that lazy-loads
   KaTeX and sets `renderMath`, plus a test.
6. **Table polish** — row height resize, hover "+" buttons to add rows / columns, scroll shadow.
7. **Smaller gaps**: plain-text-only mode, context menu, text-case transforms, inline images,
   table-of-contents UI (data helper `getHeadings` exists), Prism / Shiki adapters for
   `codeHighlightExtension({ tokenizers })`.
8. **Large documents** — typing drops below 60 fps above ~5,000 blocks in one page because of
   browser layout (`docs/benchmarks.md`). Options: virtualize off-screen top-level blocks, or
   group them into layout-contained chunks. Paged documents already avoid the cost.
9. **Playground test** — the playground was checked visually (`scripts/shots.mjs`) but has no
   automated test.
10. **Release housekeeping** — pick the final package name / scope, add a CHANGELOG and CI
    workflow (`pnpm check` on Windows, macOS and Linux), decide whether to ship source maps
    (they are ~70 % of the unpacked tarball).

## Notes for whoever resumes

- Shell heredocs are unreliable in this environment (Git Bash on Windows): write files with an
  editor tool, and do multi-line patches from a `.cjs` script file rather than `node -e`.
- Package name is `@z-packages/zeditor` because `zeditor` is taken on npm.
- Moves are `remove` + `insert` steps, so `Block` objects are re-created: never hold a `Block`
  across `tr.move` / `tr.remove` + `tr.insert`; look it up again by id. (Found by the fuzz test.)
- Text blocks may structurally have children even when their spec does not nest (merged
  concurrent edits); commands only *create* children where `children: true`.
- Selection offsets are snapped out of surrogate pairs in `fixSelection`; steps themselves are
  applied exactly as given.
- In the view, reading layout (caret rect, block rect) inside a transaction forces a full
  layout on large documents. Keep such reads in `requestAnimationFrame` (see `scrollToSelection`,
  block handle positioning).
- Database rows must stay in document order in the DOM (the reconciler owns child order):
  view order, filtering and board columns are done with CSS `order` / `hidden` /
  `grid-column` / `grid-row` in `view/database-render.ts` (styles in `src/database.css`). Do not
  move row elements between containers. Board cards are packed per lane by measuring them into
  4px grid tracks; calendar / timeline / lane backgrounds are decoration elements without
  `data-zid`, which the reconciler skips.
- Database rows are paint-contained (`content-visibility`): anything wider than the row box is
  clipped, so the table body must be `min-width: max-content`.
- `scripts/shots-db.mjs <dir>` screenshots every database view in the playground; look at the
  pictures after touching `database.css`.
- WebKit will not type into content that was `display: none` when the selection was set, even
  after it becomes visible: show the content, flush layout, then call
  `view.syncSelectionToDOM(true)` (which re-writes the selection even if it looks unchanged).
- Firefox ignores `clipboardData` on synthetic `ClipboardEvent`s; the browser tests fall back to
  the public `copyPayload` / `pasteData` API there (see `test/browser/rich.spec.ts`).
- Playwright's `fill()` on an `<input>` nested in the editable area issues an editing command
  against the editing host in Firefox; tests type with real key events instead, and the view
  ignores host-level `beforeinput` while an embedded control has focus.
