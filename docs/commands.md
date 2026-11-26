# Commands and the Editor API

This page is for developers who drive the editor from code. Everything the toolbar, menus and
keyboard do goes through a **command**, and you can call the same commands yourself.

```js
const z = createEditor({ element: '#editor' });
z.commands.toggleMark('bold');            // typed: editor.commands.<name>(...)
z.editor.exec('insertTable', 3, 4);       // by name: editor.exec(name, ...args)
```

Every command returns `true` if it did something, and `false` otherwise: it doesn't apply here, the
editor is read-only, or the arguments are invalid. Commands act on the current selection unless
they take IDs. A command is one undo step. Several commands inside one `editor.update(() => …)`
form a single undo step.

Which commands exist depends on the enabled features (`features` option). The list below says
where each one comes from. Extensions can add their own commands ([extensions.md](extensions.md)).

- [Text and marks](#text-and-marks)
- [Blocks](#blocks)
- [Selection and history](#selection-and-history)
- [Lists, layout and media](#lists-layout-and-media)
- [Tables](#tables)
- [Pages](#pages)
- [Workspace blocks](#workspace-blocks)
- [Databases](#databases)
- [Editor options](#editor-options): what `createHeadlessEditor` / `new Editor` accept
- [Editor API](#editor-api): methods and properties of `editor`
- [The `createEditor` instance](#the-createeditor-instance)
- [UI events](#ui-events): how the default UI and your app talk to each other

## Text and marks

Base feature (always on).

| Command | What it does |
| --- | --- |
| `insertText(text, opts?)` | Type text at the selection, replacing it. `opts.marks` sets the marks of the new text; `opts.rules: false` skips input rules (Markdown shortcuts, autolinks) |
| `insertLineBreak()` | Soft line break inside the block (Shift+Enter) |
| `splitBlock()` | Enter: split the block at the caret (or leave an empty list item / quote) |
| `deleteSelection()` | Delete the selected text, blocks or cell contents |
| `deleteBackward(unit?)` / `deleteForward(unit?)` | Backspace / Delete by `'char'` (default, grapheme-aware), `'word'` or `'line'`; merges blocks at a boundary |
| `insertInline(atom, opts?)` | Insert an inline atom (mention, date, page link, inline equation…) as `{ atom: type, attrs }`; `opts.trailingSpace` adds a space after it |
| `setMark(type, value?)` / `unsetMark(type)` / `toggleMark(type, value?)` | Apply / remove / toggle a mark: `bold`, `italic`, `underline`, `strike`, `code`, `sub`, `sup`, `color` (value: CSS colour), `highlight` (value: colour), `fontSize`, `fontFamily`, … With a collapsed caret the mark applies to the next typed text |
| `clearFormatting()` | Remove inline formatting and alignment from the selection (keeps comments and suggestions) |
| `setLink(href, opts?)` | Link the selection (or insert `opts.text` as a link). Unsafe URLs (`javascript:` …) are refused |
| `unsetLink()` | Remove the link at the selection |

## Blocks

Base feature.

| Command | What it does |
| --- | --- |
| `insertBlocks(blocks, opts?)` | Insert block JSON after the current block. `opts.after: id` puts them after another block; `opts.replace: id` replaces an empty block; `opts.select: false` keeps the selection. Blocks are validated like loaded content |
| `insertBlock(type, attrs?, opts?)` | Insert one new block of a type (`'divider'`, `'callout'`, `'code'`…) |
| `setBlockType(type, attrs?, ids?)` | Turn text blocks into another type ("turn into"): `'paragraph'`, `'heading'` + `{ level }`, `'quote'`, `'code'`, `'list'` + `{ kind }` |
| `toggleBlockType(type, attrs?)` | Like `setBlockType`, but back to a paragraph when already that type |
| `setAlign(align)` | `'left'`, `'center'`, `'right'`, `'justify'` for the selected text blocks (and a selected image) |
| `indent()` / `outdent()` | Tab / Shift+Tab: nest under the previous block (lists, blocks mode) or increase the indent level |
| `setBlockAttrs(id, attrs)` | Change attributes of any block; validated against the block's schema |
| `deleteBlocks(ids?)` | Delete blocks (default: the selected ones) |
| `duplicateBlocks(ids?)` | Copy blocks below themselves (new IDs) |
| `moveBlocksUp(ids?)` / `moveBlocksDown(ids?)` | Alt+↑ / Alt+↓ |
| `moveBlocksTo(ids, targetId, place?)` | Move next to (`'before'` / `'after'`) or into (`'inside'`) another block, as drag and drop does. Invalid moves return false |
| `wrapIn(type, attrs?, ids?)` | Wrap the selected top-level blocks in a container (callout, toggle, quote container, column…) |
| `unwrap(id?)` | Replace a container by its children |
| `clearDocument()` | Replace everything with one empty paragraph |

## Selection and history

| Command / method | What it does |
| --- | --- |
| `selectAll()` | Ctrl+A, widening on each press: the block's text (blocks mode), then the enclosing table cell / column / page, then the whole document |
| `selectBlocks(ids)` | Select whole blocks (block selection, as Esc does in blocks mode) |
| `selectCurrentBlock()` | Select the block holding the caret |
| `undo()` / `redo()` | Undo / redo (the built-in history, or collaboration's history when installed) |
| `editor.setSelection(sel)` | Set a selection object: `textSel(id, offset, focusId?, focusOffset?)`, `blockSel(ids)`, or a cell selection `{ type: 'cell', table, anchor, focus }` (helpers in `@z-packages/zeditor/core`) |
| `editor.cutHistory()` | The next change starts a new undo step (instead of merging with typing) |

## Lists, layout and media

| Command | Feature | What it does |
| --- | --- | --- |
| `toggleCheck(id?)` | `lists` | Check / uncheck a to-do item (Ctrl+Enter). Fires `block:completed` / `block:uncompleted` |
| `insertColumns(count?)` | `layout` | Insert 2–6 side-by-side columns |
| `toggleOpen(id?)` | `layout` | Open / close a toggle block. Allowed in read-only mode (it's a viewing state saved in the document) |
| `insertImage(attrs)` | `media` | Insert an image: `{ src, alt?, caption?, width?, align? }`. Unsafe URLs are refused |
| `insertFile(attrs)` | `media` | Insert a file attachment: `{ url, name, size?, mime? }` |
| `insertEmbed(url)` | `media` | Embed a video from a known provider. Built in: YouTube and Vimeo; add others by setting `editor.storage.embedProviders = [...defaultEmbedProviders, { name, match: (url) => embedSrc | null, aspect? }]` (type `EmbedProvider`; only `https:` sources are used). Other URLs are refused |
| `insertEquation(tex?, inline?)` | `equation` | A LaTeX equation, as a block or inline |

## Tables

Feature `tables`. Table commands act on the table holding the selection. With nested tables,
that's the innermost one.

| Command | What it does |
| --- | --- |
| `insertTable(rows?, cols?, opts?)` | Insert a table (default 3 × 3 with a header row; `opts.header: false` for none). Inside a cell it creates a nested table |
| `addRow(where?)` / `addColumn(where?)` | Add a row / column `'after'` (default) or `'before'` the selection |
| `deleteRow()` / `deleteColumn()` / `deleteTable()` | Remove the selected rows / columns, or the whole table |
| `mergeCells()` / `splitCell()` | Merge a rectangular cell selection into one cell; split a merged cell back |
| `toggleHeaderRow()` / `toggleHeaderColumn()` | Make the first row / column header cells (or not) |
| `setColumnWidth(tableId, col, width)` | Column width in px (0 = automatic) |
| `nextCell(dir?)` | Tab / Shift+Tab: next / previous cell; Tab in the last cell adds a row |
| `pasteCells(matrix)` | Paste a cell matrix (from `parseTSV` or a copied range) at the selection, growing the table if needed |
| `selectTable()` | Select every cell of the table |

## Pages

Feature `pages` ([user guide §9](user-guide.md)).

| Command | What it does |
| --- | --- |
| `enablePages()` | Turn a single-page document into a paged one (everything goes into "Page 1") |
| `disablePages()` | Join all pages back into one document |
| `addPage(title?, afterId?)` | Add a page (after the active one by default) and open it |
| `addSubPage(parentId?, title?)` | Add a page nested under another (default: the active page) |
| `setPageParent(id, parentId \| null)` | Move a page under another page, or to the top level; refuses cycles |
| `removePage(id?)` | Delete a page; its sub-pages move up to its parent |
| `renamePage(id, title)` | Rename (page links to it update) |
| `movePage(id, index)` | Reorder |
| `duplicatePage(id?)` | Copy a page with its content |
| `setActivePage(id)` | Show a page (view state; fires `page`) |
| `insertPageBreak()` | A page break for printing / the paged view |

## Workspace blocks

Feature `notion` ([databases.md](databases.md#workspace-blocks)).

| Command | What it does |
| --- | --- |
| `insertToc()` | Table of contents of the current page |
| `insertBookmark(url, at?)` | Link card; title / description come from your `linkPreview` adapter |
| `insertDate(date?)` | Inline date chip (`YYYY-MM-DD`, default today) |
| `insertPageLink(pageId)` | Inline link to a page of the document |
| `saveAsTemplate(ids?, label?)` | Turn the selected blocks into a template button that inserts fresh copies |
| `useTemplate(buttonId)` | Run a template button |
| `setToggleLevel(level \| null, id?)` | Make a toggle heading of level 1–3 (null: plain toggle) |
| `insertSyncedCopy(sourceId?, at?)` | A read-only live copy of a block |

## Databases

Feature `database`. Full guide: [databases.md](databases.md). IDs: `dbId` is the database
block's ID, `rowId` a row's (row = `db_row` block), `propId` a property's (from
`dbProperties(db)`), `viewId` a view's. Commands that take an optional `viewId` act on the
active view by default.

| Command | What it does |
| --- | --- |
| `insertDatabase(view?, opts?)` | Insert a database (`'table'`, `'board'`, …) with optional `title`, `properties`, `rows` |
| `dbSetTitle(dbId, title)` | Rename the database |
| `dbAddRow(dbId, cells?, index?)` / `dbDeleteRow(rowId)` / `dbDuplicateRow(rowId)` | Rows |
| `dbMoveRow(rowId, targetRowId, place?)` | Reorder rows (manual order, used when a view is unsorted) |
| `dbSetCell(rowId, propId, value)` | Set a cell: text, number, boolean, `YYYY-MM-DD`, option ID (select), option IDs (multi-select), row IDs (relation) |
| `dbAddProperty(dbId, def?)` / `dbUpdateProperty(dbId, propId, patch)` / `dbDeleteProperty(dbId, propId)` / `dbMoveProperty(dbId, propId, toIndex)` | Properties (columns): name, type, options, formula, relation, rollup, width |
| `dbAddOption(dbId, propId, name, color?)` | Add a choice to a select / multi-select |
| `dbAddView(dbId, type?, name?)` / `dbUpdateView(dbId, viewId, patch)` / `dbDeleteView(dbId, viewId)` / `dbSetView(dbId, viewId)` | Views and their settings (`hidden`, `groupBy`, `hideEmptyGroups`, `dateProp`, `endProp`, …) |
| `dbSort(dbId, propId \| null, dir?, viewId?)` | Sort by a property (null: manual order) |
| `dbFilter(dbId, filters \| null, viewId?)` / `dbFilterMode(dbId, 'and' \| 'or', viewId?)` | Filters: `{ prop, op, value }` with `op` one of `DB_FILTER_OPS` |
| `dbGroupBy(dbId, propId \| null, viewId?)` | Group by a select property |
| `dbToggleProperty(dbId, propId, viewId?)` | Show / hide a property in a view |
| `dbCalculate(dbId, propId, calc \| null, viewId?)` | Footer calculation (`DB_CALCS`: count, sum, avg, min, max, percent_checked, …) |
| `dbOpenRow(rowId, open?)` | Open / close a row as a page |

## Editor options

`createHeadlessEditor(options)` and `new Editor(options)` accept these; `createEditor` accepts
them too, plus its UI options ([user guide §14](user-guide.md)).

| Option | Default | Meaning |
| --- | --- | --- |
| `content` | one empty paragraph | Initial document: `{ format: 'zeditor', version: 1, blocks }` or a block array. Validated and repaired; problems are reported by `editor.validate` / the `issues` event |
| `features` | all on | Turn feature groups on / off: `lists`, `code`, `tables`, `layout`, `media`, `equation`, `mentions`, `hashtag`, `emoji`, `markdownShortcuts`, `autolink`, `pages`, `comments`, `suggestions`, `database`, `notion` |
| `extensions` | — | Extra extensions added after the built-in ones ([extensions.md](extensions.md)) |
| `baseExtensions` | `defaultExtensions(features)` | Replace the built-in extension set entirely (advanced: you then choose every node, mark, command and shortcut yourself; `features` is ignored) |
| `mode` | `'classic'` | `'classic'` (word-processor) or `'block'` (Notion-style blocks) |
| `readOnly` | `false` | Viewing only |
| `history` | `{ delay: 600, depth: 500 }` | Typing within `delay` ms merges into one undo step; `depth` steps are kept. `false` turns the built-in history off (collaboration brings its own) |
| `characterLimit` | none | Edits that would exceed it are rejected |
| `labels` | English | Override any UI string by key (translations), e.g. `{ 'db.newRow': 'Nouveau' }`. Keys: see `editor.labels` |
| `locale` | the browser's | BCP 47 language tag (`'de-DE'`, `'ja'`) used to format dates: date chips, database calendar / timeline month and weekday names, version history times |
| `idGenerator` | random IDs | Make IDs for new blocks ([events-and-sync.md](events-and-sync.md#generating-ids-for-new-blocks)) |
| `mentions` | — | `{ search(query, { signal }) → Promise<{ id, label }[]> }` for `@` mentions |

## Editor API

`createEditor(...)` returns an instance whose `.editor` is the `Editor`; the headless
`createHeadlessEditor()` returns an `Editor` directly.

**Properties**

| Property | Meaning |
| --- | --- |
| `doc` | The document tree: `doc.root`, `doc.blocks` (top level), `doc.get(id)`, `doc.descendants(block?)`, `doc.closest(block, pred)`, `doc.size` |
| `selection` | The current selection (`text`, `block` or `cell`), or `null` |
| `activeBlockId` | ID of the block holding the caret |
| `mode` / `readOnly` | `'classic'` \| `'block'`; read-only flag |
| `commands` | Typed commands (this page) |
| `schema` | Node and mark specs: `schema.node(type)`, `schema.create(type, attrs?, content?, children?)`, `schema.canContain(parent, type)` |
| `storage` | Per-extension scratch space (view state such as open database rows lives here) |
| `history` | Undo provider (`undo`, `redo`, `canUndo`, `canRedo`, `clear`) |
| `revision` | Increases on every document change |
| `isEmpty` | True when the document is one empty paragraph |
| `labels` | UI strings in use (override with the `labels` option) |
| `extensions`, `inputRules`, `pasteRules`, `keymaps`, `toolbarItems`, `slashItems`, `blockActions`, `typeaheads` | What the installed extensions contribute |
| `filters`, `appenders` | Hooks run on every transaction: a filter can reject it, an appender can add steps |
| `view` | The DOM view when mounted (`null` headless) |

**Methods**

| Method | What it does |
| --- | --- |
| `getJSON()` / `setJSON(json, opts?)` | Read / replace the document. `setJSON` validates, returns the list of repaired issues, and resets history unless `{ history: true }` |
| `validate(json)` | The issues `setJSON` would report, without loading |
| `update(fn, opts?)` | Run a transaction: `fn(tr)` with `tr.insert`, `tr.remove`, `tr.move`, `tr.replaceText`, `tr.setAttrs`, `tr.setType`, `tr.select`, … `opts`: `origin`, `history: false`, `group` |
| `exec(name, ...args)` | Run a command by name |
| `setSelection(sel, { scroll? })` | Select |
| `undo()` / `redo()` / `canUndo()` / `canRedo()` / `cutHistory()` | History |
| `setMode(mode)` / `setReadOnly(flag)` | Switch mode / read-only (not undo steps) |
| `setStoredMarks(marks \| null)` | Marks for the next typed text |
| `remapIds(map)` | Rename blocks ([events-and-sync.md](events-and-sync.md#renaming-blocks-to-server-assigned-ids)) |
| `on(event, fn)` → `off()` / `emit(event, payload)` | Events ([events-and-sync.md](events-and-sync.md#events)) |
| `hasListener(event)` | Whether anything listens to an event (used to detect a missing handler, e.g. Comment) |
| `listenerCount()` | Total listeners (for leak tests) |
| `label(key, fallback?)` | A UI string |
| `focus()` | Focus the view |
| `hasExtension(name)` | Whether an extension is installed (`'tables'`, `'pages'`, `'database'`, …) |
| `onDestroy(fn)` / `destroy()` | Clean-up |

## The `createEditor` instance

| Member | Meaning |
| --- | --- |
| `editor`, `view`, `element` | The `Editor`, the DOM view, the outer element |
| `commands` | Same as `editor.commands` |
| `uploads`, `autosave` | The upload manager and autosave controller, when configured |
| `getJSON()` / `setJSON(doc)` | Document in / out |
| `getState()` / `subscribe(fn)` | A snapshot for UI frameworks (active marks, block type, can undo / redo, counts, …) and change notifications. The React / Vue adapters use these |
| `setMode(mode)` / `setReadOnly(flag)` / `focus()` / `destroy()` | — |

Browser-only helpers exported from `@z-packages/zeditor` for building your own UI from parts:
`createToolbar`, `createFloatingToolbar`, `createLinkPopover`, `createTypeahead`,
`createBlockHandles`, `createFindPanel`, `createStatusBar`, `createPageTabs`, `createTableTools`,
`createMediaUI`, `createReviewPanel`, `createNotices`, `inlinePrompt`, `revealBlock`
(scroll to and flash a block), `setIcons` (replace icons), `formatShortcut` / `keyName`
(display shortcuts), `PALETTE` / `HIGHLIGHTS` (colour lists), and the renderer types for custom
node views (`NodeRenderer`, `MarkRenderer`, `InlineRenderer`, `nodeRenderers`, `markRenderers`).
Signatures: [api-reference.md](api-reference.md).

## UI events

The default UI listens to these events, so your app can trigger the same actions, or replace a
part of the UI by listening itself (with `ui: false`, or after removing that part). Payloads are in
braces.

| Event | Emitted by | Default handling |
| --- | --- | --- |
| `ui:link` | Link button, Ctrl+K | opens the link editor |
| `ui:find` | Find button, Ctrl+F | opens the find & replace panel |
| `ui:image` / `ui:file` / `ui:embed` `{ blockId? }` | Insert menu items | file picker (or a URL prompt without an upload handler) / embed URL prompt |
| `ui:bookmark` `{ blockId }` | "Bookmark" insert item | URL prompt |
| `ui:files` `{ files, source: 'paste' \| 'drop' }` | pasting / dropping files | uploads them; without an `upload` handler, shows a notice |
| `ui:retryUpload` `{ id }` | Retry on a failed upload | retries |
| `ui:comment` | Comment button | comment prompt (needs `createReviewPanel`); with no listener a notice explains comments are off |
| `ui:copyBlockLink` `{ id }` | block menu "Copy link" | copies `page-url#<id>` and emits `ui:blockLink { id, url }` |
| `ui:error` / `ui:notice` `{ message }` | anything that failed / informs | shown as a notice ([user guide](user-guide.md)) |
| `db:open` `{ id, open }` | opening / closing a database row | shows the row's page |
| `mount` `{ view, element }` | `createEditor` | — (for plugins that need the DOM) |
| `upload` `{ id, state, … }` | the upload manager | progress on the image / file block; failures shown as notices |
| `sync:status` `{ status, error? }` | `createBlockSync` | — |
