# Feature matrix

## Reference

| | |
| --- | --- |
| Reference product | Lexical |
| Pinned release | **0.53.0** (npm dist-tag `latest` on 2026-11-21; `nightly` was 0.53.1-nightly.20261120.0) |
| Tag | `v0.53.0`, tag object `f916bc938f6465bf338fb03377b4e43588572281` |
| Repository | https://github.com/meta/lexical (the former `facebook/lexical`; the GitHub API redirects) — https://github.com/meta/lexical/tree/v0.53.0 |
| npm | https://www.npmjs.com/package/lexical/v/0.53.0 |
| Docs | https://lexical.dev/docs/intro |

### How the inventory was made — and what is *not* verified

- **Verified at the tag** (GitHub contents API, 2026-11-21): the list of packages under
  `packages/`, the plugins and nodes of `packages/lexical-playground/src`, the modules of
  `packages/lexical-react/src`, and the directories under `examples/`. Those names are
  reproduced below.
- **Not verified**: the exact behaviour of each capability at 0.53.0. The "expected behaviour"
  column is written from general knowledge of Lexical, not from reading or running the
  0.53.0 sources or docs. Lexical was not installed and no side-by-side comparison was run.
- Therefore this document claims **no verified parity**. "Implemented" means *zeditor has an
  equivalent capability with the evidence listed*, not *zeditor behaves identically to
  Lexical 0.53.0*. Rows whose reference behaviour I could not characterise are marked
  **unverified**.

zeditor does not depend on Lexical or any other editing engine. Runtime dependencies of the
base bundle: none. Optional peers: `react`, `react-dom`, `vue`, `yjs`, `y-protocols`.

### Status legend

| | |
| --- | --- |
| ✅ | implemented, with automated evidence |
| 🟡 | partially implemented — the gap is stated |
| ❌ | not implemented |
| n/a | not applicable to this project |

Evidence abbreviations: **U** = `packages/zeditor/test/unit/…`, **B** = `packages/zeditor/test/browser/…`,
**PV** = `scripts/pack-verify.mjs`, **PG** = playground.

---

## 1. Engine primitives (`lexical` core and closely related packages)

| Lexical | Expected behaviour / API | zeditor equivalent | Status | Evidence |
| --- | --- | --- | --- | --- |
| Editor instance, `createEditor` | one instance owns state; several per page | `Editor` (headless), `createEditor` (mounted) | ✅ | B platform "multiple editors…" |
| Immutable `EditorState`, `editor.update` / `read` | batched, atomic updates | `editor.update(tr => …)`: atomic, rolled back on error; state is mutable-in-place with step log rather than immutable snapshots | ✅ (different design) | U editing "rolls back…" |
| Node tree: Root, Element, Text, LineBreak, Paragraph, Decorator, Tab | typed nodes | block kinds `text` / `container` / `atom` / `inline`; line break is `\n` in text; no Tab node (tabs are characters) | ✅ (different model) | U serialization |
| Text formats | bold, italic, underline, strikethrough, code, subscript, superscript, highlight | marks of the same names + colour, font size/family, link | ✅ | U editing "marks"; B editing |
| Custom nodes, node replacement / overrides | register nodes; replace built-ins | extensions `nodes`, `extendNode`, `override: true`; host `renderers` | ✅ | U features "extends an existing node…"; B integrations |
| NodeState (per-node extra state) | typed extra state on nodes | arbitrary validated `attrs` on every block; unknown attrs preserved | 🟡 no separate typed state API | U serialization "round-trips losslessly" |
| Selection: Range, Node, (Table via @lexical/table) | several selection kinds | `text` (backward, cross-block), `block`, `cell` | ✅ | U editing, tables; B rich |
| Commands with priorities | `registerCommand(cmd, fn, priority)` | named commands; keymaps chained by extension priority | ✅ | U features "priority-ordered keymaps" |
| Node transforms | normalise after updates | `normalize` hooks, appenders (autolink, hashtag), filters | ✅ | U features "hashtags and autolinks…" |
| Listeners: update, text content, mutation, editable, decorators | subscribe to changes | events `transaction`, `change`, `selection`, `update`, `mode`, `readonly`, `focus`, `blur`; `subscribe()` | 🟡 no per-node-class mutation listener | B integrations (React/Vue state) |
| DOM reconciliation | minimal DOM updates | keyed, incremental; text nodes patched in place | ✅ | B editing "typing does not replace…" |
| Composition / IME handling | native composition preserved | native composition + reconciliation | ✅ (real IME: Chromium only) | B platform "composition…" |
| Editable / read-only | `setEditable` | `setReadOnly` | ✅ | B editing "read-only…" |
| JSON serialization, versioned | `exportJSON` / `importJSON` | `getJSON` / `setJSON`, format version + migrations, validation | ✅ | U serialization "JSON" |
| Themes (class names) | theme object maps to classes | CSS variables + `z-*` classes, `unstyled`, per-editor theme | ✅ (different mechanism) | B platform; PG |
| `@lexical/headless` | editor without DOM in Node | `@z-packages/zeditor/core` | ✅ | all U tests; PV "node: headless…" |
| `@lexical/history` | undo/redo with merge heuristics | built-in history with grouping; per-user history in collab | ✅ | U editing; U collab "undo only reverts…" |
| `@lexical/extension` (extension API) | declarative extensions with dependencies | `Extension`: requires, priority, conflicts, cleanup, apiVersion | ✅ | U features "extensions" |
| `@lexical/selection` | selection helpers, style patching | `selectedRanges`, `selectedBlocks`, `markRangeAt`, mark commands | ✅ | U editing |
| `@lexical/text` | text helpers, `registerLexicalTextEntity` | `getText`, counts, find; text entities via appenders / input rules | ✅ | U features |
| `@lexical/utils` | DOM/tree utilities | `Doc` traversal helpers, `el`, `place` | 🟡 smaller surface | — |
| `@lexical/offset` | offset-based selection view | positions are `{ id, offset }` natively | ✅ (inherent) | — |
| `@lexical/overflow` + CharacterLimit | mark overflowing text | `characterLimit` **rejects** edits past the limit; counter in the status bar | 🟡 hard limit instead of an overflow highlight | U editing "enforces the character limit" |
| `@lexical/clipboard` | rich copy/paste | text/plain, text/html, structured JSON | ✅ | B rich "clipboard" |
| `@lexical/html` | DOM ⇄ nodes | `toHTML` / `fromHTML` with own parser (no DOM needed) | ✅ | U serialization "HTML" |
| `@lexical/markdown` | import/export + shortcut transformers | `toMarkdown` / `fromMarkdown`, typing shortcuts | ✅ | U serialization "Markdown" |
| `@lexical/mdast` | **unverified** (mdast bridge, presumably) | — | ❌ | — |
| `@lexical/plain-text` | plain-text-only editor | no dedicated plain-text mode (features can be switched off, marks remain) | ❌ | — |
| `@lexical/rich-text` | headings, quotes, rich editing | base extension | ✅ | U editing |
| `@lexical/list` | bullet, numbered, check lists, nesting | `list` blocks, nesting via children | ✅ | U editing; B blocks |
| `@lexical/link` | links, auto links | `link` mark, autolink input rule, paste-URL-on-selection | ✅ | U editing; B rich |
| `@lexical/mark` | mark nodes for comments | `comment` mark with thread ids | ✅ | U features "comments" |
| `@lexical/table` | tables, merge, selection, resize | table extension | ✅ (row-height resize ❌) | U tables; B rich "tables" |
| `@lexical/code`, `code-core`, `code-prism`, `code-shiki` | code blocks with Prism or Shiki | `code` block + optional built-in tokenizer; custom tokenizers pluggable. No Prism/Shiki adapter shipped | 🟡 | B rich "code block…" |
| `@lexical/hashtag` | hashtag entities | `hashtag` mark, kept in sync while typing | ✅ | U features |
| `@lexical/file` | export/import editor state as a file | `getJSON` / `setJSON`; no file-download helper | 🟡 | — |
| `@lexical/yjs` | collaboration binding | `@z-packages/zeditor/collab` | ✅ | U collab; B collab |
| `@lexical/dragon` | Dragon NaturallySpeaking support | — | ❌ | — |
| `@lexical/a11y` | **unverified** | accessible default controls (see §6) | 🟡 unverified reference | B platform "accessibility…" |
| `@lexical/devtools`, `devtools-core` | browser devtools extension | playground document inspector (JSON, HTML, Markdown, state, steps) | 🟡 no browser extension | PG |
| `@lexical/tailwind` | Tailwind theme | — (CSS variables instead) | n/a | — |
| `@lexical/compiler`, `fast-check`, eslint plugins, `internal`, website | tooling | — | n/a | — |

## 2. `@lexical/react`

| Lexical | zeditor equivalent | Status | Evidence |
| --- | --- | --- | --- |
| `LexicalComposer`, context, `ContentEditable`, RichText / PlainText plugins | `<ZEditor>`, `useEditor()` | ✅ (plain text ❌) | B integrations "React…" |
| `OnChangePlugin`, `useLexicalSubscription`, `useLexicalEditable`, `useLexicalIsTextContentEmpty` | `onChange`, `useEditorState(instance, selector)` | ✅ | B integrations |
| `EditorRefPlugin` | `ref` → instance | ✅ | examples/react |
| `HistoryPlugin`, `AutoFocusPlugin`, `ClearEditorPlugin` | built in; `autofocus`; `clearDocument` command | ✅ | U features "small helpers" |
| `LinkPlugin`, `AutoLinkPlugin`, `ClickableLinkPlugin` | link extension; Mod+click / read-only click follows links | ✅ | B rich "link editing…" |
| `ListPlugin`, `CheckListPlugin`, `TabIndentationPlugin` | lists; Tab / Shift+Tab (Escape releases Tab) | ✅ | B editing; B platform |
| `MarkdownShortcutPlugin` | `markdownShortcuts` feature | ✅ | B editing |
| `HashtagPlugin`, `CharacterLimitPlugin` | features | ✅ / 🟡 (see §1) | U |
| `TablePlugin` | tables feature | ✅ | B rich |
| `HorizontalRuleNode` / plugin | `divider` | ✅ | U |
| `TypeaheadMenuPlugin`, `NodeMenuPlugin`, `MenuOption` | `typeahead` sources + menu | ✅ | B rich "mentions…" |
| `DraggableBlockPlugin` | block handles | ✅ | B blocks "drag…" |
| `AutoEmbedPlugin` | `embed` block + providers; no "convert pasted URL?" prompt | 🟡 | — |
| `CollaborationPlugin` + context | `createCollab` (framework-independent) | ✅ | B collab |
| `DecoratorBlockNode`, `BlockWithAlignableContents` | atom blocks with `align`; `nodeViews` | ✅ | B integrations |
| `NestedComposer` | not needed: containers hold editable blocks directly | ✅ (different design) | B integrations "Vuetify…" |
| `TableOfContentsPlugin` | `getHeadings(editor)` (data only, no UI) | 🟡 | U features "small helpers" |
| `TreeView` | playground inspector | 🟡 | PG |
| `ErrorBoundary` | failing renderers fall back to defaults | ✅ | B platform "a host renderer that throws…" |
| `NodeContextMenuPlugin` | — | ❌ | — |
| `SelectionAlwaysOnDisplay` | — | ❌ | — |
| `NodeEventPlugin` | DOM events in custom renderers | 🟡 | — |
| `useLexicalNodeSelection` | block selection state (`z-selected`), `getState().selection` | ✅ | B platform |
| aria-live region, focus manager, focus trap, roving tabindex hooks | roving tabindex and focus restore in default UI; live regions for status/find; not exported as hooks | 🟡 | B platform |
| React extension host / provider / slot (`ReactExtension`, `useLexicalSlotRef`…) | `nodeViews`, `inlineViews`, `<NodeContent>` | ✅ (different API) | B integrations |

## 3. Playground plugins and nodes (examples, not packages)

| Playground item | zeditor | Status | Evidence |
| --- | --- | --- | --- |
| ToolbarPlugin: block type, bold…code, link, colours, alignment, indent, clear formatting, insert menu | default toolbar | ✅ | B editing, platform |
| Toolbar: font family and size | `fontSize` / `fontFamily` marks + selects (fixed option lists) | ✅ | U features "small helpers" |
| Toolbar: text case (upper / lower / capitalize) | — | ❌ | — |
| FloatingTextFormatToolbar | floating toolbar | ✅ | B blocks |
| FloatingLinkEditor | link popover (opened on demand, not on hover) | 🟡 | B rich |
| ComponentPicker (slash menu) | slash menu | ✅ | B blocks |
| DraggableBlock | handles, drag, action menu | ✅ | B blocks |
| MarkdownShortcuts / Transformers | ✅ | ✅ | U, B |
| CodeHighlight, CodeActionMenu (copy) | highlight + copy + language select; no Prettier formatting | 🟡 | B rich |
| Table: action menu, cell resizer, hover add buttons, scroll shadow, nested-table fit | tools bar (rows, columns, merge, split, headers, delete), column resize; no hover add buttons, no row resize, no scroll shadow | 🟡 | B rich |
| Images (caption, resize, alt), DragDropPaste | ✅ + upload lifecycle | ✅ | B rich "images…" |
| Inline images | images are blocks | ❌ | — |
| Collapsible | `toggle` | ✅ | B blocks |
| Layout (columns) | `columns` | ✅ | B blocks |
| PageBreak, Pages | `page_break`, multi-page documents with tabs / sheets | ✅ | U features "pages"; B blocks "page tabs…" |
| Equations (KaTeX) | `equation` block + inline `math`; rendering through a host `renderMath` hook (KaTeX is not bundled) | 🟡 | U serialization |
| Mentions, Emojis, EmojiPicker, AutoLink, Hashtags, MaxLength | ✅ (emoticon→emoji conversion ❌) | ✅ / 🟡 | B rich |
| YouTube, Twitter, Figma, AutoEmbed | YouTube and Vimeo built in; others via `embedProviders` or link cards | 🟡 | — |
| Comments (CommentPlugin) | threads, replies, resolve, anchors | ✅ | U features; B blocks |
| Review / Versions | suggestions accept/reject; versions | ✅ | U features |
| FindReplace | ✅ | ✅ | B rich |
| Shortcuts, TabFocus | keymap; Escape then Tab leaves the editor; Alt+F10 to the toolbar | ✅ | B platform |
| TableOfContents | data helper only | 🟡 | U |
| Actions (import/export, read-only, share…) | playground header + inspector | 🟡 | PG |
| TreeView, PasteLog, TestRecorder, TypingPerf | inspector; `pnpm bench` | 🟡 | PG, bench |
| ContextMenu | — | ❌ | — |
| Autocomplete (inline suggestions) | — | ❌ | — |
| SpeechToText | — | ❌ | — |
| Excalidraw, Poll, Sticky notes, DateTime, Ruby, SpecialText, Keyword, PullQuote, Card, VisibleNonPrinting, TerseExport, Docs | — (each could be an extension) | ❌ | — |

Lexical `examples/` at the tag (agent-example, extension-*, markdown-editor, nextjs-code-shiki,
node-replacement, node-state-*, react-*, shadow-dom*, vanilla-js*, website-*): zeditor's
counterparts are `examples/html`, `examples/react`, `examples/vue-vuetify`, `examples/collab`
and the playground. No Shadow DOM, iframe, Next.js or Svelte example exists here — **untested**.

---

## 4. Required scope from the project brief

| Area | Capability | Status | Evidence |
| --- | --- | --- | --- |
| **Engine** | one instance, model, selection and history for both modes; switching keeps document, caret, scroll, undo stack and adds no undo entry | ✅ | U "checklist…mode switch"; B editing "checklist in block mode…" |
| | versioned, validated JSON; migrations; stable ids | ✅ | U serialization |
| | typed nodes, marks, attrs, nesting, atoms, custom nodes with editable children | ✅ | U; B integrations (notice) |
| | transactions, commands, selection mapping, normalization, grouped undo/redo | ✅ | U editing, fuzz |
| | text, backward, cross-block, block and cell selections | ✅ | U; B |
| | incremental DOM; composition preserved | ✅ | B editing, platform |
| | headless in Node | ✅ | U; PV |
| | host re-render never resets document or caret | ✅ | B integrations "re-render safety" |
| **Writing** | paragraphs, headings, quotes, dividers, line breaks, lists, nested lists, checklists | ✅ | U; B |
| | bold … highlight, alignment, indentation | ✅ | U; B |
| | links: auto-detect, edit, remove, paste URL on selection | ✅ | U; B rich |
| | shortcuts, Markdown shortcuts, find/replace, counts, character limit | ✅ | B editing, rich; U |
| **Blocks** | slash menu, insert control, floating toolbar, block actions | ✅ | B blocks |
| | create, convert, duplicate, delete, select, move, indent, outdent; multi-block | ✅ | U editing; B blocks |
| | drag and keyboard reorder incl. nested; invalid moves refused | ✅ | U; B blocks "drag…" |
| | collapsible sections, callouts, columns | ✅ | B blocks |
| | reusable templates | 🟡 no dedicated template store: `insertBlocks(json)` inserts any saved block JSON with fresh ids, and slash items can wrap it — there is no UI to save a selection as a template | — |
| | direct links to blocks | ✅ | B platform "…block links" |
| **Tables** | rows/columns, headers, column resize, merge/split, keyboard navigation, rectangular selection | ✅ (row resize ❌) | U tables; B rich |
| | copy/paste ranges with spreadsheets; merged cells, uneven rows, overflow | ✅ | U tables; B rich "paste a spreadsheet…" |
| | undoable; concurrent shape changes documented | ✅ | U collab "concurrent table shape…"; docs/collaboration.md |
| **Rich content** | code blocks: language, highlighting, indentation, copy | ✅ | B rich |
| | images: captions, alt, resize, pasted screenshots, drag-and-drop | ✅ | B rich "images…"; B platform "dropping an image file…" |
| | attachments, embeds, equations, emoji, mentions, hashtags, typeahead | ✅ (equation rendering needs a host hook) | U; B rich |
| | upload/suggestion APIs: cancellation, stale results, retries, delete during upload | ✅ | U features "uploads", "latestRunner"; B rich |
| **Import/export** | lossless JSON incl. custom data | ✅ | U serialization |
| | HTML and Markdown with documented limits | ✅ | U; docs/serialization.md |
| | clipboard formats; Word / Google Docs fixtures | ✅ (fixtures are representative, hand-assembled clipboard HTML, not captures from every app version) | U serialization |
| | autosave hooks, draft recovery, save status, late responses | ✅ | U features "autosave"; B platform |
| | untrusted input sanitized; unsupported nodes preserved inert | ✅ | U serialization; B platform "missing extension…" |
| **Collaboration** | optional module; two-client example; concurrent edits, presence, remote selections, reconnect, offline merge | ✅ | U collab; B collab |
| | local-user undo preserving others' edits | ✅ | U collab; B collab |
| | anchored comments; suggestions; restorable versions; anchor rules documented | ✅ (suggestions: inline text only) | U features; docs/collaboration.md |
| | adapters for identity, storage, transport, permissions; backend checks documented | ✅ (WebSocket relay documented, not tested) | docs/collaboration.md |
| **Customization** | ready-made / configurable / headless entry points | ✅ | examples; PG |
| | typed extension API incl. dependencies, priority, conflicts, cleanup, compatibility | ✅ | U features "extensions" |
| | CSS variables, scoped styles, unstyled, accessible controls, replaceable labels and icons, multiple editors | ✅ | B platform |
| | plain HTML example (no build) | ✅ | B integrations; PV |
| | React app: custom issue reference + async menu | ✅ | B integrations |
| | Vue 3 app: Vuetify toolbar + custom callout | ✅ | B integrations |
| | same saved document in all three; shared framework-independent extensions; host rendering overrides | ✅ | B integrations "the same saved document…" |
| **Packaging** | typed exports, browser ES module, optional CSS, adapters with optional peers; vanilla installs no framework | ✅ | PV |
| | heavy optional features load only when imported | ✅ | docs/benchmarks.md "Bundle sizes" |
| | playground: mode switch, feature toggles, inspector, customization examples | ✅ (visually checked; no automated test of the playground page) | PG |

## 5. Additional product features (beyond the reference inventory)

| Feature | Notes | Evidence |
| --- | --- | --- |
| Two editing modes on one document | classic and block, switchable live | B editing |
| Multi-page documents | page tabs (add, rename, duplicate, reorder, delete), "all pages" sheet view, page break splits a page, print styles | U features "pages"; B blocks |
| Block selection across both modes | Escape, Shift+Arrow, typing replaces | B platform |
| Unknown-node preservation and recovery | missing extensions never lose data | U; B platform |
| Sanitizing HTML importer without a DOM | works in Node; no sanitizer dependency | U serialization |
| `renderToHTML` / `renderToText` for SSR and SEO | semantic HTML with optional block ids | U features "small helpers"; PV |
| Upload manager | previews, progress, abort on delete, retry, undo-safe | U; B rich |
| Autosave with revision tracking and drafts | | U; B platform |
| Suggestions (track changes) | inline text | U features |
| Deterministic handling of duplicate ids after concurrent moves | | U collab (fuzz) |
| Decorations via CSS Custom Highlight API | find, syntax, presence without DOM changes | B rich, collab |
| Large-document mode | `content-visibility` above 400 blocks | docs/benchmarks.md |

## 6. Known gaps and limitations

- No verified parity with Lexical 0.53.0 (see the top of this file).
- Not implemented: plain-text-only mode, context menu, text-case transforms, inline images,
  table row resizing and hover add-buttons, emoticon conversion, speech-to-text, autocomplete,
  drawing/poll/sticky/date/ruby nodes, Dragon support, a devtools browser extension, Prism/Shiki
  adapters, a template manager UI, a table-of-contents UI.
- Equations render through a host-supplied function; without it the LaTeX source is shown.
- Suggestions track inline text only.
- No virtualized rendering; see docs/benchmarks.md for where large documents slow down.
- Real IMEs, mobile keyboards and screen readers are covered only by the manual checklist
  (docs/testing.md); Shadow DOM and iframe mounting are untested.
