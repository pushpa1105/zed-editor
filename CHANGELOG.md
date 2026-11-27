# Changelog

All notable changes to `@buffmomo/zeditor` are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). How releases are cut is described in
[RELEASING.md](RELEASING.md).

While the version is `0.x`, a **minor** release (0.1 → 0.2) may contain breaking changes; they are
always listed under **Changed** or **Removed** with a migration note. Patch releases never break
the public API or the stored JSON format.

## [Unreleased]

### Added

### Changed

### Fixed

## [0.2.0] - 2026-11-27

### Added

- Block mode: an empty to-do, list item, heading or quote that holds the caret shows a hint
  ("To-do", "List", "Heading", "Quote"), as empty paragraphs already did. The texts are the
  labels `placeholder.todo`, `placeholder.list`, `placeholder.heading`, `placeholder.quote`.
- `diffInline(old, next)` (and the `InlineChange` type): the smallest single change that turns
  one block's inline content into another; a change of marks only is reported as formatting.
- `mapSelection(..., foreign)` and the transaction meta `foreign`: mark steps the user did not
  make (another author, a server update), so text inserted exactly at the caret lands after it.
  `origin: 'remote'` implies it.
- Labels `fontSize.default` ("Size") and `fontFamily.default` ("Font").

### Changed

- **Collaboration: new layout of the shared Yjs document.** The text of all blocks now lives
  in one `Y.Text` (`doc.getText('flow')`) with a start and an end marker per block, instead
  of one `Y.Text` inside each block's map. Documents written by 0.1.0 are read and converted
  when an editor binds to them, and `sharedBlocks` reads both layouts. *Migration:* update
  every client and server of a document together; a 0.1.0 client cannot read the new layout.
  Code that read `blockMap.get('text')` directly should call `sharedBlocks(doc, editor)`.
- Collaboration: two users moving the same block at the same time now leave **one** block
  (the entry created first; every client deletes the other). Before, both survived and one
  was renamed `id-<client>-<clock>`.
- Comment marks keep their thread ids sorted.
- The placeholder of an empty document takes the text style of its block (heading size in an
  empty heading, italic in a quote) and is read from the CSS variable `--z-placeholder` on the
  editing area. The `data-placeholder` attribute is still set; a custom stylesheet that drew it
  with `.z-editable.z-empty::before` should target `.z-empty .z-content[data-empty]::before`.
- The block menu (grip button) is more compact: plain icons, tighter rows.
- Toolbar: the font size and font family dropdowns read "Size" and "Font" while nothing is
  set, instead of both reading "Default".

### Fixed

- The placeholder of an empty document no longer sits on top of the checkbox, bullet, number
  or quote bar when the only block is a list item or a quote: it is drawn inside the empty
  block instead of at the corner of the editing area.
- The "+" button next to a block no longer leaves a "/" behind: when its menu is dismissed
  with Escape or by moving the caret away before anything is typed, the slash is removed.
- **Collaboration: Enter, Backspace-at-start and moving a block no longer copy text.** Two
  people splitting or joining the same paragraph at once do not duplicate its text; text
  typed after the split point follows the tail into the new paragraph, together with the
  caret; text typed in a paragraph that someone else joins to the previous one, or moves, is
  kept instead of being lost.
- Collaboration: two comment threads anchored to overlapping text at the same moment both
  keep their whole range (one thread no longer cuts the other's anchor on the overlap).
- Collaboration: a block whose type was left unset by two users' interleaved undos no longer
  stays an "unknown" block on the clients that received it in that state.
- **Collaboration: two people typing at the same caret position no longer interleave their
  characters.** A character arriving from another user exactly at your caret now lands after
  the caret instead of pushing it forward, so each person's text stays in one piece.
- Collaboration: text another user types at the edge of your selection no longer becomes part
  of the selection.
- Collaboration: formatting you switched on for the next character (for example Ctrl+B with
  nothing selected) is no longer dropped when someone else's edit arrives first.
- Collaboration: formatting, links and comment anchors are sent as formatting of the existing
  characters instead of deleting and re-inserting them. Two people making the same text bold
  at once no longer duplicate it, and text someone types inside a word while you format it
  stays where it was typed.
- Collaboration: other users' carets and selections are shown at the right place immediately
  after you type before them (they are published as Yjs relative positions; the plain offsets
  are still sent for older clients).
- Collaboration: undo and redo put the caret where the restored text now is, even after other
  people typed earlier in the same block; redo places it after the redone text.
- `applyBlockChanges`: a text update from the server changes only the part of the block that
  differs, so your caret keeps its place instead of jumping to the end of the block.

## [0.1.0] - 2026-11-27

First public release.

### Added

- **Engine**: a document model, schema, steps, transactions, history, selection and commands written
  from scratch in TypeScript, with no editor framework underneath and no runtime dependencies in the base
  bundle. It runs headless in Node, workers and SSR (`@buffmomo/zeditor/core`).
- **Two interfaces on one engine**: *Classic* (toolbar, continuous document) and *Blocks* (slash
  menu, block handles, nesting, drag to reorder). Switching keeps the document, caret, scroll
  position and undo history.
- **Rich text and blocks**: headings, lists and check lists, quotes, code with syntax highlighting,
  callouts, toggles and toggle headings, columns, dividers, equations, images, video, files,
  embeds, mentions, emoji, links, page breaks and multi-page documents.
- **Tables**: cell selection, merge and split, header rows and columns, column widths, colours and
  alignment, spreadsheet paste, and nested tables up to four levels when importing HTML.
- **Databases**: table, board, list, gallery, calendar and timeline views. Typed properties, including
  formula, relation, rollup and custom types. Filters, sorts, grouping and calculations; every row
  is a page.
- **Workspace blocks**: a live table of contents, bookmarks, page links (`[[`), date chips, template
  buttons, synced copies, and sub-pages with breadcrumbs.
- **Serialization**: lossless JSON, HTML and Markdown import and export, rich clipboard, and server-side
  rendering (`renderToHTML`, `renderToText`) for SEO.
- **Collaboration and review** (`@buffmomo/zeditor/collab`): Yjs binding, presence, offline recovery,
  comments, suggestions and version history.
- **Backend sync**: stable block IDs (`idGenerator`, `remapIds`), block events
  (`block:created/updated/deleted/moved/…`) and `createBlockSync` / `applyBlockChanges`.
- **Integrations**: plain HTML (a single-file browser module), React (`<ZEditor>`, hooks) and Vue 3
  (`<ZEditor>`, composables).
- **Customization**: extensions for nodes, marks, commands, keymaps, input and paste rules, menus,
  renderers and labels. Feature toggles, a custom or headless toolbar, CSS-variable themes, dark
  mode and an unstyled mode.
- **Accessibility**: native input and IME, keyboard navigation in every menu, ARIA labels, and support
  for touch devices.
- **Documentation website** with a live demo, the playground and the examples, deployed to GitHub
  Pages.

[Unreleased]: https://github.com/pushpa1105/zed-editor/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/pushpa1105/zed-editor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pushpa1105/zed-editor/releases/tag/v0.1.0
