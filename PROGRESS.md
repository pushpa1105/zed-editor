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
| Session 4 fixes and additions: block handle next to databases (was placed off-screen, vanished on the way to it), wheel over databases / tables now scrolls the page, quick search, row menu (button + right click), arrow-key row navigation, calendar / timeline drag to change dates, sticky table title column, hide empty board groups, active view tab kept in sight | done — see docs/databases.md "Working with rows" |
| Session 4, on request: backend block IDs (`idGenerator`, `remapIds`), block events (`blocks`, `block:created/updated/deleted/moved/completed/uncompleted/focus`), `createBlockSync` / `applyBlockChanges`, "New" always shows the new row (calendar / timeline / board), user guide | done — see docs/events-and-sync.md, docs/user-guide.md |
| Session 4, on request: no silent failures (built-in notices for ui:error / failed uploads, Comment fallback message), Find toolbar button, custom toolbar keeps Insert position, grouping in table / list / gallery with folding sections, playground database examples (task tracker, content calendar, reading list, linked customers / deals) | done |
| Session 4, on request: complex and nested tables — HTML import keeps tables inside cells (4 levels), captions, column widths, colours, alignment; unwraps layout tables; Markdown writes complex tables as HTML; table tools mark the active nested table; playground "Complex tables" example | done |
| Session 4, on request: documentation of every feature — docs/commands.md (all commands, editor options, Editor API, UI events), generated docs/api-reference.md (every export), `pnpm docs:check` in `pnpm check`; `locale` option now formats dates | done |
| Session 5, on request: release preparation — CHANGELOG.md (0.1.0), RELEASING.md, CONTRIBUTING.md, `pnpm release` / `release:notes` scripts, documentation website (`pnpm site`, live demo, search, all docs, playground and examples) deployed to GitHub Pages, CI / Pages / Release GitHub Actions workflows, issue and PR templates, Dependabot, npm metadata | done — see RELEASING.md |
| Collaboration fixes (2026-11-27): same-caret typing no longer interleaves, selections do not grow at their edges, pending formatting survives remote edits, formatting / comment anchors sent as Yjs formatting (no duplicated text), remote carets and undo selections as relative positions, `applyBlockChanges` keeps the caret | done — tests in `test/unit/collab-caret.test.ts`, CHANGELOG "Unreleased" |
| Collaboration rework (2026-11-27): shared text moved into one flow (`doc.getText('flow')`, start / end marker per block) so split, join and move never copy text; one formatting attribute per comment thread; duplicate block entries after concurrent moves are deleted instead of renamed; 0.1.0 documents are converted on bind | done — docs/collaboration.md "The shared document", tests in `test/unit/collab-structure.test.ts` |

Per-capability status, evidence and the list of known gaps: [FEATURE_MATRIX.md](FEATURE_MATRIX.md).

## Last verified results (this machine, 2026-11-27)

| Check | Command | Result |
| --- | --- | --- |
| Type check | `pnpm typecheck` | clean |
| Unit + randomized + collaboration | `pnpm test` | 166 passed |
| Browser | `pnpm test:browser` | 269 passed, 4 skipped, 0 failed (91 tests × Chromium, Firefox, WebKit; skips are the CDP IME test and the OS-clipboard test outside Chromium) |
| Packed release | `pnpm pack:verify` | 10 / 10 checks passed (`docs/pack-verify.json`) |
| Benchmarks | `pnpm bench` | `docs/benchmarks.md` |

## How to run

```sh
pnpm install
pnpm build
pnpm --filter @buffmomo/zeditor exec playwright install chromium firefox webkit   # once
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
   two-way relations, nested filter groups, linked databases, row templates, editable (two-way)
   synced blocks.
   Bundle: databases are still part of the base bundle, which grew from 84.9 to 95.7 kB gzipped
   in session 3 (style.css 6.8 → 9.3 kB); splitting them into an optional entry is the fix.
   Templates: template buttons exist; a cross-document template gallery does not.
5. **Equation rendering** — ship an optional `@buffmomo/zeditor/katex` entry that lazy-loads
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
10. **First release (owner actions)** — enable *Settings → Pages → Source: GitHub Actions*; set up
    npm publishing (`NPM_TOKEN` secret or trusted publishing) and confirm the `@buffmomo` scope;
    then push the tag `v0.1.0` (RELEASING.md). Still open: whether to ship source maps (~70 % of the
    unpacked tarball). `node scripts/shots-site.mjs <dir>` screenshots the website and fails on
    broken links or console errors.

## Notes for whoever resumes

- After changing anything public, run `pnpm docs:api` (regenerates docs/api-reference.md) and
  `pnpm docs:check` (fails on undocumented commands, events, toolbar items, options or a stale
  reference). New commands need a line in docs/commands.md.

- Selection mapping has a side: for changes the user did not make (origin `'remote'`, or
  `tr.setMeta('foreign', true)`) text inserted exactly at the caret goes after it
  (`mapSelection(..., foreign)`). Anything new that applies other people's edits must use one
  of the two, or same-position typing interleaves again.
- `collab.ts` `applyLocal` needs the inverse steps: it diffs the replaced text against the
  new text (`diffInline`) and sends a formatting-only change as `Y.Text.format`. Never send a
  mark change as delete + insert.
- `collab.ts`, shared layout: the text of all blocks is one Y.Text (the flow) with a start and
  an end marker per block; the binding keeps a mirror of it (`segs`: id, length, closed, stray
  units). `applyLocal` recognises the editor's step patterns and writes what they mean:
  "cut the tail + insert a block with it" becomes two markers (split), "append + remove the
  block" becomes a deletion of the markers in between (join), "remove + insert of the same id"
  leaves the text where it is (move). A new command that moves text between blocks in another
  way falls back to delete + insert, which is correct but duplicates under concurrency: give
  it one of these shapes, or teach `applyLocal` the new one.
- `collab.ts`: never write to the Y.Doc from inside its observers. Yjs packs the insertions
  of such a nested transaction into the pending update of the outer one and sends its
  deletions later, so peers briefly see a moved block twice. Remote changes are collected in
  the observers and handled on `afterAllTransactions`.
- `collab._verify()` (internal, used by the tests) reports a mirror or an editor that is out
  of step with the shared document. To hunt a collaboration bug, run the randomized test with
  more seeds and call it after every step; client ids are random, so a seed is not a fixed
  scenario — run a few hundred.
- Still open in collaboration: type, attributes and the child list of a block are re-created
  by a move, so a concurrent change of those to a block someone else moves is lost (the text
  is kept); cells of one database row and the database schema are last-writer-wins.

- Shell heredocs are unreliable in this environment (Git Bash on Windows): write files with an
  editor tool, and do multi-line patches from a `.cjs` script file rather than `node -e`.
- Package name is `@buffmomo/zeditor` because `zeditor` is taken on npm.
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
