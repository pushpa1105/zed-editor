# Architecture

One engine, two interfaces. The engine is a headless TypeScript core with no DOM dependency;
a view renders it into a `contenteditable`; the default UI, the React/Vue adapters and the
collaboration module are layers on top that only use public APIs.

```
            ┌──────────────── hosts: plain HTML · React · Vue ────────────────┐
            │  default UI (toolbar, slash menu, handles, table tools, tabs)   │  optional
            ├─────────────────────────────────────────────────────────────────┤
            │  EditorView: incremental DOM rendering, selection, native input │  browser
            ├─────────────────────────────────────────────────────────────────┤
  headless  │  Editor: document · selection · transactions · history ·       │  Node / SSR /
  core      │  commands · extensions · schema · HTML / Markdown / JSON        │  workers
            └─────────────────────────────────────────────────────────────────┘
                     collab (Yjs)  ·  review  ·  autosave  ·  uploads      optional modules
```

## Document model (`src/core/model.ts`, `schema.ts`)

A document is a tree of **blocks**. Every block has a stable `id`, a `type`, `attrs`, and
depending on its kind:

| kind | holds | examples |
| --- | --- | --- |
| `text` | inline `content`, optionally nested `children` | paragraph, heading, list item, toggle, code |
| `container` | `children` only | callout, table / row / cell, columns, page, custom blocks with editable children |
| `atom` | nothing | image, divider, embed, equation, page break |
| `inline` | (lives inside `content`) | mention, inline math, custom inline nodes |

Inline content is a flat array of **spans** `{ text, marks? }` and **inline atoms**
`{ atom, attrs, marks? }`. An atom counts as one offset unit, text as one unit per UTF-16
code unit, so a position is simply `{ id, offset }`. Marks are a record
(`{ bold: true, link: { href } }`); adjacent spans with equal marks are always merged.

There is exactly one document model. Classic and block mode are two user interfaces over it:
a list item is a `list` block in both, a table is the same nodes in both, and nesting is
`children` in both. Switching mode is not a transaction — it changes which controls are shown.

**Selections**: `text` (anchor/focus points; backward and cross-block), `block` (one or more
whole blocks), `cell` (a rectangle of table cells).

**Schema**: node and mark specs registered by extensions. Loading untrusted JSON goes through
`Schema.parse`, which never throws: it repairs or drops invalid parts, validates every
attribute through its spec (URLs, colours, enums, ranges), regenerates duplicate ids, guards
against prototype pollution, and reports `issues`. Blocks of unknown type become inert
`unknown` blocks that render as a placeholder and serialize back to their original JSON
byte-for-byte; unknown inline atoms and marks pass through untouched.

## Transactions (`steps.ts`, `editor.ts`)

All changes are made of four invertible **steps**:

| step | effect |
| --- | --- |
| `text` | replace inline content `[from, to)` of one block |
| `attrs` | replace a block's type and/or attrs |
| `insert` | insert blocks under a parent at an index |
| `remove` | remove a run of blocks from a parent |

`editor.update(tr => …)` applies steps immediately (so later logic sees the current state),
then normalizes (non-empty root and containers, extension normalizers), runs appenders
(auto-links, hashtags) and filters (character limit), maps or sets the selection, records
history and emits events. If anything throws or a filter rejects, the inverse steps are applied
in reverse and the document is exactly as before.

A move is `remove` + `insert` of the same JSON, so ids are preserved; the view recognizes the
ids and re-attaches the existing DOM (an image keeps its `<img>` element).

**History** stores inverse steps plus the selection before and after. Consecutive
transactions with the same `group` merge until a pause (600 ms by default), a different kind of
edit, a mode switch, or `editor.cutHistory()`. Input rules (Markdown shortcuts) are separate
entries, so one undo reverts the conversion and a second the typed text. Changes that are not
user edits — remote changes, comment anchoring, upload results — pass `history: false`.

**Ownership of state**: the editor owns document, selection and history. Hosts own
configuration and chrome. Adapters create the editor once per mount and never feed the document
back in as a controlled prop, so a re-render cannot reset the document or the caret.
`getEditorState()` returns an immutable snapshot that stays referentially equal until something
observable changes — it backs `useSyncExternalStore` and Vue refs directly.

## View (`src/view/view.ts`, `render.ts`)

- **Incremental rendering.** Each block has a view keyed by id. A transaction lists the ids it
  touched; only those views are synced: attributes through the renderer's `update`, inline
  content through `patchInline`, children through a keyed reconcile. Typing in a 20,000-block
  document costs ~0.6 ms of editor work (see [benchmarks](./benchmarks.md)).
- **Text nodes are never replaced when they already hold the right text.** `patchInline`
  compares a per-span signature; if only text changed it writes `textNode.data`, and only when
  it differs from the model. This is what keeps native typing, spellcheck and IME intact.
- **Input.** `beforeinput` is the source of truth. Cancelable input types are prevented and
  executed as commands. Input that cannot be cancelled — IME composition, some mobile
  keyboards — is allowed to mutate the DOM and then *reconciled*: the block's DOM text is
  diffed against the model and applied as one text step. During a composition the composing
  block's DOM is left exactly as the browser made it and normalized on `compositionend`.
- **Selection.** `selectionchange` maps the DOM selection to model points by walking the
  content element (robust to whatever nodes an IME inserted); model selections are written back
  with `setBaseAndExtent`, which preserves direction. Block and cell selections keep a hidden
  collapsed caret so keyboard events still arrive.
- **Decorations** (find matches, syntax highlighting, remote selections) use the CSS Custom
  Highlight API, so they never touch the editable DOM. Where it is unavailable, find and
  presence fall back to overlay rectangles and code is shown without colours.
- **Large documents**: above 400 blocks top-level blocks get `content-visibility: auto`, and
  caret measurements are batched to one per frame.

## Extensions (`extension.ts`, `builtin.ts`)

Every built-in feature is an extension. `resolveExtensions` orders them by `requires`
(dependencies first), then priority; detects conflicts (two extensions defining the same node,
mark or command throw unless the later one sets `override: true`); merges contributions; and
checks `apiVersion`. `setup(editor)` may return a cleanup function, called on destroy.
See [extensions.md](./extensions.md).

## Multi-page documents

A `page` is a container block allowed only at the top level. A paged document's root holds only
pages; a normalizer wraps stray blocks. Because pages are ordinary blocks, history,
serialization, clipboard, comments and collaboration work unchanged. The active page is view
state (`editor.storage.pages.active`); the view shows one page (`tabs`, like sheets or notebook
pages) or all of them as sheets (`paged`). "Page break" splits the current page at the caret,
or inserts a `page_break` block in an unpaged document. Hidden pages are `display: none`, so a
long document split into pages only pays layout for the visible one.

## Databases

A database is a container block whose children are `db_row` blocks; a row carries its cell
values in `attrs.cells` and its page content as child blocks. Properties and saved views live
in the database block's attrs. `queryDatabase` evaluates a view (filter, sort, group,
calculate) as a pure function. The renderer keeps row elements in document order — as the
reconciler requires — and expresses view order, filtering and board columns with CSS (`order`,
`hidden`, `grid-column`), so switching views or sorting never moves DOM nodes or steals focus
from a cell being edited. Details: [databases.md](./databases.md).

## Modules

| path | role |
| --- | --- |
| `src/core/*` | model, schema, steps, selection, editor, commands, tables, HTML, Markdown, clipboard, built-in extensions, databases (`database.ts`), workspace blocks (`notion.ts`) |
| `src/features/*` | counts, find/replace, comments, suggestions, versions, autosave, uploads |
| `src/view/*` | EditorView, renderers (`render.ts`, `notion-render.ts` for databases and workspace blocks), DOM helpers |
| `src/ui/*` | toolbar, floating toolbar, menus, block handles, panels, icons |
| `src/react.tsx`, `src/vue.ts` | adapters |
| `src/collab.ts` | Yjs binding, presence, sync protocol, transports |
| `src/code-highlight.ts` | optional syntax highlighting |
