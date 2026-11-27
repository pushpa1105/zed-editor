# Block IDs, events and syncing with a backend

This page is for developers who store zeditor documents in their own backend, block by block,
or who need to react when blocks change.

- [Block IDs](#block-ids): use your backend's IDs, generate IDs your way, rename blocks after
  the server assigns IDs.
- [Events](#events): every event the editor fires, including per-block events.
- [Syncing with a backend](#syncing-with-a-backend): `createBlockSync` sends batched changes,
  and `applyBlockChanges` applies changes that come from the server.
- [Recipes](#recipes)

Everything here is in `@buffmomo/zeditor/core` (headless, also works in Node.js) and is
re-exported from `@buffmomo/zeditor`.

## Block IDs

Every block has an `id` that is unique in its document and stable across edits. Typing, changing
attributes, changing the type ("turn into"), indenting and moving keep a block's ID. Splitting a
block (Enter) creates a new block for the second half. Merging two blocks (Backspace at the start)
keeps the first one and deletes the second.

**Valid IDs** are 1–64 characters of letters, digits, `_`, `:`, `.` and `-`
(`BLOCK_ID` is `/^[\w:.-]{1,64}$/`). UUIDs, numeric IDs (`"42"`) and prefixed IDs
(`"blk_8f3a"`) all fit.

### Loading documents with your IDs

The IDs in the JSON you load are kept as they are:

```js
const editor = createEditor(host, {
  content: { format: 'zeditor', version: 1, blocks: rowsFromDb.map(toBlockJSON) },
});
```

An ID is replaced only if it is missing, invalid, or duplicated in the document. When that
happens, an `issues` event lists the regenerated IDs.

### Generating IDs for new blocks

Pass `idGenerator` to choose how new blocks are named:

```js
createEditor(host, { idGenerator: () => crypto.randomUUID() });
// or IDs reserved in advance by your server
const pool = await api.reserveIds(200);
createEditor(host, { idGenerator: () => pool.pop() ?? crypto.randomUUID() });
```

The generator is used for every block the editor creates: Enter, paste, slash-menu inserts,
duplicated blocks, database rows, and so on. If it returns an invalid ID or one already in the
document, the editor tries again (up to 5 times), then falls back to its built-in generator and
logs one console warning. The option applies to that editor only. `setIdGenerator(fn)` still
replaces the process-wide default, which is meant for deterministic tests.

> Database property, option and view IDs (inside a database block's attributes) are not
> block IDs; they keep their own short generated IDs.

### Renaming blocks to server-assigned IDs

If your server assigns IDs only when it saves a block, create blocks with temporary IDs and
rename them when the server answers:

```js
editor.remapIds({ 'b1x9k2': 'srv_1001', 'b7p0qa': 'srv_1002' }); // → true / false
```

- Renames the blocks themselves (and keeps their children, content and position).
- Rewrites references to the old IDs in other blocks: synced copies, sub-page parents, database
  relations, page links. Any attribute value equal to an old ID is replaced; text is left alone.
- Rewrites the undo/redo history and the selection, so undo keeps working.
- It is not an undo step. Its origin is `'remap'`, and it fires `ids:remapped` with the map.
- Changes nothing and returns `false` when an old ID does not exist, a new ID is invalid, or a
  new ID is already used by another block.
- In collaborative sessions the rename reaches other clients as a remove + insert of the renamed
  blocks. Prefer `idGenerator` (client-side IDs) when collaborating.

## Events

Subscribe with `editor.on(name, fn)`. It returns a function that unsubscribes.

```js
const off = editor.on('block:updated', (e) => console.log(e.id, e.changes));
off();
```

### Document and editor events

| Event | Payload | Fires when |
| --- | --- | --- |
| `transaction` | `{ tr, docChanged, selectionChanged, origin }` | after every committed transaction (first) |
| `change` | same | the document changed |
| `selection` | `{ selection }` | the selection changed |
| `update` | — | anything a UI may render from changed (doc, selection, mode, read-only, stored marks) |
| `mode` | `{ mode }` | `'classic'` ⇄ `'block'` |
| `readonly` | `{ readOnly }` | read-only toggled |
| `focus` / `blur` | — | the editing area gained / lost focus (needs a view) |
| `issues` | `{ issues: string[] }` | loaded content had problems that were repaired (e.g. duplicate IDs) |
| `rejected` | `{ tr }` | a transaction was rejected (e.g. character limit) and rolled back |
| `page` | `{ id }` | the active page changed (multi-page documents) |
| `ui:error` / `ui:notice` | `{ message }` | something the user should be told (failed upload, invalid link…). The default UI shows it as a small message; emit it yourself to use the same display. Turn the display off with `ui: { notices: false }` |
| `upload` | `{ id, state, progress?, error?, reason?, file? }` | upload progress: `uploading`, `done`, `error`, `cancelled`, `rejected` (`reason: 'size' \| 'type'`) |
| `destroy` | — | the editor is being destroyed |

### Block events

These events describe a transaction in terms of blocks. They are computed only when at least one
of them has a listener, so they cost nothing otherwise.

| Event | Payload (all also carry `origin`) | Meaning |
| --- | --- | --- |
| `blocks` | `BlockChanges` (below) | all block changes of one transaction, in one object |
| `block:created` | `{ id, type, parentId, index, afterId, json, ids }` | a block was added. `json` includes its children; descendants are not reported separately, but `ids` lists them all |
| `block:updated` | `{ id, type, changes, attrsBefore?, attrsAfter?, typeBefore?, cells?, block }` | the block's own text (`'content'`), attributes (`'attrs'`) or type (`'type'`) changed |
| `block:deleted` | `{ id, type, parentId, index, json, ids }` | a block was removed. `json` is what it was; `ids` includes its descendants |
| `block:moved` | `{ id, type, from: { parentId, index }, to: { parentId, index, afterId } }` | a block moved to another parent or position (dragging, Alt+↑/↓, indenting that nests it under another block; indenting that only shifts it is an `attrs` update) |
| `block:completed` | `{ id, type, block }` | a block's `checked` attribute became true (to-do items) |
| `block:uncompleted` | `{ id, type, block }` | `checked` became false |
| `block:focus` | `{ id, previous }` | the caret (or block selection) moved into another block; `id: null` when nothing is selected. `editor.activeBlockId` holds the current one |
| `ids:remapped` | `{ map }` | `remapIds` renamed blocks |
| `sync:status` | `{ status, error? }` | fired by `createBlockSync` (below) |

`parentId` is `null` for top-level blocks. `afterId` is the previous sibling's ID, or `null` when
the block is first. Most block stores need one of `index` / `afterId` to keep order.

`BlockChanges`:

```ts
interface BlockChanges {
  origin: string; // 'local' | 'remote' | 'history' (undo/redo) | 'paste' | 'load' | 'remap' | custom
  created: BlockCreated[];
  updated: BlockUpdated[];
  deleted: BlockDeleted[];
  moved: BlockMoved[];
  completed: BlockCompleted[];
  uncompleted: BlockCompleted[];
}
```

The changes are the **net result of the transaction**:

- A block created and deleted in the same transaction is not reported.
- A block deleted and re-inserted somewhere else is reported as `moved`.
- A block put back in the same place with different data is reported as `updated`.
- Typing one character is one `block:updated` with `changes: ['content']`. Pressing Enter in the
  middle of a paragraph updates the first half and creates the second.
- Undo and redo fire the same events with `origin: 'history'`.

**Database rows** are blocks of type `db_row` inside a `database` block. Editing a cell is a
`block:updated` with `changes: ['attrs']`. `cells` lists the IDs of the properties whose values
changed. The values are in `attrsBefore.cells` / `attrsAfter.cells`. Find a property's ID by name
with `dbProperties(dbBlock)` (see [databases.md](databases.md)).

> "Completed" uses the `checked` attribute, which check-list items have. For other notions of
> "done", e.g. a database row whose Status becomes *Done*, compare `attrsBefore.cells[statusId]`
> and `attrsAfter.cells[statusId]` in `block:updated` ([recipe](#a-task-moved-to-done)).

`summarizeTransaction(tr.steps, tr.inverse, editor.doc, origin)` computes `BlockChanges`
yourself, for example inside a `transaction` listener.

## Syncing with a backend

### Pushing local changes: `createBlockSync`

```js
import { createBlockSync } from '@buffmomo/zeditor';

const sync = createBlockSync(editor, {
  delay: 800,        // push after 800 ms without edits…
  maxDelay: 5000,    // …or at the latest 5 s after the first unsent edit
  async push(batch) {
    const res = await fetch(`/api/docs/${docId}/blocks`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error('save failed ' + res.status); // retried with back-off
    return res.json(); // optional: { ids: { tempId: serverId } }
  },
  onStatus(status, error) {
    saveLabel.textContent = { idle: 'Saved', pending: 'Unsaved changes', saving: 'Saving…', error: 'Offline – retrying' }[status];
  },
});

window.addEventListener('beforeunload', () => void sync.flush());
```

`push` receives a `SyncBatch`:

```ts
interface SyncBatch {
  upserted: SyncBlock[];  // created or changed blocks, parents before children
  deleted: string[];      // IDs of deleted blocks, descendants included
  order: { parentId: string | null; children: string[] }[]; // new child order of each parent whose children changed
}
interface SyncBlock {
  id: string; type: string;
  parentId: string | null; index: number; afterId: string | null;
  attrs?: object;   // the block's attributes (database rows: attrs.cells holds the cell values)
  content?: Inline[]; // text and marks of text blocks
}
```

Blocks are **shallow**: a `SyncBlock` holds only the block's own data, with no children. That
matches a table with one row per block (`id`, `doc_id`, `parent_id`, `position`, `type`,
`attrs jsonb`, `content jsonb`). Use `order` to rewrite the `position` of a parent's children in
one go.

Behaviour:

- **Net changes only.** Ten keystrokes in one block send that block once, with its final state.
  A block created and deleted before a push is never sent. Deleting a block that was never
  pushed sends nothing.
- **One request at a time.** Changes made while a push is in flight go into the next batch.
- **Failures lose nothing.** If `push` throws or rejects, its changes are merged back, the
  status becomes `'error'`, and the push is retried after 1 s, 2 s, 4 s … up to 30 s.
- **Server IDs.** If `push` resolves to `{ ids: { tempId: serverId } }`, the editor calls
  `remapIds` and later batches use the new IDs.
- **No echo.** Changes with origin `'remote'`, `'load'` or `'remap'` are not pushed. Change this
  with `shouldPush(origin)`.
- `sync.flush()` pushes immediately and returns a promise. `sync.pending` is the number of
  blocks waiting, `sync.status` is the current status, and `sync.destroy()` stops syncing (it
  also stops when the editor is destroyed).

Saving the whole document instead? Use `createAutosave` (see the README). Both can run together:
for example, block sync to the server and autosave to `localStorage` for crash recovery.

### Applying server changes: `applyBlockChanges`

When another user or tab changed the document, apply the server's batch:

```js
import { applyBlockChanges } from '@buffmomo/zeditor';

socket.on('blocks', (batch) => applyBlockChanges(editor, batch)); // origin 'remote', not undoable
```

It accepts the same `SyncBatch` shape (all fields optional):

- Deletes the listed IDs.
- Creates unknown blocks under their parent (top level if the parent is missing), at `afterId`
  or `index`. New blocks are validated like loaded content.
- Updates the type, attributes and text of existing blocks, and moves them if their parent
  changed. Only the part of a block's text that differs is replaced, so the user's caret keeps
  its place in a block someone else edited.
- Reorders children to match `order`.

For real-time co-editing of the *same* block by several people, use the CRDT-based
collaboration module instead ([collaboration.md](collaboration.md)). Block sync is
last-writer-wins per block.

## Recipes

### Log every change of a document

```js
editor.on('blocks', ({ origin, created, updated, deleted, moved }) => {
  console.table([
    ...created.map((b) => ({ op: 'create', id: b.id, type: b.type, origin })),
    ...updated.map((b) => ({ op: 'update', id: b.id, what: b.changes.join(','), origin })),
    ...moved.map((b) => ({ op: 'move', id: b.id, origin })),
    ...deleted.map((b) => ({ op: 'delete', id: b.id, origin })),
  ]);
});
```

### Notify when a to-do is checked

```js
editor.on('block:completed', ({ id, block, origin }) => {
  if (origin === 'local') toast(`Done: ${block.text}`);
});
```

### A task moved to "Done"

```js
import { dbProperties } from '@buffmomo/zeditor';

editor.on('block:updated', (e) => {
  if (e.type !== 'db_row' || !e.cells) return;
  const status = dbProperties(e.block.parent).find((p) => p.name === 'Status');
  if (!status || !e.cells.includes(status.id)) return;
  const done = status.options.find((o) => o.name === 'Done')?.id;
  if (e.attrsAfter.cells[status.id] === done && e.attrsBefore.cells?.[status.id] !== done) {
    api.taskCompleted(e.id);
  }
});
```

### Highlight the block being edited elsewhere in your app

```js
editor.on('block:focus', ({ id }) => outline.setActive(id));
```

### Server reserves IDs

```js
const ids = await api.reserveIds(500);
createEditor(host, { idGenerator: () => ids.pop() ?? crypto.randomUUID() });
```
