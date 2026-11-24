# Databases and workspace blocks

Notion-style structured content, built from the same blocks, steps and extension API as
everything else. Two features, both on by default:

| Feature flag | Adds |
| --- | --- |
| `database` | databases with typed properties and table / board / list / gallery views |
| `notion` | table of contents, bookmarks, links to pages (`[[`), date chips, template buttons, toggle headings |

```js
createEditor({ element: '#editor', features: { database: true, notion: true }, linkPreview: async (url, { signal }) => fetchMeta(url, signal) });
```

Both features are part of the base bundle (they add about 14 kB gzipped to it, see
[benchmarks](./benchmarks.md)); switching a flag off removes the feature from the editor but not
from the bundle.

In block mode type `/database`, `/board`, `/toc`, `/bookmark`, `/date`, `/template`,
`/toggle heading`; type `[[` to link to a page.

## Databases

### Model

```jsonc
{
  "type": "database",
  "attrs": {
    "title": "Launch tasks",
    "properties": [
      { "id": "title", "name": "Task", "type": "title" },
      { "id": "p2", "name": "Status", "type": "select", "options": [{ "id": "todo", "name": "To do", "color": "gray" }] },
      { "id": "p3", "name": "Points", "type": "number" }
    ],
    "views": [
      { "id": "v1", "name": "Table", "type": "table", "sorts": [{ "prop": "p3", "dir": "desc" }], "calc": { "p3": "sum" } },
      { "id": "v2", "name": "Board", "type": "board", "groupBy": "p2", "filters": [{ "prop": "p3", "op": "gt", "value": "1" }] }
    ],
    "view": "v1"
  },
  "children": [
    { "type": "db_row", "attrs": { "cells": { "title": "Design", "p2": "todo", "p3": 3 } }, "children": [ /* the row's page: any blocks */ ] }
  ]
}
```

- **Every row is a block, and a page.** A `db_row` holds its cell values and ordinary child
  blocks (headings, lists, images, even another database). "Open" on a row reveals that content
  for editing. Undo, clipboard, comments, find/replace and collaboration work on rows without
  any database-specific code.
- **Property types:** `title` (exactly one, always first), `text`, `number`, `select`,
  `multi_select`, `checkbox`, `date`, `url`, `email`, `person` (free text).
- **Views** are saved per database and independent: each has its own filters, sorts, grouping,
  hidden properties and column calculations. Sorting and filtering never change the document
  order of the rows; they only change what a view shows.

### Views

| View | Shows | Notes |
| --- | --- | --- |
| `table` | one row per record, one column per visible property | header menu per property; calculation footer; Enter moves down a column |
| `board` | cards in columns, one per option of a `select` property | drag a card to another column to change the value; uses `groupBy` or the first select property |
| `list` | compact rows: title plus filled properties | |
| `gallery` | cards in a responsive grid | cards hide empty properties until opened |

Filters: `contains`, `not_contains`, `is`, `is_not`, `empty`, `not_empty`, `gt`, `lt`,
`checked`, `unchecked` (all filters must match). Sorts: by any property; selects sort by option
order, text naturally (`item 2` before `item 10`), empty values last in both directions.
Calculations: `count`, `filled`, `empty`, `unique`, `sum`, `avg`, `min`, `max`, `checked`,
`percent_checked`.

### API

Everything the UI does is a command, so a custom interface (or a script in Node) can do the same:

```js
import { createHeadlessEditor, createDatabase, queryDatabase } from '@z-packages/zeditor/core';

const editor = createHeadlessEditor();
editor.commands.insertDatabase('table', {
  title: 'Tasks',
  properties: [{ name: 'Name', type: 'title' }, { name: 'Points', type: 'number' }],
  rows: [{ Name: 'Design', Points: 3 }, { Name: 'Build', Points: 8 }],
});
const db = editor.doc.blocks.find((b) => b.type === 'database');

editor.commands.dbAddRow(db.id, { title: 'Ship' });
editor.commands.dbSetCell(rowId, propId, 5);              // coerced and validated per property type
editor.commands.dbAddProperty(db.id, { name: 'Owner', type: 'person' });
editor.commands.dbUpdateProperty(db.id, propId, { type: 'multi_select' }); // text values become options
editor.commands.dbAddOption(db.id, propId, 'Blocked');    // id in editor.storage.db.lastOption
editor.commands.dbAddView(db.id, 'board');
editor.commands.dbSort(db.id, propId, 'desc');
editor.commands.dbFilter(db.id, [{ prop: propId, op: 'gt', value: '2' }]);
editor.commands.dbGroupBy(db.id, selectPropId);
editor.commands.dbCalculate(db.id, propId, 'sum');
editor.commands.dbToggleProperty(db.id, propId);          // hide / show in the active view
editor.commands.dbOpenRow(rowId);                         // caret into the row's page

const { rows, groups, calc, visible } = queryDatabase(editor.doc.get(db.id)); // pure evaluation of the active view
```

Also: `dbSetTitle`, `dbDeleteRow`, `dbDuplicateRow`, `dbMoveRow`, `dbDeleteProperty`,
`dbUpdateView`, `dbDeleteView`, `dbSetView`. `createDatabase(editor, …)` builds the block JSON
without inserting it.

### Behaviour to know

- **Validation.** Database attributes are untrusted like any stored data: property and view
  definitions, option colours, filter operators and cell values are validated on load; unknown
  types fall back to `text` / `table`; malformed entries are dropped; a missing title property
  is added. Cell values are coerced when set (`dbSetCell(row, numberProp, 'abc')` clears the cell).
- **Deleting a property** removes its cell values and every filter, sort, grouping and hidden
  entry that referenced it, in one undoable step.
- **Rows are isolated**: a selection cannot extend from one row's page into another row or out
  of the database, so Backspace at the start of a row's page never merges rows.
- **A caret that lands in a collapsed row** (find, undo, a remote edit) opens that row.
- **Open / closed is view state**, not saved in the document. The active view is saved.
- **Read-only** editors show databases without editing controls.
- **Without the feature** (or in an older client) a database is preserved as an inert
  placeholder and written back unchanged.

### Serialization

| Format | Result |
| --- | --- |
| JSON | lossless |
| HTML | a semantic `<table>` (caption, `<th scope>` headers, links, `<time>`; row pages in a full-width row) — readable by crawlers and other tools — plus the full block JSON in `data-z-raw`, so re-importing our own HTML is lossless |
| Markdown | a GFM table of the cell texts. **Lossy**: property types, options, views and row pages are not represented; it re-imports as a plain table |
| Plain text | the title |

### Collaboration

- Each row is its own shared block: edits to **different rows merge**, as do concurrent row
  insertions and deletions.
- Cell values of **one row** are a single attribute object: two users editing different cells
  of the same row at the same moment → last writer wins for that row.
- Properties and views live in the database block's attributes: concurrent schema or view
  changes (two users adding a property at once) → last writer wins for the whole definition.
  Row data is never lost by this, but one of the two definition changes is.
- Row page content merges like any other content.

### Not implemented

Relations, rollups, formulas, calendar and timeline views, per-property filters with AND/OR
groups, row templates, synced databases (one database shown in several places), column drag
reordering and column resize handles in the database table (widths can be set through
`dbUpdateProperty(…, { width })`), and virtualized rows — every row is in the DOM.

## Workspace blocks

| Block | What it does | Notes |
| --- | --- | --- |
| **Table of contents** (`toc`) | live outline of the headings on its page; click to jump | exported as an empty `<nav data-toc>` / `<!-- toc -->` marker — the static HTML does not contain the links |
| **Bookmark** (`bookmark`) | link card with title, description, image | metadata comes from your `linkPreview(url, { signal })` adapter; the editor never fetches URLs itself. Results are validated, ignored if the bookmark was removed meanwhile, and are not undo steps |
| **Page link** (`page_link`, inline) | link to a page of the same multi-page document; type `[[` | renaming the page updates its links; a link to a deleted page is shown struck through |
| **Date** (`date`, inline) | `@Today`-style chip; click to change | stored as `YYYY-MM-DD`; exported as `<time datetime>` |
| **Template button** (`template_button`) | inserts fresh copies of stored blocks | create one from a selection with the block action "Save as template button" or `saveAsTemplate(ids)`; stored blocks are validated every time they are inserted |
| **Toggle heading** | a collapsible section whose summary is styled as heading 1–3 | `setToggleLevel(level)`; needs the `layout` feature |

Commands: `insertToc`, `insertBookmark(url)`, `insertDate(iso?)`, `insertPageLink(pageId)`,
`saveAsTemplate(ids?, label?)`, `useTemplate(buttonId)`, `setToggleLevel(level, id?)`.

Not implemented: synced blocks, breadcrumbs, reminders on dates, sub-pages nested inside pages
(pages are a flat list), and a template gallery.
