/**
 * Optional collaboration module (Yjs). Import from `@buffmomo/zeditor/collab`.
 *
 * Shared structure:
 *   ydoc.getArray('blocks') : Y.Array<Y.Map>
 *   block Y.Map = { id, type, attrs (plain JSON, last writer wins per block), text: Y.Text, children: Y.Array<Y.Map> }
 *   Y.Text carries marks as formatting attributes and inline atoms as embeds (length 1),
 *   so model offsets and Y offsets are identical.
 *
 * Works with any Yjs provider (y-websocket, y-webrtc, Hocuspocus, ...): pass its Y.Doc and
 * Awareness to `createCollab`. A minimal sync protocol and three transports (in-memory hub,
 * BroadcastChannel, WebSocket) are included for demos, tests and simple deployments.
 *
 * Concurrency semantics (see docs/collaboration.md):
 *  - text edits merge character-wise; attribute changes are last-writer-wins per block
 *  - moving a block is delete + insert: concurrent edits inside a block that another user
 *    moves at the same time are lost, and two users moving the same block yields two copies
 *  - concurrent table shape edits can leave rows of different lengths; rendering tolerates
 *    that and the table is padded to a rectangle before the next local structural edit
 */
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import type { Editor, HistoryProvider, TransactionEvent } from './core/editor';
import { Block, BlockJSON, Inline, MarkSet, isAtom, newId } from './core/model';
import { Selection, fixSelection } from './core/selection';
import type { Step } from './core/steps';
import type { CommentStore, CommentThread, ReviewUser } from './features/review';

export interface CollabUser extends ReviewUser {
  color?: string;
}
export interface CollabPermissions {
  /** may this user change the document? When false the editor is read-only. */
  canEdit?: (user: CollabUser) => boolean;
}
export interface CollabOptions {
  doc: Y.Doc;
  awareness?: Awareness;
  user: CollabUser;
  /**
   * What to do when the shared document is empty at bind time:
   *  - true: push the editor's current content immediately
   *  - false (default): wait; call `collab.seed()` once the provider reports its first sync
   */
  seed?: boolean;
  permissions?: CollabPermissions;
  /** install collaborative undo (per-user, via Y.UndoManager). Default true. */
  undo?: boolean;
  /** render remote carets and selections. Default true. */
  presence?: boolean;
}
export interface RemoteState {
  clientId: number;
  user: CollabUser;
  selection: Selection | null;
}
export interface Collab {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  /** push the editor's content into an empty shared document. Returns false if it was not empty. */
  seed(): boolean;
  isEmpty(): boolean;
  /** other users currently present */
  remoteStates(): RemoteState[];
  onPresence(fn: (states: RemoteState[]) => void): () => void;
  undoManager: Y.UndoManager | null;
  destroy(): void;
}

const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

/* ------------------------------------------------------------------ JSON <-> Y */

function marksToAttrs(marks: MarkSet | undefined, keys: Iterable<string>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) out[k] = null;
  if (marks) for (const k in marks) out[k] = marks[k];
  return out;
}
function insertInline(ytext: Y.Text, pos: number, content: readonly Inline[], keys: Iterable<string>): void {
  for (const c of content) {
    const attrs = marksToAttrs(c.marks, keys);
    if (isAtom(c)) {
      ytext.insertEmbed(pos, { atom: c.atom, attrs: c.attrs ?? {} }, attrs);
      pos += 1;
    } else {
      ytext.insert(pos, c.text, attrs);
      pos += c.text.length;
    }
  }
}
function markKeys(content: readonly Inline[] | undefined, into = new Set<string>()): Set<string> {
  for (const c of content ?? []) if (c.marks) for (const k in c.marks) into.add(k);
  return into;
}
function toY(j: BlockJSON, register: (id: string, m: Y.Map<any>) => void): Y.Map<any> {
  const m = new Y.Map<any>();
  m.set('id', j.id);
  m.set('type', j.type);
  m.set('attrs', j.attrs ? JSON.parse(JSON.stringify(j.attrs)) : {});
  const text = new Y.Text();
  m.set('text', text);
  if (j.content?.length) insertInline(text, 0, j.content, markKeys(j.content));
  const kids = new Y.Array<Y.Map<any>>();
  m.set('children', kids);
  if (j.children?.length) kids.insert(0, j.children.map((c) => toY(c, register)));
  register(j.id, m);
  return m;
}
function deltaToInline(delta: any[]): Inline[] {
  const out: Inline[] = [];
  for (const op of delta) {
    let marks: MarkSet | undefined;
    if (op.attributes) for (const k in op.attributes) if (op.attributes[k] != null) (marks ??= {})[k] = op.attributes[k];
    if (typeof op.insert === 'string') out.push(marks ? { text: op.insert, marks } : { text: op.insert });
    else if (op.insert && typeof op.insert === 'object' && typeof op.insert.atom === 'string') out.push(marks ? { atom: op.insert.atom, attrs: op.insert.attrs ?? {}, marks } : { atom: op.insert.atom, attrs: op.insert.attrs ?? {} });
  }
  return out;
}
function fromY(m: Y.Map<any>, isText: (type: string) => boolean): BlockJSON {
  const type = String(m.get('type'));
  const j: BlockJSON = { id: String(m.get('id')), type };
  const attrs = m.get('attrs');
  if (attrs && typeof attrs === 'object' && Object.keys(attrs).length) j.attrs = JSON.parse(JSON.stringify(attrs));
  const text = m.get('text') as Y.Text | undefined;
  if (text && (isText(type) || text.length)) j.content = deltaToInline(text.toDelta());
  const kids = m.get('children') as Y.Array<Y.Map<any>> | undefined;
  if (kids && kids.length) j.children = kids.toArray().map((k) => fromY(k, isText));
  return j;
}

/** The shared document as block JSON (useful on a server, or to verify an editor is in sync). */
export function sharedBlocks(doc: Y.Doc, editor: Editor): BlockJSON[] {
  return doc
    .getArray<Y.Map<any>>('blocks')
    .toArray()
    .map((m) => fromY(m, (type) => editor.schema.node(type)?.kind === 'text'));
}

/* ------------------------------------------------------------------ binding */

export function createCollab(editor: Editor, opts: CollabOptions): Collab {
  const ydoc = opts.doc;
  const root = ydoc.getArray<Y.Map<any>>('blocks');
  const awareness = opts.awareness ?? new Awareness(ydoc);
  const user: CollabUser = { ...opts.user, color: opts.user.color ?? COLORS[ydoc.clientID % COLORS.length] };
  /** origin of Y transactions produced by local edits (tracked by the undo manager) */
  const LOCAL = { zeditor: 'local' };
  /** origin of local changes that must not become undo steps (anchoring, upload results) */
  const SILENT = { zeditor: 'silent' };
  const ymaps = new Map<string, Y.Map<any>>();
  const idOf = new WeakMap<Y.Map<any>, string>();
  const register = (id: string, m: Y.Map<any>) => {
    ymaps.set(id, m);
    idOf.set(m, id);
  };
  const itemId = (m: Y.Map<any>): { client: number; clock: number } => (m as any)._item?.id ?? { client: 0, clock: 0 };
  const isDeleted = (m: Y.Map<any>) => !!(m as any)._item?.deleted;
  /** true when `a` was created before `b` in the total order every client agrees on */
  const older = (a: Y.Map<any>, b: Y.Map<any>) => {
    const x = itemId(a);
    const y = itemId(b);
    return x.client === y.client ? x.clock < y.clock : x.client < y.client;
  };
  /**
   * Two live blocks can end up with one id when two users move the same block at the same
   * time (a move is delete + insert, so both insertions survive). Every client picks the same
   * loser (the younger Y item) and gives it the same new id, written back to the shared doc.
   */
  const aliasFor = (id: string, loser: Y.Map<any>) => {
    const i = itemId(loser);
    return (id.length > 40 ? id.slice(0, 40) : id) + '-' + i.client.toString(36) + '-' + i.clock.toString(36);
  };
  const isText = (type: string) => editor.schema.node(type)?.kind === 'text';
  let applyingRemote = false;
  let destroyed = false;
  const canEdit = () => (opts.permissions?.canEdit ?? (() => true))(user);

  const indexAll = () => {
    ymaps.clear();
    const fixes: [Y.Map<any>, string][] = [];
    const walk = (arr: Y.Array<Y.Map<any>>) => {
      for (const m of arr.toArray()) {
        const id = String(m.get('id'));
        const other = ymaps.get(id);
        if (other && other !== m) {
          const loser = older(other, m) ? m : other;
          const winner = loser === m ? other : m;
          const alias = aliasFor(id, loser);
          fixes.push([loser, alias]);
          register(id, winner);
          register(alias, loser);
        } else register(id, m);
        const kids = m.get('children') as Y.Array<Y.Map<any>> | undefined;
        if (kids) walk(kids);
      }
    };
    walk(root);
    if (fixes.length) ydoc.transact(() => fixes.forEach(([m, alias]) => m.get('id') !== alias && m.set('id', alias)), SILENT);
  };
  const loadFromY = () => {
    indexAll();
    applyingRemote = true;
    try {
      editor.setJSON(root.toArray().map((m) => fromY(m, isText)), { origin: 'remote' });
    } finally {
      applyingRemote = false;
    }
  };
  const seed = (): boolean => {
    if (root.length) return false;
    ydoc.transact(() => {
      root.insert(0, editor.doc.blocks.map((b) => toY(b.toJSON(), register)));
    }, SILENT);
    return true;
  };

  /* ---- local -> Y */
  const arrayOf = (parent: string): Y.Array<Y.Map<any>> | null => (parent === 'root' ? root : ((ymaps.get(parent)?.get('children') as Y.Array<Y.Map<any>>) ?? null));
  const unregister = (m: Y.Map<any>) => {
    const id = String(m.get('id'));
    if (ymaps.get(id) === m) ymaps.delete(id);
    (m.get('children') as Y.Array<Y.Map<any>> | undefined)?.forEach(unregister);
  };
  const applyLocal = (steps: readonly Step[]) => {
    for (const s of steps) {
      if (s.t === 'text') {
        const ytext = ymaps.get(s.id)?.get('text') as Y.Text | undefined;
        if (!ytext) continue;
        if (s.to > s.from) ytext.delete(s.from, s.to - s.from);
        if (s.insert.length) {
          // explicit nulls for every mark used in the block so inserted text never inherits formatting
          const keys = markKeys(editor.doc.get(s.id)?.content, markKeys(s.insert));
          for (const op of ytext.toDelta()) if (op.attributes) for (const k in op.attributes) keys.add(k);
          insertInline(ytext, s.from, s.insert, keys);
        }
      } else if (s.t === 'attrs') {
        const m = ymaps.get(s.id);
        if (!m) continue;
        if (s.type !== undefined) m.set('type', s.type);
        if (s.attrs !== undefined) m.set('attrs', JSON.parse(JSON.stringify(s.attrs)));
      } else if (s.t === 'insert') {
        const arr = arrayOf(s.parent);
        if (arr) arr.insert(Math.min(s.index, arr.length), s.blocks.map((b) => toY(b, register)));
      } else {
        const arr = arrayOf(s.parent);
        if (!arr) continue;
        const n = Math.min(s.count, arr.length - s.index);
        for (let i = 0; i < n; i++) unregister(arr.get(s.index + i));
        if (n > 0) arr.delete(s.index, n);
      }
    }
  };
  /** number of steps translated from a remote change; anything after it was added locally by normalization */
  let remoteMark = -1;
  const onTransaction = (ev: TransactionEvent) => {
    if (applyingRemote && remoteMark >= 0 && ev.tr.steps.length > remoteMark && !destroyed) {
      // structural repairs made while applying a remote change (e.g. an emptied document got
      // its paragraph back) must reach the shared document too, or the two would diverge
      const extra = ev.tr.steps.slice(remoteMark);
      remoteMark = -1;
      ydoc.transact(() => applyLocal(extra), SILENT);
      return;
    }
    if (applyingRemote || !ev.docChanged || destroyed) {
      if (!applyingRemote) publishSelection();
      return;
    }
    if (ev.tr.meta.replaceAll && ev.origin === 'load') {
      // host loaded another document into the editor: replace the shared one
      ydoc.transact(() => {
        root.delete(0, root.length);
        ymaps.clear();
        root.insert(0, editor.doc.blocks.map((b) => toY(b.toJSON(), register)));
      }, SILENT);
      return;
    }
    ydoc.transact(() => applyLocal(ev.tr.steps), ev.tr.meta.addToHistory === false ? SILENT : LOCAL);
    publishSelection();
  };

  /* ---- Y -> local */
  const ownerOf = (target: Y.AbstractType<any>): Y.Map<any> | 'root' | null => {
    if (target === root) return 'root';
    if (target instanceof Y.Map) return target;
    const p = target.parent;
    return p instanceof Y.Map ? p : null;
  };
  const onDeep = (events: Y.YEvent<any>[], tx: Y.Transaction) => {
    if (tx.origin === LOCAL || tx.origin === SILENT || destroyed) return;
    const { doc } = editor;
    // blocks created in this transaction arrive complete through their parent's insert
    const fresh = new Set<Y.Map<any>>();
    for (const e of events)
      if (e.target instanceof Y.Array)
        for (const op of e.changes.delta as any[])
          if (Array.isArray(op.insert))
            for (const m of op.insert as Y.Map<any>[]) {
              const mark = (x: Y.Map<any>) => {
                fresh.add(x);
                (x.get('children') as Y.Array<Y.Map<any>> | undefined)?.forEach(mark);
              };
              if (m instanceof Y.Map) mark(m);
            }
    const known = (owner: Y.Map<any> | 'root' | null): string | null => {
      if (owner === 'root') return 'root';
      if (!owner || fresh.has(owner)) return null;
      const id = idOf.get(owner);
      return id !== undefined && ymaps.get(id) === owner && doc.has(id) ? id : null;
    };
    const arrays: { id: string; delta: any[] }[] = [];
    const texts: { id: string; delta: any[] }[] = [];
    const maps: { id: string; map: Y.Map<any>; keys: Set<string> }[] = [];
    for (const e of events) {
      const id = known(ownerOf(e.target));
      if (!id) continue;
      if (e.target instanceof Y.Text) texts.push({ id, delta: e.changes.delta as any[] });
      else if (e.target instanceof Y.Array) arrays.push({ id, delta: e.changes.delta as any[] });
      else if (e.target instanceof Y.Map) maps.push({ id, map: e.target, keys: new Set(e.changes.keys.keys()) });
    }
    if (!arrays.length && !texts.length && !maps.length) return;
    const repairs: string[] = [];
    const idFixes: [Y.Map<any>, string][] = [];
    const pendingJSON = new Map<Y.Map<any>, BlockJSON>();
    applyingRemote = true;
    try {
      editor.update(
        (tr) => {
          // 1. removals (descending, in each array's old coordinates)
          for (const a of arrays) {
            const dels: [number, number][] = [];
            let pos = 0;
            for (const op of a.delta) {
              if (op.retain) pos += op.retain;
              else if (op.delete) {
                dels.push([pos, op.delete]);
                pos += op.delete;
              }
            }
            const parent = doc.get(a.id);
            if (!parent) continue;
            for (let i = dels.length - 1; i >= 0; i--) {
              const [index, count] = dels[i];
              const n = Math.min(count, (parent.children?.length ?? 0) - index);
              if (n <= 0) continue;
              const drop = (b: Block) => {
                // keep registrations that already point at a re-inserted (moved) Y.Map
                const m = ymaps.get(b.id);
                if (m && isDeleted(m)) ymaps.delete(b.id);
                b.children?.forEach(drop);
              };
              parent.children!.slice(index, index + n).forEach(drop);
              tr.removeAt(a.id, index, n);
            }
          }
          // 2. insertions (ascending, in new coordinates)
          for (const a of arrays) {
            if (!doc.get(a.id)) continue;
            let pos = 0;
            for (const op of a.delta) {
              if (op.retain) pos += op.retain;
              else if (Array.isArray(op.insert)) {
                const blocks: BlockJSON[] = [];
                for (const m of op.insert as Y.Map<any>[]) {
                  if (!(m instanceof Y.Map)) continue;
                  const j = fromY(m, isText);
                  const fix = (jb: BlockJSON, ym: Y.Map<any>) => {
                    const other = ymaps.get(jb.id);
                    if (other && other !== ym && !isDeleted(other)) {
                      // the same id twice (two users moved one block): keep both, rename the younger copy
                      const loser = older(other, ym) ? ym : other;
                      const alias = aliasFor(jb.id, loser);
                      idFixes.push([loser, alias]);
                      if (loser === ym) jb.id = alias;
                      else {
                        const pending = pendingJSON.get(other);
                        if (pending) pending.id = alias;
                        else if (doc.has(jb.id)) tr.replaceBlock(jb.id, [{ ...doc.get(jb.id)!.toJSON(), id: alias }]);
                        register(alias, other);
                      }
                    } else if (doc.has(jb.id) && (!other || other === ym || isDeleted(other)) && !pendingJSON.has(ym)) {
                      // stale local block under this id without a live shared counterpart
                      if (other !== ym) jb.id = aliasFor(jb.id, ym);
                    }
                    register(jb.id, ym);
                    pendingJSON.set(ym, jb);
                    const kids = (ym.get('children') as Y.Array<Y.Map<any>>).toArray();
                    jb.children?.forEach((c, i) => fix(c, kids[i]));
                  };
                  fix(j, m);
                  blocks.push(j);
                }
                const parent = doc.get(a.id)!;
                const clean = editor.schema.sanitizeBlocks(blocks);
                tr.insert(a.id, Math.min(pos, parent.children?.length ?? 0), clean);
                pos += blocks.length;
              }
            }
          }
          // 3. text
          for (const t of texts) {
            const b = doc.get(t.id);
            if (!b || !b.content) continue;
            let pos = 0;
            for (const op of t.delta) {
              if (op.delete) tr.replaceText(t.id, pos, Math.min(b.length, pos + op.delete));
              else if (op.insert !== undefined) {
                const ins = deltaToInline([op]);
                const clean = editor.schema.parseInline(ins, undefined, []);
                tr.replaceText(t.id, Math.min(pos, b.length), Math.min(pos, b.length), clean);
                pos += clean.reduce((n, c) => n + (isAtom(c) ? 1 : c.text.length), 0);
              } else if (op.retain) {
                if (op.attributes) {
                  // formatting change over [pos, pos + retain)
                  const end = Math.min(b.length, pos + op.retain);
                  let p2 = 0;
                  const next: Inline[] = [];
                  for (const c of b.content!) {
                    const len = isAtom(c) ? 1 : c.text.length;
                    const s = Math.max(pos, p2);
                    const e = Math.min(end, p2 + len);
                    if (e > s) {
                      const marks: MarkSet = { ...(c.marks ?? {}) };
                      for (const k in op.attributes) {
                        if (op.attributes[k] == null) delete marks[k];
                        else marks[k] = op.attributes[k];
                      }
                      const m = Object.keys(marks).length ? marks : undefined;
                      next.push(isAtom(c) ? ({ atom: c.atom, attrs: c.attrs, marks: m } as Inline) : ({ text: c.text.slice(s - p2, e - p2), marks: m } as Inline));
                    }
                    p2 += len;
                  }
                  if (end > pos) tr.step({ t: 'text', id: t.id, from: pos, to: end, insert: next });
                }
                pos += op.retain;
              }
            }
          }
          // 4. type / attrs
          for (const m of maps) {
            const b = doc.get(m.id);
            if (!b) continue;
            if (m.keys.has('id')) {
              const nid = String(m.map.get('id'));
              if (nid !== m.id && /^[\w:.-]{1,64}$/.test(nid) && !doc.has(nid)) {
                tr.replaceBlock(m.id, [{ ...b.toJSON(), id: nid }]);
                if (ymaps.get(m.id) === m.map) ymaps.delete(m.id);
                register(nid, m.map);
                m.id = nid;
              }
            }
            const cur = doc.get(m.id);
            if (!cur) continue;
            const step: Step = { t: 'attrs', id: m.id };
            const rawType = m.map.get('type');
            const rawAttrs = m.map.get('attrs');
            // Interleaved undos by two users can leave a key without a value (Yjs deletes the
            // value one user restored and finds nothing it may restore). Keep what we have
            // and write it back below so every client converges on a valid block.
            if (rawType === undefined || rawAttrs === undefined) repairs.push(m.id);
            if (m.keys.has('type') && rawType !== undefined) {
              const type = String(rawType);
              if (editor.schema.node(type) && editor.schema.kind({ type }) === editor.schema.kind(b)) step.type = type;
            }
            if ((m.keys.has('attrs') && rawAttrs !== undefined) || step.type) {
              const spec = editor.schema.node(step.type ?? b.type);
              step.attrs = editor.schema.parseAttrs(spec?.attrs, rawAttrs ?? b.attrs, true);
            }
            if (step.type !== undefined || step.attrs !== undefined) tr.step(step);
          }
          remoteMark = tr.steps.length;
        },
        { origin: 'remote', history: false },
      );
    } catch (err) {
      // the incremental translation failed: fall back to a full reload from the shared state
      console.error('[zeditor/collab] resync after error', err);
      const sel = editor.selection;
      loadFromY();
      editor.setSelection(fixSelection(sel, editor.doc, editor.schema));
    } finally {
      applyingRemote = false;
      remoteMark = -1;
    }
    if (repairs.length || idFixes.length)
      ydoc.transact(() => {
        for (const [m, alias] of idFixes) if (!isDeleted(m) && m.get('id') !== alias) m.set('id', alias);
        for (const id of repairs) {
          const m = ymaps.get(id);
          const b = editor.doc.get(id);
          if (!m || !b) continue;
          if (m.get('type') === undefined) m.set('type', b.type);
          if (m.get('attrs') === undefined) m.set('attrs', JSON.parse(JSON.stringify(b.attrs)));
        }
      }, SILENT);
  };
  const contains = (j: BlockJSON, id: string): boolean => j.id === id || !!j.children?.some((c) => contains(c, id));

  /* ---- presence */
  const presenceSubs = new Set<(s: RemoteState[]) => void>();
  const publishSelection = () => {
    if (destroyed) return;
    const cur = awareness.getLocalState();
    const sel = editor.selection;
    if (cur && JSON.stringify(cur.selection) === JSON.stringify(sel)) return;
    awareness.setLocalStateField('selection', sel ? JSON.parse(JSON.stringify(sel)) : null);
  };
  const remoteStates = (): RemoteState[] => {
    const out: RemoteState[] = [];
    awareness.getStates().forEach((st: any, clientId: number) => {
      if (clientId === ydoc.clientID || !st?.user) return;
      out.push({ clientId, user: st.user, selection: fixSelection(st.selection ?? null, editor.doc, editor.schema) });
    });
    return out;
  };
  let layer: HTMLElement | null = null;
  let styleEl: HTMLStyleElement | null = null;
  let offHighlight: (() => void) | null = null;
  const paintPresence = () => {
    const view = editor.view;
    if (!view || opts.presence === false) return;
    const host = view.root.parentElement as HTMLElement | null;
    if (!host) return;
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'z-presence';
      layer.setAttribute('aria-hidden', 'true');
      layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:visible';
      host.append(layer);
      styleEl = document.createElement('style');
      document.head.append(styleEl);
    }
    layer.textContent = '';
    const base = host.getBoundingClientRect();
    let css = '';
    for (const st of remoteStates()) {
      const color = /^#[0-9a-f]{3,8}$/i.test(st.user.color ?? '') ? st.user.color! : COLORS[st.clientId % COLORS.length];
      css += `::highlight(z-remote-${st.clientId}){background-color:${color}40}`;
      const sel = st.selection;
      const point = sel?.type === 'text' ? sel.focus : null;
      const rect = point ? view.coordsAt(point) : sel ? view.domOf(sel.type === 'block' ? sel.ids[0] : sel.focus)?.getBoundingClientRect() : null;
      if (!rect) continue;
      const caret = document.createElement('div');
      caret.className = 'z-remote-caret';
      caret.dataset.client = String(st.clientId);
      caret.style.cssText = `left:${rect.left - base.left + host.scrollLeft}px;top:${rect.top - base.top + host.scrollTop}px;height:${rect.height}px;background:${color};${point ? '' : `width:${rect.width}px;opacity:.18`}`;
      const label = document.createElement('span');
      label.className = 'z-remote-label';
      label.style.background = color;
      label.textContent = st.user.name;
      caret.append(label);
      layer.append(caret);
    }
    if (styleEl && styleEl.textContent !== css) styleEl.textContent = css;
  };
  const attachView = () => {
    const view = editor.view;
    if (!view || opts.presence === false || offHighlight) return;
    offHighlight = view.addHighlightSource('presence', () => {
      const out: Record<string, { id: string; from: number; to: number }[]> = {};
      for (const st of remoteStates()) {
        const sel = st.selection;
        if (!sel || sel.type !== 'text') continue;
        const { doc } = editor;
        const a = doc.get(sel.anchor.id);
        const f = doc.get(sel.focus.id);
        if (!a || !f) continue;
        const fwd = a === f ? sel.anchor.offset <= sel.focus.offset : doc.compare(a, f) < 0;
        const from = fwd ? sel.anchor : sel.focus;
        const to = fwd ? sel.focus : sel.anchor;
        if (from.id === to.id && from.offset === to.offset) continue;
        const list = (out['z-remote-' + st.clientId] ??= []);
        let cur: Block | null = doc.get(from.id) ?? null;
        for (let guard = 0; cur && guard < 2000; guard++) {
          if (cur.content) list.push({ id: cur.id, from: cur.id === from.id ? from.offset : 0, to: cur.id === to.id ? to.offset : cur.length });
          if (cur.id === to.id) break;
          cur = doc.next(cur);
        }
      }
      return out;
    });
  };
  let presenceTimer: any = 0;
  const onAwareness = () => {
    const states = remoteStates();
    presenceSubs.forEach((f) => f(states));
    editor.view?.scheduleHighlights();
    clearTimeout(presenceTimer);
    presenceTimer = setTimeout(paintPresence, 16);
  };

  /* ---- undo */
  let undoManager: Y.UndoManager | null = null;
  let prevHistory: HistoryProvider | null = null;
  if (opts.undo !== false) {
    undoManager = new Y.UndoManager(root, { trackedOrigins: new Set([LOCAL]), captureTimeout: 500 });
    const um = undoManager;
    um.on('stack-item-added', (e: any) => {
      if (!e.stackItem.meta.has('before')) e.stackItem.meta.set('before', pendingBefore ?? editor.selection);
      e.stackItem.meta.set('after', editor.selection);
    });
    um.on('stack-item-updated', (e: any) => e.stackItem.meta.set('after', editor.selection));
    um.on('stack-item-popped', (e: any) => {
      const sel = e.stackItem.meta.get(e.type === 'undo' ? 'before' : 'after');
      if (sel) editor.setSelection(fixSelection(sel, editor.doc, editor.schema), { scroll: true });
    });
    prevHistory = editor.history;
    editor.history = {
      undo: () => {
        um.stopCapturing();
        return !!um.undo();
      },
      redo: () => !!um.redo(),
      canUndo: () => um.undoStack.length > 0,
      canRedo: () => um.redoStack.length > 0,
      clear: () => um.clear(),
      cut: () => um.stopCapturing(),
    };
  }
  let pendingBefore: Selection | null = null;
  const captureBefore = () => {
    pendingBefore = editor.selection;
  };

  /* ---- wire up */
  if (root.length) loadFromY();
  else if (opts.seed) seed();
  const onRootFirst = () => {
    // content arrived in a previously empty shared document: adopt it wholesale
    if (!ymaps.size && root.length) loadFromY();
  };
  const deep = (events: Y.YEvent<any>[], tx: Y.Transaction) => {
    if (tx.origin === LOCAL || tx.origin === SILENT) return;
    if (!ymaps.size) return onRootFirst();
    onDeep(events, tx);
  };
  root.observeDeep(deep);
  awareness.setLocalState({ user, selection: editor.selection });
  awareness.on('change', onAwareness);
  const offs = [
    editor.on('transaction', onTransaction),
    editor.on('selection', captureBefore),
    editor.on('mount', () => {
      attachView();
      onAwareness();
    }),
    editor.on('focus', publishSelection),
  ];
  attachView();
  const repaint = () => {
    clearTimeout(presenceTimer);
    presenceTimer = setTimeout(paintPresence, 16);
  };
  offs.push(editor.on('update', repaint));
  if (typeof window !== 'undefined') window.addEventListener('resize', repaint);
  const wasReadOnly = editor.readOnly;
  if (!canEdit()) editor.setReadOnly(true);

  return {
    doc: ydoc,
    awareness,
    undoManager,
    seed,
    isEmpty: () => root.length === 0,
    remoteStates,
    onPresence(fn) {
      presenceSubs.add(fn);
      return () => presenceSubs.delete(fn);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.unobserveDeep(deep);
      awareness.off('change', onAwareness);
      removeAwarenessStates(awareness, [ydoc.clientID], 'destroy');
      offs.forEach((o) => o());
      offHighlight?.();
      clearTimeout(presenceTimer);
      if (typeof window !== 'undefined') window.removeEventListener('resize', repaint);
      layer?.remove();
      styleEl?.remove();
      undoManager?.destroy();
      if (prevHistory) editor.history = prevHistory;
      if (!wasReadOnly && editor.readOnly && !canEdit()) editor.setReadOnly(false);
      presenceSubs.clear();
    },
  };
}

/* ------------------------------------------------------------------ shared comment threads */

/** Comment threads stored in the shared document, so every participant sees them. */
export function yCommentStore(doc: Y.Doc): CommentStore {
  const map = doc.getMap<CommentThread>('threads');
  return {
    list: () => [...map.values()].sort((a, b) => a.createdAt - b.createdAt),
    get: (id) => map.get(id),
    put: (t) => void map.set(t.id, JSON.parse(JSON.stringify(t))),
    remove: (id) => void map.delete(id),
    subscribe: (fn) => {
      map.observe(fn);
      return () => map.unobserve(fn);
    },
  };
}

/* ------------------------------------------------------------------ transport & sync */

/** Host transport adapter: an unreliable-until-open, ordered, binary message channel. */
export interface Transport {
  send(data: Uint8Array): void;
  onMessage(fn: (data: Uint8Array) => void): () => void;
  onOpen(fn: () => void): () => void;
  onClose(fn: () => void): () => void;
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
}
export interface SyncHandle {
  readonly synced: boolean;
  readonly connected: boolean;
  /** resolves after the first state exchange with a peer (or `timeout` ms when alone) */
  whenSynced(timeout?: number): Promise<boolean>;
  onStatus(fn: (s: { connected: boolean; synced: boolean }) => void): () => void;
  connect(): void;
  disconnect(): void;
  destroy(): void;
}

const MSG_STATE = 0;
const MSG_UPDATE = 1;
const MSG_AWARENESS = 2;
/** state vector sent in answer to MSG_STATE; must not be answered with another state vector */
const MSG_STATE_REPLY = 3;
const frame = (type: number, body: Uint8Array): Uint8Array => {
  const out = new Uint8Array(body.length + 1);
  out[0] = type;
  out.set(body, 1);
  return out;
};

/**
 * Keep a Y.Doc (and awareness) in sync over a transport. Edits made while disconnected stay
 * in the local document and are merged when the connection returns.
 */
export function connectSync(doc: Y.Doc, awareness: Awareness | null, transport: Transport): SyncHandle {
  const ORIGIN = { zeditor: 'sync' };
  let synced = false;
  let destroyed = false;
  const subs = new Set<(s: { connected: boolean; synced: boolean }) => void>();
  const waiters: ((v: boolean) => void)[] = [];
  const status = () => subs.forEach((f) => f({ connected: transport.connected, synced }));
  let savedPresence: any = null;
  const hello = () => {
    if (awareness && !awareness.getLocalState() && savedPresence) awareness.setLocalState(savedPresence);
    transport.send(frame(MSG_STATE, Y.encodeStateVector(doc)));
    if (awareness && awareness.getLocalState()) transport.send(frame(MSG_AWARENESS, encodeAwarenessUpdate(awareness, [doc.clientID])));
  };
  const onUpdate = (update: Uint8Array, origin: any) => {
    if (origin === ORIGIN || !transport.connected) return;
    transport.send(frame(MSG_UPDATE, update));
  };
  const onAwareness = ({ added, updated, removed }: any, origin: any) => {
    if (origin === ORIGIN || !transport.connected || !awareness) return;
    transport.send(frame(MSG_AWARENESS, encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed])));
  };
  const offMsg = transport.onMessage((data) => {
    if (destroyed || !data.length) return;
    const body = data.subarray(1);
    if (data[0] === MSG_STATE || data[0] === MSG_STATE_REPLY) {
      // a peer told us what it has: send what it lacks...
      transport.send(frame(MSG_UPDATE, Y.encodeStateAsUpdate(doc, body)));
      if (data[0] === MSG_STATE) {
        // ...and ask for what we lack (it may have worked offline)
        transport.send(frame(MSG_STATE_REPLY, Y.encodeStateVector(doc)));
        if (awareness) transport.send(frame(MSG_AWARENESS, encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()])));
      }
    } else if (data[0] === MSG_UPDATE) {
      Y.applyUpdate(doc, body, ORIGIN);
      if (!synced) {
        synced = true;
        waiters.splice(0).forEach((w) => w(true));
        status();
      }
    } else if (data[0] === MSG_AWARENESS && awareness) applyAwarenessUpdate(awareness, body, ORIGIN);
  });
  const offOpen = transport.onOpen(() => {
    hello();
    status();
  });
  const offClose = transport.onClose(() => {
    synced = false;
    if (awareness) removeAwarenessStates(awareness, [...awareness.getStates().keys()].filter((c) => c !== doc.clientID), ORIGIN);
    status();
  });
  doc.on('update', onUpdate);
  awareness?.on('update', onAwareness);
  if (transport.connected) hello();
  return {
    get synced() {
      return synced;
    },
    get connected() {
      return transport.connected;
    },
    whenSynced(timeout = 1500) {
      if (synced) return Promise.resolve(true);
      return new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), timeout);
        waiters.push((v) => {
          clearTimeout(t);
          resolve(v);
        });
      });
    },
    onStatus(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    connect: () => transport.connect(),
    disconnect: () => {
      // leave politely: tell peers our presence is gone before the channel closes
      if (awareness && transport.connected) {
        savedPresence = awareness.getLocalState();
        awareness.setLocalState(null);
      }
      transport.disconnect();
    },
    destroy() {
      destroyed = true;
      offMsg();
      offOpen();
      offClose();
      doc.off('update', onUpdate);
      awareness?.off('update', onAwareness);
      subs.clear();
    },
  };
}

function emitter<T>() {
  const set = new Set<(v: T) => void>();
  return {
    on(fn: (v: T) => void) {
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(v: T) {
      for (const f of [...set]) f(v);
    },
  };
}

/** In-memory hub: every connected endpoint receives what the others send. For demos and tests. */
export function memoryHub(): { endpoint(): Transport } {
  const peers = new Set<{ deliver(d: Uint8Array): void; connected: boolean; open(): void }>();
  return {
    endpoint() {
      const msg = emitter<Uint8Array>();
      const open = emitter<void>();
      const close = emitter<void>();
      const self = { connected: false, deliver: (d: Uint8Array) => msg.emit(d), open: () => open.emit() };
      const t: Transport = {
        get connected() {
          return self.connected;
        },
        send(data) {
          if (!self.connected) return;
          const copy = data.slice();
          for (const p of peers) if (p !== self && p.connected) queueMicrotask(() => p.connected && p.deliver(copy));
        },
        onMessage: msg.on,
        onOpen: open.on,
        onClose: close.on,
        connect() {
          if (self.connected) return;
          self.connected = true;
          peers.add(self);
          open.emit();
        },
        disconnect() {
          if (!self.connected) return;
          self.connected = false;
          peers.delete(self);
          close.emit();
        },
      };
      return t;
    },
  };
}

/** Cross-tab transport in one browser profile. */
export function broadcastChannelTransport(name: string): Transport {
  const msg = emitter<Uint8Array>();
  const open = emitter<void>();
  const close = emitter<void>();
  let ch: BroadcastChannel | null = null;
  return {
    get connected() {
      return !!ch;
    },
    send: (data) => ch?.postMessage(data),
    onMessage: msg.on,
    onOpen: open.on,
    onClose: close.on,
    connect() {
      if (ch) return;
      ch = new BroadcastChannel(name);
      ch.onmessage = (e) => msg.emit(new Uint8Array(e.data));
      open.emit();
    },
    disconnect() {
      if (!ch) return;
      ch.close();
      ch = null;
      close.emit();
    },
  };
}

/**
 * WebSocket transport with automatic reconnect. The server only needs to relay binary frames
 * to the other clients of the same room (see docs/collaboration.md for a 30-line relay and for
 * what a production server must add: authentication, authorization and persistence).
 */
export function webSocketTransport(url: string, opts: { reconnectDelay?: number; maxDelay?: number; WebSocketImpl?: any } = {}): Transport {
  const msg = emitter<Uint8Array>();
  const open = emitter<void>();
  const close = emitter<void>();
  const WS = opts.WebSocketImpl ?? (globalThis as any).WebSocket;
  let ws: any = null;
  let want = false;
  let attempts = 0;
  let timer: any = 0;
  let isOpen = false;
  const start = () => {
    if (!want || ws) return;
    ws = new WS(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      attempts = 0;
      isOpen = true;
      open.emit();
    };
    ws.onmessage = (e: any) => msg.emit(new Uint8Array(e.data));
    ws.onclose = () => {
      const was = isOpen;
      isOpen = false;
      ws = null;
      if (was) close.emit();
      if (want) timer = setTimeout(start, Math.min(opts.maxDelay ?? 15000, (opts.reconnectDelay ?? 500) * 2 ** attempts++));
    };
    ws.onerror = () => ws?.close();
  };
  return {
    get connected() {
      return isOpen;
    },
    send: (data) => {
      if (isOpen) ws.send(data);
    },
    onMessage: msg.on,
    onOpen: open.on,
    onClose: close.on,
    connect() {
      want = true;
      start();
    },
    disconnect() {
      want = false;
      clearTimeout(timer);
      ws?.close();
    },
  };
}

/* ------------------------------------------------------------------ offline persistence */

export interface DocPersistence {
  load(): Uint8Array | null | Promise<Uint8Array | null>;
  save(state: Uint8Array): void | Promise<void>;
}
/** Persist the shared document locally so offline edits survive a reload. Returns a disposer. */
export async function persistDoc(doc: Y.Doc, store: DocPersistence, debounce = 400): Promise<() => void> {
  const saved = await store.load();
  if (saved && saved.length) Y.applyUpdate(doc, saved, 'persistence');
  let timer: any = 0;
  const flush = () => void store.save(Y.encodeStateAsUpdate(doc));
  const on = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, debounce);
  };
  doc.on('update', on);
  return () => {
    clearTimeout(timer);
    doc.off('update', on);
    flush();
  };
}
/** Reference persistence adapter on top of localStorage (small documents; use IndexedDB in production). */
export function localStoragePersistence(key: string, storage: { getItem(k: string): string | null; setItem(k: string, v: string): void } = localStorage): DocPersistence {
  return {
    load: () => {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const bin = atob(raw);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    save: (state) => {
      let s = '';
      for (let i = 0; i < state.length; i += 0x8000) s += String.fromCharCode(...state.subarray(i, i + 0x8000));
      storage.setItem(key, btoa(s));
    },
  };
}

export { Y, Awareness };
