# Databases and workspace blocks

Notion-style structured content, built from the same blocks, steps and extension API as
everything else. Two features, both on by default:

| Feature flag | Adds |
| --- | --- |
| `database` | databases with typed properties (including formulas, relations and rollups) and table / board / list / gallery / calendar / timeline views |
| `notion` | table of contents, bookmarks, links to pages (`[[`), date chips, template buttons, toggle headings, synced copies |

```js
createEditor({ element: '#editor', features: { database: true, notion: true }, linkPreview: async (url, { signal }) => fetchMeta(url, signal) });
```

Both features are part of the base bundle (together about 25 kB gzipped of script and 4 kB of CSS, see
[benchmarks](./benchmarks.md)); switching a flag off removes the feature from the editor but not
from the bundle.

In block mode type `/database`, `/board`, `/calendar`, `/timeline`, `/toc`, `/bookmark`, `/date`,
`/template`, `/toggle heading`; type `[[` to link to a page. In classic mode the same items are in
the toolbar's searchable **Insert** menu (`createToolbar(editor, { insert: false })` hides it).

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
  `multi_select`, `checkbox`, `date`, `url`, `email`, `person` (free text), the computed types
  `formula`, `relation` and `rollup` (below), and any type you register yourself.
- **Views** are saved per database and independent: each has its own filters, sorts, grouping,
  hidden properties and column calculations. Sorting and filtering never change the document
  order of the rows; they only change what a view shows.

### Views

| View | Shows | Notes |
| --- | --- | --- |
| `table` | one row per record, one column per visible property | header menu per property; calculation footer; Enter moves down a column |
| `board` | cards in columns, one per option of a `select` property | drag a card to another column to change the value; uses `groupBy` or the first select property |
| `list` | compact rows: title plus filled properties | |
| `gallery` | cards in a responsive grid | the cover is the first image of the row's page, or the start of its text; cards hide empty properties until opened |
| `calendar` | a month grid; rows sit on the day of a `date` property | previous / today / next; "+" on a day adds a row dated that day; `dateProp` picks the property (one is created with the view if the database has none) |
| `timeline` | a 28-day window; rows are bars from `dateProp` to the optional `endProp` | rows without a date or outside the window are counted below the view, not shown |

In the table view, click a column header for its settings, drag it sideways to reorder, and drag
its right edge to resize. On a board, dragging a card onto another card also reorders it (when
the view is not sorted); a card does not repeat the value its column stands for.

Filters: `contains`, `not_contains`, `is`, `is_not`, `empty`, `not_empty`, `gt`, `lt`,
`checked`, `unchecked`. A view matches **all** of its filters by default or **any** of them
(`filterMode: 'or'`, "Match" in the filter popup); nested groups are not supported. Sorts: by any property; selects sort by option
order, text naturally (`item 2` before `item 10`), empty values last in both directions.
Calculations: `count`, `filled`, `empty`, `unique`, `sum`, `avg`, `min`, `max`, `checked`,
`percent_checked`.

### API

Everything the UI does is a command, so a custom interface (or a script in Node) can do the same:

```js
import { createHeadlessEditor, createDatabase, queryDatabase } from '@buffmomo/zeditor/core';

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

Also: `dbSetTitle`, `dbDeleteRow`, `dbDuplicateRow`, `dbMoveRow(rowId, targetRowId, 'before' | 'after')`,
`dbDeleteProperty`, `dbMoveProperty(dbId, propId, toIndex)`, `dbFilterMode(dbId, 'and' | 'or')`,
`dbUpdateView`, `dbDeleteView`, `dbSetView`. `createDatabase(editor, …)` builds the block JSON
without inserting it.

### Formulas

A `formula` property is computed for every row from an expression. The language is small and
parsed by hand — nothing is ever passed to `eval` or `Function`:

```
prop("Points") * 2
if(prop("Shipped"), "done", concat(prop("Points"), " pts left"))
dateDiff(prop("Due"), today())            // whole days until due
```

- Values: numbers, `"strings"`, `true` / `false`, `prop("Property name")`.
- Operators: `+ - * / %`, `== != < > <= >=`, `and or not` (also `&& || !`), parentheses.
  `+` joins when either side is a string. Division by zero gives an empty cell.
- Functions: `if`, `concat`, `length`, `lower`, `upper`, `contains`, `replace`, `empty`,
  `toNumber`, `round(x, digits)`, `floor`, `ceil`, `abs`, `min`, `max`, `today`, `now`,
  `dateDiff(a, b)`, `dateAdd(date, days)`. Unknown functions are rejected when the formula is parsed.
- Errors never throw: the cell shows `#ERR: …` and the property settings show the message while
  you type. A formula that refers to itself (directly or through others) evaluates to an error.
- Limits: 500 tokens, 60 levels of nesting. `today()` is evaluated when the view renders.

```js
import { runFormula, checkFormula } from '@buffmomo/zeditor/core';
editor.commands.dbAddProperty(db.id, { name: 'Effort', type: 'formula', formula: 'prop("Points") * 2' });
checkFormula('prop("Points") *');          // → error message, or null when it parses
runFormula('1 + 2', () => null);           // → 3
```

### Relations and rollups

- A `relation` property links rows to rows of a database in the same document (possibly itself):
  `{ type: 'relation', relation: { database: otherDbId } }`. Its cells hold row ids; ids of rows
  that no longer exist are ignored when read. Relations are one-directional: there is no automatic
  back-link property.
- A `rollup` property summarizes one property of the related rows:
  `{ type: 'rollup', rollup: { relation: relationPropId, target: propIdInTheOtherDatabase, calc: 'sum' } }`.
  `calc` is any column calculation, or `'show'` to list the values.
- Formula and rollup cells are read-only (`dbSetCell` returns `false`); they can be sorted,
  filtered and used in column calculations like stored values.

### Custom property types

```js
import { registerDbPropertyType } from '@buffmomo/zeditor/core';

registerDbPropertyType({
  type: 'rating',                                   // lower-case identifier
  label: 'Rating',
  coerce: (v) => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : undefined; },
  text: (v) => '★'.repeat(v ?? 0),                  // used by search, export, cards
  compare: (a, b) => (a ?? 0) - (b ?? 0),           // optional: sorting
  render: ({ value, set, readOnly, label }) => {    // optional: the cell's DOM
    const el = document.createElement('button');
    el.type = 'button';
    el.setAttribute('aria-label', label);
    el.textContent = '★'.repeat(value ?? 0) || '☆';
    el.disabled = readOnly;
    el.onclick = () => set(((value ?? 0) % 5) + 1);
    return el;
  },
});
```

The registry is global (every editor on the page sees the type) and the type then appears in the
"Add property" menu. Values are always passed through `coerce`, both from the UI and when a
stored document is loaded. A document that uses a type that is not registered treats it as text.

### Styling

The database UI is plain CSS on stable class names (`src/database.css`, part of `style.css`):
option colours come from one `--chip` variable per `data-color`, scrollbars from
`--z-scroll-thumb` / `--z-scroll-thumb-hover`, everything else from the theme variables
(`--z-accent`, `--z-border`, `--z-surface`…). Labels go through the editor's `labels` option
(`db.*` keys).

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

### Working with rows

- **Quick search** (magnifier in the database toolbar): every word must appear in some property
  of a row, option names included. It is view state, not saved in the document, and is also
  available read-only. Escape clears it; Enter jumps to the first match. API:
  `queryDatabase(db, viewId, { search })`.
- **Row menu**: the "⋯" button on a table row, list row or card, or a right click anywhere on a
  row (a field with selected text keeps the browser menu): Open, Insert above, Insert below,
  Duplicate, Delete.
- **Keyboard**: Enter, ArrowDown and ArrowUp move between rows of a column in the order the view
  shows them (sorted views included).
- **Calendar / timeline dragging**: drag an entry to another day to change its date; drag a
  timeline bar to shift its start (and end) date, or its right end to change the end date (needs
  an end date property). A click without movement still edits the title.
- **Table**: the title column stays in place while the table scrolls sideways.
- **Board**: "Hide empty groups" in the Group menu (`view.hideEmptyGroups`).

### Not implemented

Nested filter groups (a view is either "all" or "any"), two-way relations, relations across
documents, row templates, linked databases (one database shown in several places), week / year calendar scales, and
virtualized rows — every row is in the DOM (closed rows are skipped by the browser's layout
through `content-visibility`). Collaboration granularity is unchanged: see above.

## Workspace blocks

| Block | What it does | Notes |
| --- | --- | --- |
| **Table of contents** (`toc`) | live outline of the headings on its page; click to jump | exported as an empty `<nav data-toc>` / `<!-- toc -->` marker — the static HTML does not contain the links |
| **Bookmark** (`bookmark`) | link card with title, description, image | metadata comes from your `linkPreview(url, { signal })` adapter; the editor never fetches URLs itself. Results are validated, ignored if the bookmark was removed meanwhile, and are not undo steps |
| **Page link** (`page_link`, inline) | link to a page of the same multi-page document; type `[[` | renaming the page updates its links; a link to a deleted page is shown struck through |
| **Date** (`date`, inline) | `@Today`-style chip; click to change | stored as `YYYY-MM-DD`; exported as `<time datetime>` |
| **Template button** (`template_button`) | inserts fresh copies of stored blocks | create one from a selection with the block action "Save as template button" or `saveAsTemplate(ids)`; stored blocks are validated every time they are inserted |
| **Toggle heading** | a collapsible section whose summary is styled as heading 1–3 | `setToggleLevel(level)`; needs the `layout` feature |
| **Synced copy** (`synced`) | a read-only mirror of another block of the same document that follows every change to it | block action "Create synced copy" or `insertSyncedCopy(sourceId?, { after })`. Edit the original ("Go to original"); the copy itself is not editable — this is one-way, unlike Notion's synced blocks. If the original is deleted the copy says so. Exported as an empty `<div data-synced>` marker: static HTML does not contain the mirrored content |

Commands: `insertToc`, `insertBookmark(url)`, `insertDate(iso?)`, `insertPageLink(pageId)`,
`saveAsTemplate(ids?, label?)`, `useTemplate(buttonId)`, `setToggleLevel(level, id?)`,
`insertSyncedCopy(sourceId?, at?)`.

### Sub-pages and breadcrumbs

Pages of a multi-page document can be nested: a page stores its parent in `attrs.parent`.
`addSubPage(parentId?, title?)` adds a page under the given (or active) page,
`setPageParent(id, parentId | null)` moves one (it refuses to create a cycle), and removing a
page moves its sub-pages up to its own parent. The page tabs indent sub-pages, their context menu
has "Add sub-page" and "Move to top level", and a breadcrumb trail under the tabs shows the path
of the active page. Helpers: `parentPage`, `pagePath`, `pageTree` from `@buffmomo/zeditor/core`.
Pages remain top-level blocks in document order; nesting is a relationship, not containment, so a
document written with sub-pages opens as a flat list of pages in a client that ignores `parent`.

Not implemented: two-way synced blocks, reminders on dates, page icons and covers, and a template
gallery.
