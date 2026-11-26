# Changelog

All notable changes to `@z-packages/zeditor` are recorded here.
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

## [0.1.0] - 2026-11-27

First public release.

### Added

- **Engine**: a document model, schema, steps, transactions, history, selection and commands written
  from scratch in TypeScript, with no editor framework underneath and no runtime dependencies in the base
  bundle. It runs headless in Node, workers and SSR (`@z-packages/zeditor/core`).
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
- **Collaboration and review** (`@z-packages/zeditor/collab`): Yjs binding, presence, offline recovery,
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

[Unreleased]: https://github.com/pushpa1105/zed-editor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/pushpa1105/zed-editor/releases/tag/v0.1.0
