# Browser support, test coverage and manual checklist

## Supported browsers

| Browser | Minimum | Notes |
| --- | --- | --- |
| Chrome / Edge / Chromium | 105 | full feature set |
| Firefox | 125 | syntax colours and find highlights need the CSS Custom Highlight API (Firefox 140+); older versions use overlays for find / presence and show code uncoloured |
| Safari | 17.2 | as above for versions before 17.2 |
| iOS Safari, Android Chrome | current | touch controls are provided; see the manual checklist — not covered by automation |

Required platform features: `beforeinput` (Input Events Level 1), `Selection.setBaseAndExtent`,
ES2020. `Intl.Segmenter` is used when present (grapheme-aware delete), with a fallback.
Internet Explorer and legacy Edge are not supported.

## What is automated

Run everything with `pnpm test` (Node) and `pnpm test:browser` (Playwright).

### Model tests — Vitest, Node (`packages/zeditor/test/unit`, 103 tests)

| File | Covers |
| --- | --- |
| `editing.test.ts` | typing, split/join, cross-block and backward selections, grapheme-aware delete (emoji ZWJ sequences, flags, combining marks, Devanagari), RTL text, marks, links, Markdown shortcuts, checklists across mode switches, indent/outdent, invalid moves, multi-block operations, code blocks, rollback, character limit, selection mapping, read-only |
| `tables.test.ts` | rows/columns with spans, merge/split, Tab navigation, spreadsheet paste (growth, uneven rows, merged destination), single-cell fill, range copy, ragged-table repair, deletion across the table boundary |
| `serialization.test.ts` | lossless JSON incl. custom nodes, missing-extension recovery, validation/sanitization of hostile documents, extension migrations, HTML export/import, XSS payloads, malformed markup, **Google Docs / Word / Excel paste fixtures**, custom-node HTML and Markdown round trips, Markdown import/export |
| `features.test.ts` | comment anchors (edit, move, delete, undo, permissions), suggestions, versions, autosave (late responses, offline, retry, draft recovery), uploads (abort on delete, stale results, retry), stale typeahead results, find/replace, pages, extension ordering/conflicts/cleanup, hashtags/autolinks, TOC, static rendering |
| `collab.test.ts` | sync, concurrent edits, structure replication, offline merge, per-user undo, presence, shared comments, concurrent table shape edits, persistence, permissions, **randomized 3-client convergence** (4 seeds) |
| `database.test.ts` | databases: rows as pages, sort / filter / group / calculate, cell coercion, property conversion and deletion, hostile schemas, HTML / JSON / Markdown, missing-feature preservation, concurrent row and schema edits; table of contents, bookmarks with stale previews, template buttons, page links, dates, toggle headings |
| `database2.test.ts` | the formula language (precedence, functions, hostile input, unknown names), formula properties in sort / filter / calculations, relations and rollups incl. deleted rows and circular references, match-any filters, calendar / timeline queries, property reordering, custom property types, row moves, sub-pages (tree order, re-parenting, cycles), synced copies |
| `fuzz.test.ts` | **randomized operations** (8 seeds × 400 ops over ~50 commands, including database, template and outline operations): invariants after every step, serializer round trips, full undo back to the initial document |

### Browser tests — Playwright (`packages/zeditor/test/browser`, 69 tests × 3 engines)

| File | Covers |
| --- | --- |
| `editing.spec.ts` | real key events, DOM/model sync, **no DOM replacement while typing**, backward cross-block selection + toolbar + undo, shortcuts, checklist + mode switch + undo, scripts and emoji, read-only |
| `blocks.spec.ts` | slash menu, block handle menu, **drag reorder incl. nested and invalid drops**, comment + image reorder with DOM identity, floating toolbar, nesting, toggles, columns, **page tabs** |
| `rich.spec.ts` | table tools, drag and keyboard cell selection, merge/split, **spreadsheet paste → undo → serialize → reload**, range copy, column resize, clipboard formats, URL-on-selection, hostile HTML paste, code blocks + highlighting, **image upload lifecycle**, async mentions with stale results, find/replace, link editing |
| `platform.spec.ts` | **IME composition** (CJK, Hangul, dead keys, Devanagari), accessibility roles/names, **keyboard-only operation**, focus restoration, **touch** without hover, multiple editors, **listener cleanup**, missing-extension recovery in the DOM, failing host renderer fallback, **file drop upload**, autosave status and drafts, block links |
| `notion.spec.ts` | **databases**: creation from the slash menu, cell / option / row editing, property menu, calculations, sort and filter, **board drag between columns**, list and gallery, **row pages**, read-only; table of contents, bookmark previews, date chips, template buttons, toggle headings, `[[` page links |
| `notion2.spec.ts` | **formula** settings and live errors, **relation picker and rollup**, **calendar** (day placement, per-day add, month navigation) and **timeline** bars, **column resize and drag reorder**, match-any filters, board lane geometry, the toolbar **Insert menu**, **sub-pages and breadcrumbs**, synced copies |
| `integrations.spec.ts` | the three built examples: plain HTML, **React Strict Mode**, **Vue + Vuetify with mount/unmount cycles**, and one saved document opening in all three |
| `collab.spec.ts` | the two-client example: concurrent typing, presence rendering, offline merge, per-user undo, structure replication |

### Actual coverage of the last run

Recorded by `pnpm test:browser` in `packages/zeditor/test-results/browser-results.json`.

| Engine | Passed | Skipped | Failed |
| --- | --- | --- | --- |
| Chromium 159 (headless) | 69 | 0 | 0 |
| Firefox (Playwright build) | 67 | 2 | 0 |
| WebKit 27.2 (Playwright build) | 67 | 2 | 0 |

Skipped outside Chromium, by design:

- **Real IME session via CDP** (`Input.imeSetComposition`) — a Chromium DevTools command.
- **OS clipboard round trip** with Ctrl+C / Ctrl+V — clipboard permissions are only granted to
  Chromium in this setup.

Honest limits of the automation:

- **Composition in Firefox and WebKit is simulated**: the tests dispatch the composition events
  and DOM mutations an IME produces. That exercises the editor's reconciliation path, but it is
  not a real input method. Real IMEs are on the manual checklist.
- **Synthetic clipboard events carry no data in Firefox**, so there the clipboard tests call the
  same code through the public API (`copyPayload`, `pasteData`) instead of through the event.
- WebKit on Windows/Linux (the Playwright build) is not Safari on macOS/iOS.
- No real mobile devices, on-screen keyboards or screen readers were used.
- Playwright's `fill()` does not type into inputs nested in the editable area in Firefox, so
  tests for embedded controls (image captions, database cells) use real key events.
- The WebSocket relay in the docs is not exercised; the sync protocol is tested over the
  in-memory hub and BroadcastChannel is exercised only manually.

Also verified automatically: `pnpm pack:verify` (packed tarball in clean consumer projects,
see `docs/pack-verify.json`) and `pnpm bench` (see [benchmarks](./benchmarks.md)).

## Manual test checklist

Not automated. Run before a release on real hardware; record browser, OS and input method.

### Input methods (desktop)

- [ ] **Japanese** (macOS Kotoeri / Windows MS-IME, Chrome + Firefox + Safari): type `nihongo`,
      convert with Space, change candidate, commit with Enter. Text appears once; the candidate
      window stays attached to the caret; Enter commits and does **not** split the block.
- [ ] Composition at the start, middle and end of a paragraph; inside bold and link text; in a
      list item, a table cell, a code block and an empty block.
- [ ] Start composing with a multi-block selection: the selection is replaced.
- [ ] Undo after composing removes the composed text in one step.
- [ ] **Chinese Pinyin** and **Korean 2-set**: syllable composition; Backspace during
      composition edits the syllable, not the document.
- [ ] **Dead keys** (US-International, German, Spanish; macOS Option+e, Windows `´` then `e`):
      `é ñ ü ô` appear as one character; a dead key then Space gives the bare accent.
- [ ] **Devanagari** (Hindi/Nepali InScript or phonetic): conjuncts (`क्ष`), matras and the
      reph render correctly; Backspace removes one code point; arrow keys move by cluster.
- [ ] **Arabic / Hebrew**: typing in an RTL paragraph, mixed with Latin and digits; caret
      movement with arrows; Home/End; selection with Shift+arrows across the direction change.
- [ ] **Emoji picker** (Win+. / Ctrl+Cmd+Space): skin-tone and ZWJ family emoji insert as one
      unit and delete with one Backspace.
- [ ] macOS press-and-hold accent menu; macOS dictation; Windows voice typing.
- [ ] Spellcheck replacement from the context menu replaces only the word and is undoable.
- [ ] Browser autofill / password managers do not inject into the editor.

### Mobile keyboards

- [ ] **iOS Safari**: typing with autocorrect and predictive text; accepting a suggestion;
      double-space period; swipe typing; long-press selection handles; the native
      cut/copy/paste callout; Japanese and Emoji keyboards.
- [ ] **Android Chrome with Gboard**: every keystroke is a composition — check there are no
      duplicated or dropped characters, Backspace at the start of a block joins blocks,
      Enter splits; swipe typing; suggestion strip; voice input.
- [ ] Samsung keyboard and SwiftKey on Android.
- [ ] The on-screen keyboard does not cover the caret (the editor scrolls); the toolbar remains
      reachable; popups stay inside the visual viewport.
- [ ] Block handle, slash menu, table tools, image resize handle and checkboxes work by touch.
- [ ] Orientation change keeps the caret and scroll position.

### Screen readers

- [ ] **NVDA + Firefox / Chrome**, **JAWS + Chrome**, **VoiceOver + Safari (macOS and iOS)**,
      **TalkBack + Chrome**.
- [ ] The editor is announced as a multi-line text field with its label; read-only state is
      announced.
- [ ] Reading by character, word and line works across formatted text, links, mentions and
      list items; headings are reachable with heading navigation.
- [ ] Toolbar: reached with Alt+F10, announced as a toolbar; buttons announce name and
      pressed state; arrow keys move; Escape returns to the text.
- [ ] Slash / mention menu: options are announced while arrowing (`aria-activedescendant`);
      "no results" is announced.
- [ ] Checklist items announce checked / not checked; toggles announce expanded / collapsed.
- [ ] Tables are announced with row/column position and headers.
- [ ] Images announce their alt text; images without alt are flagged to the author.
- [ ] Dialogs (link, colour, caption, alt text) move focus in and restore it on close.
- [ ] Save status changes and find-result counts are announced politely.
- [ ] Page tabs are announced as tabs with selected state.

### Databases

- [ ] Keyboard only: create a database, fill a row, pick and create select options, add a
      property, switch views, open a row page and return.
- [ ] Screen reader: view tabs announce as tabs; cells announce their property name; the option
      picker announces options and selection.
- [ ] Touch: edit cells, open the option picker, drag a board card between columns.
- [ ] A database with 500+ rows stays usable (there is no row virtualization).
- [ ] Touch: resize and reorder table columns, drag a board card onto another to reorder.
- [ ] Screen reader: calendar days and timeline bars are understandable; formula errors are announced.

### Other

- [ ] Windows High Contrast / forced-colors: selection, focus rings and block selection visible.
- [ ] 200 % and 400 % zoom; `prefers-reduced-motion`.
- [ ] Keyboard only, start to finish: write a document with a heading, list, table, image
      (upload), link, and reorder blocks — without a pointer.
- [ ] Paste from the current Word, Google Docs, Excel, Google Sheets, Notion and a web page.
- [ ] Printing a multi-page document puts each page on its own sheet.
