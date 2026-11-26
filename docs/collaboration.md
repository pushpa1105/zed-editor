# Collaboration and review

Collaboration is an optional module: `@buffmomo/zeditor/collab` (peer dependencies `yjs` and
`y-protocols`). Nothing in the base bundle references it.

```js
import * as Y from 'yjs';
import { createEditor } from '@buffmomo/zeditor';
import { createCollab, connectSync, webSocketTransport, yCommentStore } from '@buffmomo/zeditor/collab';

const z = createEditor({ element: '#editor' });
const doc = new Y.Doc();
const collab = createCollab(z.editor, { doc, user: { id: me.id, name: me.name, color: '#2563eb' } });

// A) any existing Yjs provider (y-websocket, Hocuspocus, y-webrtc…): give it `doc` and `collab.awareness`
// B) the built-in minimal sync protocol over a transport you control:
const sync = connectSync(doc, collab.awareness, webSocketTransport('wss://example.com/rooms/42'));
sync.connect();
if (!(await sync.whenSynced()) && collab.isEmpty()) collab.seed(); // first client provides the content
```

`createCollab` binds the editor to the shared document, installs per-user undo, publishes the
local selection and renders remote carets, names and selections. `examples/collab` is a working
two-client page (in-memory hub, or `?room=x` across tabs with BroadcastChannel).

## Host adapters

| Concern | Adapter | Provided implementations |
| --- | --- | --- |
| **Identity** | `user: { id, name, color }` | — (comes from your auth) |
| **Transport** | `Transport` (`send`, `onMessage`, `onOpen`, `onClose`, `connect`, `disconnect`) or any Yjs provider | `memoryHub`, `broadcastChannelTransport`, `webSocketTransport` (auto-reconnect) |
| **Storage** | `DocPersistence` (`load`, `save`) via `persistDoc`; `CommentStore`; `VersionStore` | `localStoragePersistence` (reference only), `yCommentStore` (threads in the shared doc), in-memory stores |
| **Permissions** | `permissions.canEdit(user)` → read-only editor; `canComment`, `canModerate`, `canReview` for review features | — |

## What a production backend must enforce

The client-side adapters are **conveniences, not security**. Everything a browser sends can be
forged. A backend must:

1. **Authenticate** every connection (the `user` object the client publishes is display data).
2. **Authorize per document and per action**: reject updates from read-only users
   *server-side* — `canEdit: false` only disables the local editor. If you need
   comment-only or suggest-only roles, validate on the server that an update touches nothing
   else, or keep comment threads in a separate, separately-authorized store.
3. **Validate what it persists**: apply updates to a server-side `Y.Doc`, and when
   materializing JSON (`sharedBlocks(doc, editor)` with a headless editor) run it through
   `editor.validate` / `setJSON`. Treat the stored document as untrusted on every load anyway.
4. **Own the room's state**: keep the Y.Doc on the server so late joiners sync from it rather
   than from whichever peers happen to be online, and seed new rooms on the server. (With the
   bare relay below, two clients opening an empty room at the same moment can both seed it.)
5. **Limit** update size and rate; cap document size.
6. **Sanitize uploads** (type, size, content), serve them from a separate origin, and never
   trust client-supplied URLs for embeds — the editor only renders iframes for URLs produced by
   configured providers and sandboxes them, but your CSP should allow-list those origins too.
7. **Do not trust awareness** (names, colours, selections) for anything but display.

A relay that is enough for demos (no auth, no persistence — *not* production):

```js
import { WebSocketServer } from 'ws';
const rooms = new Map();
new WebSocketServer({ port: 1234 }).on('connection', (ws, req) => {
  const room = rooms.get(req.url) ?? rooms.set(req.url, new Set()).get(req.url);
  room.add(ws);
  ws.on('message', (data) => { for (const peer of room) if (peer !== ws && peer.readyState === 1) peer.send(data); });
  ws.on('close', () => room.delete(ws));
});
```

(This relay is documented but not exercised by the automated tests; the protocol itself is
tested through the in-memory hub.)

## Concurrency semantics

| Situation | Result |
| --- | --- |
| Concurrent typing in the same paragraph | merged character-wise (Yjs text CRDT) |
| Concurrent formatting | per-mark last-writer-wins on overlapping ranges |
| Block attributes / type (heading level, checked, alignment…) | last-writer-wins **per block** (the whole attrs object) |
| Insert / delete blocks | merged; order is the Yjs array order |
| **Move** a block | a move is delete + insert. Edits made concurrently *inside* a block that another user moves are lost; two users moving the **same** block concurrently produce **two copies**. One copy keeps the id, the other is deterministically renamed on every client (`id-<client>-<clock>`). |
| Offline edits | kept in the local Y.Doc and merged on reconnect; persist them with `persistDoc` to survive reloads |
| **Table shape** (concurrent row + column insertion, deletes) | cell lists merge independently, so rows can end up with different lengths. Rendering tolerates ragged rows; the table is padded back to a rectangle before the next local structural edit to it (`repairTable`). A row span that no longer fits is clamped when the grid is laid out. |
| Nesting a block under one whose type another user changes | the children are kept even if the new type would not normally nest |
| Interleaved undo by two users of the same attribute | Yjs can leave the value unset; the binding keeps the last known value and writes it back so all clients converge |

**Undo** is per user (`Y.UndoManager` tracking only local origins): undoing reverts your own
edits and leaves other authors' independent edits in place. The selection is restored with each
undo step. Remote changes never enter your undo stack.

**Presence**: each client publishes `{ user, selection }`. Remote carets and names are drawn in
an overlay; remote selections use CSS highlights. A client that disconnects cleanly removes its
presence immediately; a crashed client times out via the awareness protocol (30 s).

## Comments

```js
import { createComments, createReviewPanel } from '@buffmomo/zeditor';
const comments = createComments(editor, { user, store: yCommentStore(doc), permissions });
comments.addThread('Is this right?');   // anchors to the current selection
```

Threads live in a `CommentStore`; **anchors are marks on the text**, so they follow it:

| What happens to the anchored text | What happens to the anchor |
| --- | --- |
| text is typed *inside* it | the anchor grows to include it |
| text is typed at its start or end edge | the anchor does not extend |
| part of it is deleted | the anchor shrinks |
| it is moved (drag, cut + paste in the same editor, block reorder) | the anchor moves with it |
| it is copied and pasted in the same editor | both copies are anchored (a thread can have several ranges) |
| it is pasted into another editor | the mark is stripped |
| **all** of it is deleted | the thread is *orphaned*: it stays in the store with its original quote and `anchored: false`; undoing the deletion re-anchors it |

Anchoring is not an undo step. Resolving, replying and deleting are store operations guarded
by `canComment` / `canModerate` (authors can always manage their own).

## Suggestions (track changes)

`createSuggestions(editor, { user })`, then `setSuggesting(true)`. Typed text is inserted with
an *insert* suggestion mark; deleted text stays and gets a *delete* mark. `accept(id)` /
`reject(id)` / `acceptAll()` / `rejectAll()` resolve them as ordinary undoable edits.

Scope: **inline text insertions and deletions**. Structural edits made while suggesting
(splitting, joining, moving or converting blocks, table operations, formatting) are applied
directly and are not tracked.

## Versions

`createVersions(editor, { store, user })`: `save(label)` snapshots the document JSON,
`restore(id)` replaces the document as **one undoable edit** (in a collaborative session it
propagates like any other edit). The store is yours — a database table works.

## Autosave and drafts

```js
createEditor({ …, autosave: { save: (doc, { revision, signal }) => api.save(doc, { signal }), draftKey: 'doc-42' }, ui: { statusBar: true } });
```

- Status is `saved | dirty | saving | error | offline`, shown in the status bar and emitted as
  the `save` event.
- **A late response cannot hide newer edits**: every save is tagged with the revision it
  captured; the document is only "saved" when the confirmed revision equals the current one,
  otherwise it stays dirty and saves again.
- With `draftKey`, every change is written to local storage and cleared only after the save of
  that revision succeeds. After a crash, `autosave.getDraft()` / `recoverDraft()` restore it
  (as an undoable edit).
- Failures retry with backoff and when the browser comes back online.
