/**
 * Optional collaboration module (Yjs). Import from `@buffmomo/zeditor/collab`.
 *
 * Shared structure:
 *   ydoc.getArray('blocks') : Y.Array<Y.Map>     the block tree
 *   block Y.Map = { id, type, attrs (plain JSON, last writer wins per block), children: Y.Array<Y.Map> }
 *   ydoc.getText('flow')    : Y.Text             the text of every block, in one sequence:
 *       {s: blockId} text… {e: 1}   {s: blockId} text… {e: 1}   …
 *   A block's text is what follows its start marker, up to the next marker. Marks are
 *   formatting attributes, inline atoms are embeds of length 1.
 *
 * Why one sequence instead of a text per block: Enter and Backspace-at-start are then an
 * insertion and a deletion of markers, not "delete the text here and insert a copy of it
 * there". Two users splitting or joining the same paragraph cannot duplicate text, text typed
 * in the part that moves stays with it, and a block that is moved keeps its text (and the
 * edits others make in it meanwhile).
 *
 * Works with any Yjs provider (y-websocket, y-webrtc, Hocuspocus, ...): pass its Y.Doc and
 * Awareness to `createCollab`. A minimal sync protocol and three transports (in-memory hub,
 * BroadcastChannel, WebSocket) are included for demos, tests and simple deployments.
 *
 * Concurrency semantics (see docs/collaboration.md):
 *  - text edits merge character-wise; attribute changes are last-writer-wins per block
 *  - what two users type at one position stays in two runs: a remote insertion exactly at the
 *    local caret lands after it (Editor maps the selection that way for origin 'remote')
 *  - carets of other users and the selections of undo steps are Yjs relative positions
 *  - moving a block re-creates its tree entry but leaves its text in place; two users moving
 *    the same block at once leaves two entries, of which every client deletes the younger
 *  - concurrent table shape edits can leave rows of different lengths; rendering tolerates
 *    that and the table is padded to a rectangle before the next local structural edit
 */
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import type { Editor, HistoryProvider, TransactionEvent } from './core/editor';
import { Block, BlockJSON, Inline, MarkSet, contentLength, diffInline, isAtom, jsonEq, normalizeInline, sliceInline } from './core/model';
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
/** both ends of a text selection as Yjs relative positions (JSON) */
interface RelSelection {
  anchor: unknown;
  focus: unknown;
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

/* ------------------------------------------------------------------ marks <-> Y attributes */

/** a mark whose value is a set of ids (comment threads): `{ ids: [...] }` */
const isIdSet = (v: any): v is { ids: string[] } => !!v && typeof v === 'object' && Array.isArray(v.ids) && Object.keys(v).length === 1;
/**
 * Marks as Y.Text attributes. A set-valued mark becomes one attribute per member
 * (`comment:<thread>`), so two users adding different threads to the same characters both
 * succeed instead of one value overwriting the other.
 */
function encodeMarks(marks: MarkSet | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  if (marks)
    for (const k in marks) {
      const v = marks[k];
      if (isIdSet(v)) for (const id of v.ids) out[k + ':' + id] = true;
      else out[k] = v;
    }
  return out;
}
function decodeMarks(attrs: Record<string, any> | undefined): MarkSet | undefined {
  let marks: MarkSet | undefined;
  let sets: Record<string, string[]> | undefined;
  if (attrs)
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null) continue;
      const i = k.indexOf(':');
      if (i > 0 && v === true) ((sets ??= {})[k.slice(0, i)] ??= []).push(k.slice(i + 1));
      else (marks ??= {})[k] = v;
    }
  if (sets)
    for (const name in sets) {
      const whole = marks?.[name]; // written by an older version as one value
      (marks ??= {})[name] = { ids: [...new Set([...(isIdSet(whole) ? whole.ids : []), ...sets[name]])].sort() };
    }
  return marks;
}

/* ------------------------------------------------------------------ the text flow */

/**
 * One paragraph's stretch of the flow: a start marker, `len` units of text (characters and
 * inline atoms), an end marker when `closed`, and `gap` stray units that belong to no paragraph.
 */
interface Seg {
  id: string;
  len: number;
  closed: boolean;
  gap: number;
}
interface FlowState {
  /** stray units before the first start marker */
  pre: number;
  segs: Seg[];
  /** text of each paragraph (of the first start marker with its id) */
  content: Map<string, Inline[]>;
}
const isStart = (x: any): x is { s: string } => !!x && typeof x === 'object' && typeof x.s === 'string';
const isEnd = (x: any): boolean => !!x && typeof x === 'object' && x.e !== undefined && typeof x.s !== 'string' && typeof x.atom !== 'string';

function readFlow(flow: Y.Text, withContent = true): FlowState {
  const state: FlowState = { pre: 0, segs: [], content: new Map() };
  let cur: Seg | null = null;
  let out: Inline[] | null = null;
  const stray = (n: number) => {
    const last = state.segs[state.segs.length - 1];
    if (last) last.gap += n;
    else state.pre += n;
  };
  for (const op of flow.toDelta() as any[]) {
    const ins = op.insert;
    if (isStart(ins)) {
      cur = { id: ins.s, len: 0, closed: false, gap: 0 };
      state.segs.push(cur);
      out = null;
      if (withContent && !state.content.has(cur.id)) state.content.set(cur.id, (out = []));
    } else if (isEnd(ins)) {
      if (cur) {
        cur.closed = true;
        cur = null;
        out = null;
      } else stray(1);
    } else {
      const n = typeof ins === 'string' ? ins.length : 1;
      if (!cur) {
        stray(n);
        continue;
      }
      cur.len += n;
      if (!out) continue;
      const marks = decodeMarks(op.attributes);
      if (typeof ins === 'string') out.push(marks ? { text: ins, marks } : { text: ins });
      else {
        const atom = { atom: typeof ins?.atom === 'string' ? ins.atom : 'unknown', attrs: ins?.attrs ?? {} };
        out.push(marks ? { ...atom, marks } : atom);
      }
    }
  }
  return state;
}

function toY(j: BlockJSON, register: (id: string, m: Y.Map<any>) => void): Y.Map<any> {
  const m = new Y.Map<any>();
  m.set('id', j.id);
  m.set('type', j.type);
  m.set('attrs', j.attrs ? JSON.parse(JSON.stringify(j.attrs)) : {});
  const kids = new Y.Array<Y.Map<any>>();
  m.set('children', kids);
  if (j.children?.length) kids.insert(0, j.children.map((c) => toY(c, register)));
  register(j.id, m);
  return m;
}
/** text of a block written by a version that kept one Y.Text per block */
function legacyInline(text: Y.Text): Inline[] {
  const out: Inline[] = [];
  for (const op of text.toDelta() as any[]) {
    const marks = decodeMarks(op.attributes);
    if (typeof op.insert === 'string') out.push(marks ? { text: op.insert, marks } : { text: op.insert });
    else if (op.insert && typeof op.insert === 'object' && typeof op.insert.atom === 'string') out.push(marks ? { atom: op.insert.atom, attrs: op.insert.attrs ?? {}, marks } : { atom: op.insert.atom, attrs: op.insert.attrs ?? {} });
  }
  return out;
}
function fromY(m: Y.Map<any>, isText: (type: string) => boolean, contentOf: (id: string) => Inline[] | undefined): BlockJSON {
  const type = String(m.get('type'));
  const j: BlockJSON = { id: String(m.get('id')), type };
  const attrs = m.get('attrs');
  if (attrs && typeof attrs === 'object' && Object.keys(attrs).length) j.attrs = JSON.parse(JSON.stringify(attrs));
  const legacy = m.get('text');
  const content = contentOf(j.id) ?? (legacy instanceof Y.Text ? legacyInline(legacy) : undefined);
  if (isText(type) || content?.length) j.content = content ?? [];
  const kids = m.get('children') as Y.Array<Y.Map<any>> | undefined;
  if (kids && kids.length) j.children = kids.toArray().map((k) => fromY(k, isText, contentOf));
  return j;
}
/** blocks that carry text, in document order */
function textBlocks(blocks: readonly BlockJSON[], out: { id: string; content: Inline[] }[] = []): { id: string; content: Inline[] }[] {
  for (const b of blocks) {
    if (b.content) out.push({ id: b.id, content: b.content });
    if (b.children) textBlocks(b.children, out);
  }
  return out;
}

/** The shared document as block JSON (useful on a server, or to verify an editor is in sync). */
export function sharedBlocks(doc: Y.Doc, editor: Editor): BlockJSON[] {
  const { content } = readFlow(doc.getText('flow'));
  return doc
    .getArray<Y.Map<any>>('blocks')
    .toArray()
    .map((m) => fromY(m, (type) => editor.schema.node(type)?.kind === 'text', (id) => content.get(id)));
}

/* ------------------------------------------------------------------ binding */

/** the incremental translation of a remote change met a state it cannot express: reload from the shared document */
class Desync extends Error {}

export function createCollab(editor: Editor, opts: CollabOptions): Collab {
  const ydoc = opts.doc;
  const root = ydoc.getArray<Y.Map<any>>('blocks');
  const flow = ydoc.getText('flow');
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
  const isText = (type: string) => editor.schema.node(type)?.kind === 'text';
  let applyingRemote = false;
  let destroyed = false;
  const canEdit = () => (opts.permissions?.canEdit ?? (() => true))(user);

  /* ---- mirror of the flow: which stretch belongs to which paragraph */
  let pre = 0;
  let segs: Seg[] = [];
  /** the stretch that is a block's text (the first start marker with its id) */
  const primary = new Map<string, Seg>();
  const setFlow = (st: { pre: number; segs: Seg[] }) => {
    pre = st.pre;
    segs = st.segs;
    primary.clear();
    for (const s of segs) if (!primary.has(s.id)) primary.set(s.id, s);
  };
  const rebuild = () => setFlow(readFlow(flow, false));
  const size = (s: Seg) => 1 + s.len + (s.closed ? 1 : 0) + s.gap;
  /** flow index of a stretch's start marker */
  const startOf = (seg: Seg): number => {
    let p = pre;
    for (const s of segs) {
      if (s === seg) return p;
      p += size(s);
    }
    throw new Desync('unknown text stretch');
  };
  /** flow index right after a stretch's end marker: where the next paragraph goes */
  const endOf = (seg: Seg) => startOf(seg) + 1 + seg.len + (seg.closed ? 1 : 0);
  const dropSeg = (seg: Seg) => {
    const i = segs.indexOf(seg);
    if (i < 0) return;
    const prev = segs[i - 1];
    if (seg.gap && prev && !prev.closed) return rebuild(); // stray units now follow an open paragraph
    if (prev) prev.gap += seg.gap;
    else pre += seg.gap;
    segs.splice(i, 1);
    if (primary.get(seg.id) !== seg) return;
    const next = segs.find((s) => s.id === seg.id);
    if (next) primary.set(seg.id, next);
    else primary.delete(seg.id);
  };
  /** take a paragraph's markers and text out of the flow */
  const removeSeg = (seg: Seg) => {
    const prev = segs[segs.indexOf(seg) - 1];
    if (prev && !prev.closed && seg.closed) {
      // The paragraph before has lost its own end marker: this one's stays and closes it.
      // Otherwise stray text behind the marker would suddenly belong to that paragraph.
      flow.delete(startOf(seg), 1 + seg.len);
      prev.closed = true;
      prev.gap = seg.gap;
      seg.gap = 0;
    } else flow.delete(startOf(seg), 1 + seg.len + (seg.closed ? 1 : 0));
    dropSeg(seg);
  };
  const at = (pos: number, ops: any[]) => flow.applyDelta(pos > 0 ? [{ retain: pos } as any].concat(ops) : ops);
  const inlineOps = (content: readonly Inline[]): any[] =>
    content.map((c) => (isAtom(c) ? { insert: { atom: c.atom, attrs: c.attrs ?? {} }, attributes: encodeMarks(c.marks) } : { insert: c.text, attributes: encodeMarks(c.marks) }));
  /** write new paragraphs (start marker, text, end marker each) right after `after`; returns the last one */
  const writeSegs = (after: Seg | null, blocks: readonly { id: string; content: readonly Inline[] }[]): Seg | null => {
    if (!blocks.length) return after;
    let ops: any[] = [];
    const list: Seg[] = [];
    for (const b of blocks) {
      ops.push({ insert: { s: b.id } });
      ops = ops.concat(inlineOps(b.content));
      ops.push({ insert: { e: 1 } });
      list.push({ id: b.id, len: contentLength(b.content), closed: true, gap: 0 });
    }
    at(after ? endOf(after) : 0, ops);
    const i = after ? segs.indexOf(after) + 1 : 0;
    const last = list[list.length - 1];
    if (after) {
      last.gap = after.gap;
      after.gap = 0;
    } else {
      last.gap = pre;
      pre = 0;
    }
    segs = segs.slice(0, i).concat(list, segs.slice(i));
    for (const s of list) if (!primary.has(s.id)) primary.set(s.id, s);
    return last;
  };
  const marksOf = (content: readonly Inline[]) => {
    const out: (MarkSet | undefined)[] = [];
    for (const c of content) for (let i = isAtom(c) ? 1 : c.text.length; i > 0; i--) out.push(c.marks);
    return out;
  };
  /** turn the formatting of the units at `pos` from `before` into `after` (same characters) */
  const formatFlow = (pos: number, before: readonly Inline[], after: readonly Inline[]) => {
    const a = marksOf(before);
    const b = marksOf(after);
    const runs: { from: number; to: number; attrs: Record<string, any>; key: string }[] = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) continue;
      const ea = encodeMarks(a[i]);
      const eb = encodeMarks(b[i]);
      const attrs: Record<string, any> = {};
      for (const k in ea) if (!(k in eb)) attrs[k] = null;
      for (const k in eb) if (!jsonEq(ea[k], eb[k])) attrs[k] = eb[k];
      const key = JSON.stringify(attrs);
      if (key === '{}') continue;
      const last = runs[runs.length - 1];
      if (last && last.to === i && last.key === key) last.to = i + 1;
      else runs.push({ from: i, to: i + 1, attrs, key });
    }
    for (const r of runs) flow.format(pos + r.from, r.to - r.from, r.attrs);
  };
  /**
   * Replace `[from, to)` of a paragraph's text. `removed` is the text that was there: only the
   * part that really differs is replaced, and a formatting-only change is sent as formatting
   * of the existing characters (re-inserting them would collide with concurrent edits).
   */
  const writeText = (seg: Seg, from: number, to: number, insert: readonly Inline[], removed: readonly Inline[] | null) => {
    to = Math.min(to, seg.len);
    from = Math.min(from, to);
    const base = startOf(seg) + 1;
    if (to > from && insert.length && removed) {
      const change = diffInline(removed, insert);
      if (!change) return;
      if (change.formats) return formatFlow(base + from + change.from, sliceInline(removed, change.from, change.to), change.insert);
      insert = change.insert;
      to = from + change.to;
      from += change.from;
    }
    if (to > from) {
      flow.delete(base + from, to - from);
      seg.len -= to - from;
    }
    if (insert.length) {
      at(base + from, inlineOps(insert));
      seg.len += contentLength(insert);
    }
  };
  /** Enter: the text after `offset` becomes paragraph `id` by putting markers in front of it */
  const splitSeg = (seg: Seg, offset: number, id: string) => {
    at(startOf(seg) + 1 + offset, [{ insert: { e: 1 } }, { insert: { s: id } }]);
    const tail: Seg = { id, len: seg.len - offset, closed: seg.closed, gap: seg.gap };
    seg.len = offset;
    seg.closed = true;
    seg.gap = 0;
    segs.splice(segs.indexOf(seg) + 1, 0, tail);
    if (!primary.has(id)) primary.set(id, tail);
  };
  const segOfMap = (m: Y.Map<any>): Seg | null => {
    const id = String(m.get('id'));
    return ymaps.get(id) === m ? (primary.get(id) ?? null) : null;
  };
  const lastSegIn = (m: Y.Map<any>): Seg | null => {
    const kids = (m.get('children') as Y.Array<Y.Map<any>> | undefined)?.toArray() ?? [];
    for (let i = kids.length - 1; i >= 0; i--) {
      const s = lastSegIn(kids[i]);
      if (s) return s;
    }
    return segOfMap(m);
  };
  /** the paragraph that precedes position `index` of `arr` in document order: new text goes after it */
  const anchorSeg = (arr: Y.Array<Y.Map<any>>, index: number): Seg | null => {
    for (let guard = 0; guard < 1000; guard++) {
      const list = arr.toArray();
      for (let i = Math.min(index, list.length) - 1; i >= 0; i--) {
        const s = lastSegIn(list[i]);
        if (s) return s;
      }
      const owner = arr.parent;
      if (arr === root || !(owner instanceof Y.Map)) return null;
      const own = segOfMap(owner);
      if (own) return own;
      const up = owner.parent;
      if (!(up instanceof Y.Array)) return null;
      index = up.toArray().indexOf(owner);
      arr = up as Y.Array<Y.Map<any>>;
    }
    return null;
  };
  /** a block's stretch; one is created for a text block that lost its markers to a concurrent edit */
  const segFor = (id: string): Seg | null => {
    const have = primary.get(id);
    if (have) return have;
    const m = ymaps.get(id);
    const arr = m?.parent;
    if (!m || !(arr instanceof Y.Array)) return null;
    return writeSegs(anchorSeg(arr as Y.Array<Y.Map<any>>, arr.toArray().indexOf(m)), [{ id, content: [] }]);
  };

  const removeMap = (m: Y.Map<any>) => {
    const arr = m.parent;
    if (!(arr instanceof Y.Array) || isDeleted(m)) return;
    const i = arr.toArray().indexOf(m);
    if (i >= 0) arr.delete(i, 1);
  };
  /**
   * Two live blocks can end up with one id when two users move the same block at the same
   * time (a move re-creates the block's entry). The text exists once, so one entry has to go:
   * every client picks the same one (the younger Y item) and deletes it.
   */
  const indexAll = () => {
    for (let pass = 0; pass < 8; pass++) {
      ymaps.clear();
      const losers = new Set<Y.Map<any>>();
      const walk = (arr: Y.Array<Y.Map<any>>) => {
        for (const m of arr.toArray()) {
          const id = String(m.get('id'));
          const other = ymaps.get(id);
          if (other && other !== m) {
            const loser = older(other, m) ? m : other;
            losers.add(loser);
            if (loser === m) continue;
          }
          register(id, m);
          const kids = m.get('children') as Y.Array<Y.Map<any>> | undefined;
          if (kids) walk(kids);
        }
      };
      walk(root);
      if (!losers.size) return;
      ydoc.transact(() => losers.forEach(removeMap), SILENT);
    }
  };
  /** documents written before the text moved into the flow kept one Y.Text per block */
  const migrate = () => {
    const old: Y.Map<any>[] = [];
    const walk = (arr: Y.Array<Y.Map<any>>) =>
      arr.forEach((m) => {
        if (m.get('text') instanceof Y.Text) old.push(m);
        const kids = m.get('children') as Y.Array<Y.Map<any>> | undefined;
        if (kids) walk(kids);
      });
    walk(root);
    if (!old.length) return;
    ydoc.transact(() => {
      const have = new Set(readFlow(flow, false).segs.map((s) => s.id));
      let ops: any[] = [];
      for (const m of old) {
        const id = String(m.get('id'));
        const text = m.get('text') as Y.Text;
        if (!have.has(id) && (isText(String(m.get('type'))) || text.length)) {
          ops.push({ insert: { s: id } });
          ops = ops.concat(inlineOps(legacyInline(text)));
          ops.push({ insert: { e: 1 } });
          have.add(id);
        }
        m.delete('text');
      }
      if (ops.length) at(flow.length, ops);
    }, SILENT);
  };
  const loadFromY = () => {
    migrate();
    indexAll();
    // Interleaved undos by two users can leave a block without a type or attrs (Yjs deletes
    // the value one user restored and finds nothing it may restore). Put back what this
    // editor last knew, so a reload does not turn the block into an unknown one.
    const bare = [...ymaps.values()].filter((m) => m.get('type') === undefined || m.get('attrs') === undefined);
    if (bare.length)
      ydoc.transact(() => {
        for (const m of bare) {
          const b = editor.doc.get(String(m.get('id')));
          if (m.get('type') === undefined) m.set('type', b && b.type !== 'unknown' ? b.type : 'paragraph');
          if (m.get('attrs') === undefined) m.set('attrs', b && b.type !== 'unknown' ? JSON.parse(JSON.stringify(b.attrs)) : {});
        }
      }, SILENT);
    const st = readFlow(flow);
    setFlow(st);
    applyingRemote = true;
    try {
      editor.setJSON(root.toArray().map((m) => fromY(m, isText, (id) => st.content.get(id))), { origin: 'remote' });
    } finally {
      applyingRemote = false;
    }
    // Loading validates the content and may add blocks (a container that lost its last child
    // gets a paragraph). They must exist in the shared document too, or typing in them is lost.
    const missing: Step[] = [];
    const walk = (parent: Block) =>
      parent.children?.forEach((b, index) => {
        if (ymaps.has(b.id)) walk(b);
        else missing.push({ t: 'insert', parent: parent.id, index, blocks: [b.toJSON()] });
      });
    walk(editor.doc.root);
    if (missing.length) ydoc.transact(() => applyLocal(missing, []), SILENT);
    selRel = toRelative(editor.selection);
  };
  const writeAll = () => {
    const blocks = editor.doc.blocks.map((b) => b.toJSON());
    root.insert(0, blocks.map((b) => toY(b, register)));
    writeSegs(null, textBlocks(blocks).filter((b) => !primary.has(b.id)));
  };
  const seed = (): boolean => {
    if (root.length) return false;
    ydoc.transact(() => {
      rebuild();
      writeAll();
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
  /**
   * `inverse[i]` undoes `steps[i]` (it holds the text or blocks a step removed).
   *
   * The editor expresses Enter as "cut the tail + insert a block holding it", joining two
   * paragraphs as "append the text + remove the block", and a move as "remove + insert".
   * Sent literally, each would delete text and insert a copy of it, so two users doing it at
   * once would both insert a copy, and text typed concurrently in the old place would stay
   * behind or disappear. These patterns are recognised and written as what they mean:
   * a split puts markers in front of the tail, a join deletes the markers between the two
   * paragraphs, and a moved block keeps its text where it is.
   */
  const applyLocal = (steps: readonly Step[], inverse: readonly Step[]) => {
    /** steps that insert a text block, by id: a later insert of a removed block makes it a move */
    const insertedAt = new Map<string, number[]>();
    steps.forEach((s, i) => {
      if (s.t === 'insert') for (const b of textBlocks(s.blocks)) insertedAt.set(b.id, [...(insertedAt.get(b.id) ?? []), i]);
    });
    /** text of blocks that are on their way to another place */
    const held = new Map<string, Inline[]>();
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.t === 'text') {
        if (!ymaps.has(s.id)) continue;
        const seg = segFor(s.id);
        if (!seg) continue;
        const inv = inverse[i];
        const removed = inv?.t === 'text' ? inv.insert : null;
        const next = steps[i + 1];
        if (removed?.length && !s.insert.length && s.to === seg.len && next?.t === 'insert') {
          // Enter: the next step inserts a block that holds exactly the text cut here
          const nb = next.blocks[0];
          if (nb?.content && !primary.has(nb.id) && !diffInline(removed, nb.content) && arrayOf(next.parent)) {
            splitSeg(seg, s.from, nb.id);
            continue;
          }
        }
        const invNext = inverse[i + 1];
        if (s.insert.length && s.to === seg.len && next?.t === 'remove' && next.count === 1 && invNext?.t === 'insert') {
          // join: the next step removes the block whose (remaining) text is appended here
          const gone = invNext.blocks[0];
          const other = gone?.content && !insertedAt.get(gone.id)?.some((j) => j > i) ? primary.get(gone.id) : undefined;
          const keep = contentLength(s.insert);
          const cut = other ? other.len - keep : -1;
          if (other && other !== seg && cut >= 0 && other.len === contentLength(gone.content) && !seg.gap && segs[segs.indexOf(seg) + 1] === other) {
            const tail = sliceInline(gone.content, cut);
            const change = diffInline(tail, s.insert);
            if (!change || change.formats) {
              const pos = startOf(seg) + 1 + s.from;
              flow.delete(pos, seg.len - s.from + (seg.closed ? 1 : 0) + 1 + cut);
              seg.len = s.from + keep;
              seg.closed = other.closed;
              seg.gap = other.gap;
              other.gap = 0;
              dropSeg(other);
              if (change) formatFlow(pos + change.from, sliceInline(tail, change.from, change.to), change.insert);
              continue;
            }
          }
        }
        writeText(seg, s.from, s.to, s.insert, removed);
      } else if (s.t === 'attrs') {
        const m = ymaps.get(s.id);
        if (!m) continue;
        if (s.type !== undefined) m.set('type', s.type);
        if (s.attrs !== undefined) m.set('attrs', JSON.parse(JSON.stringify(s.attrs)));
      } else if (s.t === 'insert') {
        const arr = arrayOf(s.parent);
        if (!arr) continue;
        const index = Math.min(s.index, arr.length);
        let cursor = anchorSeg(arr, index);
        arr.insert(index, s.blocks.map((b) => toY(b, register)));
        let fresh: { id: string; content: Inline[] }[] = [];
        for (const b of textBlocks(s.blocks)) {
          const have = primary.get(b.id);
          if (!have) {
            fresh.push(b);
            continue;
          }
          // the text is already in the flow: a block that was moved here, or the tail of a split
          cursor = writeSegs(cursor, fresh);
          fresh = [];
          const was = held.get(b.id);
          held.delete(b.id);
          if (was && diffInline(was, b.content)) writeText(have, 0, have.len, b.content, was);
          cursor = have;
        }
        writeSegs(cursor, fresh);
      } else {
        const arr = arrayOf(s.parent);
        if (!arr) continue;
        const n = Math.min(s.count, arr.length - s.index);
        const inv = inverse[i];
        const before = new Map((inv?.t === 'insert' ? textBlocks(inv.blocks) : []).map((b) => [b.id, b.content]));
        const release = (m: Y.Map<any>) => {
          const id = String(m.get('id'));
          const seg = ymaps.get(id) === m ? primary.get(id) : undefined;
          if (seg) {
            if (insertedAt.get(id)?.some((j) => j > i)) held.set(id, before.get(id) ?? []);
            else removeSeg(seg);
          }
          (m.get('children') as Y.Array<Y.Map<any>> | undefined)?.forEach(release);
        };
        for (let k = 0; k < n; k++) {
          const m = arr.get(s.index + k);
          release(m);
          unregister(m);
        }
        if (n > 0) arr.delete(s.index, n);
      }
    }
    // a block that was taken out to be moved but never arrived
    for (const id of held.keys()) {
      const seg = primary.get(id);
      if (seg && !ymaps.has(id)) removeSeg(seg);
    }
  };
  /** number of steps translated from a remote change; anything after it was added locally by normalization */
  let remoteMark = -1;
  const onTransaction = (ev: TransactionEvent) => {
    if (applyingRemote && remoteMark >= 0 && ev.tr.steps.length > remoteMark && !destroyed) {
      // structural repairs made while applying a remote change (e.g. an emptied document got
      // its paragraph back) must reach the shared document too, or the two would diverge
      const extra = ev.tr.steps.slice(remoteMark);
      const extraInverse = ev.tr.inverse.slice(remoteMark);
      remoteMark = -1;
      ydoc.transact(() => applyLocal(extra, extraInverse), SILENT);
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
        flow.delete(0, flow.length);
        setFlow({ pre: 0, segs: [] });
        ymaps.clear();
        writeAll();
      }, SILENT);
      publishSelection();
      return;
    }
    ydoc.transact(() => applyLocal(ev.tr.steps, ev.tr.inverse), ev.tr.meta.addToHistory === false ? SILENT : LOCAL);
    publishSelection();
  };

  /* ---- Y -> local */
  const ownerOf = (target: Y.AbstractType<any>): Y.Map<any> | 'root' | null => {
    if (target === root) return 'root';
    if (target instanceof Y.Map) return target;
    const p = target.parent;
    return p instanceof Y.Map ? p : null;
  };
  type TextOp = { t: 'ins'; id: string; at: number; content: Inline[] } | { t: 'del'; id: string; from: number; to: number } | { t: 'fmt'; id: string; from: number; to: number; attrs: Record<string, any> };
  /**
   * Walk a change of the flow against the mirror. Plain typing, deleting and formatting inside
   * paragraphs comes out as exact per-block operations. Anything that touches a marker
   * (somebody split, joined, added or removed paragraphs) is `structural`: the flow is read
   * again and the paragraphs in `touched` are compared with what the editor has.
   */
  const readDelta = (delta: any[]): { structural: boolean; touched: Set<string>; ops: TextOp[] } => {
    let structural = false;
    const touched = new Set<string>();
    const ops: TextOp[] = [];
    const lenDelta = new Map<Seg, number>();
    let preDelta = 0;
    const gapDelta = new Map<Seg, number>();
    // the next unit of the old flow: unit `u` of segs[si] (si = -1: the stretch before the first marker)
    let si = -1;
    let u = 0;
    const sizeAt = (i: number) => (i < 0 ? pre : size(segs[i]));
    const norm = () => {
      while (si < segs.length - 1 && u >= sizeAt(si)) {
        u -= sizeAt(si);
        si++;
      }
    };
    const touch = (i: number) => {
      if (segs[i]) touched.add(segs[i].id);
    };
    const shift = (s: Seg) => lenDelta.get(s) ?? 0;
    for (const op of delta) {
      norm();
      if (op.insert !== undefined) {
        const ins = op.insert;
        touch(si);
        if (u === 0) touch(si - 1);
        if (isStart(ins)) touched.add(ins.s);
        if (isStart(ins) || isEnd(ins)) structural = true;
        if (structural) continue;
        // the unit to the left decides where this lands: inside a paragraph, or between two
        let host: Seg | null = null;
        let off = 0;
        let limbo: Seg | null = null;
        if (si >= 0 && u > 0) {
          const s = segs[si];
          if (u <= s.len + 1) {
            host = s;
            off = u - 1;
          } else limbo = s;
        } else if (si > 0) {
          const p = segs[si - 1];
          if (!p.gap && !p.closed) {
            host = p;
            off = p.len;
          } else limbo = p;
        }
        const n = typeof ins === 'string' ? ins.length : 1;
        if (host) {
          if (primary.get(host.id) === host) {
            const marks = decodeMarks(op.attributes);
            const content: Inline[] = typeof ins === 'string' ? [marks ? { text: ins, marks } : { text: ins }] : [{ atom: typeof ins?.atom === 'string' ? ins.atom : 'unknown', attrs: ins?.attrs ?? {}, ...(marks ? { marks } : {}) }];
            ops.push({ t: 'ins', id: host.id, at: off + shift(host), content });
          }
          lenDelta.set(host, shift(host) + n);
        } else if (limbo) gapDelta.set(limbo, (gapDelta.get(limbo) ?? 0) + n);
        else preDelta += n;
        continue;
      }
      let n: number = op.retain ?? op.delete ?? 0;
      const del = op.delete !== undefined;
      const attrs = !del && op.attributes && Object.keys(op.attributes).length ? op.attributes : null;
      while (n > 0) {
        norm();
        const total = sizeAt(si);
        if (u >= total) break; // past the end of what the mirror knows
        const s = si >= 0 ? segs[si] : null;
        if (del || attrs) touch(si);
        if (!s) {
          const k = Math.min(n, total - u);
          if (del) structural = true;
          u += k;
          n -= k;
        } else if (u === 0) {
          if (del) {
            structural = true;
            touch(si - 1);
          }
          u++;
          n--;
        } else if (u <= s.len) {
          const k = Math.min(n, s.len - u + 1);
          const from = u - 1 + shift(s);
          if (primary.get(s.id) === s) {
            if (del) ops.push({ t: 'del', id: s.id, from, to: from + k });
            else if (attrs) ops.push({ t: 'fmt', id: s.id, from, to: from + k, attrs });
          }
          if (del) lenDelta.set(s, shift(s) - k);
          u += k;
          n -= k;
        } else {
          const k = Math.min(n, total - u);
          if (del) structural = true;
          u += k;
          n -= k;
        }
      }
      if (n > 0) structural = true;
    }
    if (!structural) {
      lenDelta.forEach((d, s) => (s.len += d));
      gapDelta.forEach((d, s) => (s.gap += d));
      pre += preDelta;
    }
    return { structural, touched, ops };
  };
  /** the block (or 'root') a shared type belongs to, when the editor has it */
  let known: (owner: Y.Map<any> | 'root' | null) => string | null = () => null;
  const onRemote = (events: Y.YEvent<any>[], delta: any[]) => {
    const { doc } = editor;
    const { structural, touched, ops } = readDelta(delta);
    let parsed: FlowState | null = null;
    if (structural) setFlow((parsed = readFlow(flow)));
    const contentOf = (id: string) => (parsed ??= readFlow(flow)).content.get(id);
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
    known = (owner) => {
      if (owner === 'root') return 'root';
      if (!owner || fresh.has(owner)) return null;
      const id = idOf.get(owner);
      return id !== undefined && ymaps.get(id) === owner && doc.has(id) ? id : null;
    };
    const arrays: { id: string; delta: any[] }[] = [];
    const maps: { id: string; map: Y.Map<any>; keys: Set<string> }[] = [];
    for (const e of events) {
      const id = known(ownerOf(e.target));
      if (!id) continue;
      if (e.target instanceof Y.Array) arrays.push({ id, delta: e.changes.delta as any[] });
      else if (e.target instanceof Y.Map) maps.push({ id, map: e.target, keys: new Set(e.changes.keys.keys()) });
    }
    if (!arrays.length && !maps.length && !touched.size) return;
    const repairs: string[] = [];
    applyingRemote = true;
    try {
      editor.update(
        (tr) => {
          // 1. text of the blocks that already exist
          if (structural) {
            for (const id of touched) {
              const b = doc.get(id);
              if (!b || !b.content) continue;
              const change = diffInline(b.content, editor.schema.parseInline(contentOf(id) ?? [], undefined, []));
              if (change) tr.replaceText(id, change.from, change.to, change.insert);
            }
          } else {
            for (const op of ops) {
              const b = doc.get(op.id);
              if (!b || !b.content) continue;
              if (op.t === 'ins') {
                const pos = Math.min(op.at, b.length);
                tr.replaceText(op.id, pos, pos, editor.schema.parseInline(op.content, undefined, []));
              } else if (op.t === 'del') tr.replaceText(op.id, Math.min(op.from, b.length), Math.min(op.to, b.length));
              else {
                // formatting change over [from, to)
                const from = Math.min(op.from, b.length);
                const to = Math.min(op.to, b.length);
                if (to <= from) continue;
                const next = sliceInline(b.content, from, to).map((c) => {
                  const enc = encodeMarks(c.marks);
                  for (const k in op.attrs) {
                    if (op.attrs[k] == null) delete enc[k];
                    else enc[k] = op.attrs[k];
                  }
                  const { marks: _old, ...rest } = c as any;
                  const marks = decodeMarks(enc);
                  return (marks ? { ...rest, marks } : rest) as Inline;
                });
                tr.step({ t: 'text', id: op.id, from, to, insert: next });
              }
            }
            for (const id of touched) {
              const b = doc.get(id);
              const seg = primary.get(id);
              if (b?.content && seg && b.length !== seg.len) throw new Error(`text of ${id} is out of step with the shared document`);
            }
          }
          // 2. removals (descending, in each array's old coordinates)
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
          // 3. insertions (ascending, in new coordinates)
          for (const a of arrays) {
            if (!doc.get(a.id)) continue;
            let pos = 0;
            for (const op of a.delta) {
              if (op.retain) pos += op.retain;
              else if (Array.isArray(op.insert)) {
                const blocks: BlockJSON[] = [];
                for (const m of op.insert as Y.Map<any>[]) {
                  if (!(m instanceof Y.Map)) continue;
                  const j = fromY(m, isText, contentOf);
                  const claim = (jb: BlockJSON, ym: Y.Map<any>) => {
                    const other = ymaps.get(jb.id);
                    // the same id twice (two users moved one block), or a block the editor still
                    // has under this id: sorted out by a reload, which drops the duplicate
                    if ((other && other !== ym && !isDeleted(other)) || doc.has(jb.id)) throw new Desync(`duplicate block ${jb.id}`);
                    register(jb.id, ym);
                    const kids = (ym.get('children') as Y.Array<Y.Map<any>>).toArray();
                    jb.children?.forEach((c, i) => claim(c, kids[i]));
                  };
                  claim(j, m);
                  blocks.push(j);
                }
                const parent = doc.get(a.id)!;
                const clean = editor.schema.sanitizeBlocks(blocks);
                tr.insert(a.id, Math.min(pos, parent.children?.length ?? 0), clean);
                pos += blocks.length;
              }
            }
          }
          // 4. type / attrs
          for (const m of maps) {
            const b = doc.get(m.id);
            if (!b) continue;
            const step: Step = { t: 'attrs', id: m.id };
            const rawType = m.map.get('type');
            const rawAttrs = m.map.get('attrs');
            if (rawType !== undefined && String(rawType) !== b.type && editor.schema.node(String(rawType)) && (b.type === 'unknown' || editor.schema.kind({ type: String(rawType) }) !== editor.schema.kind(b))) {
              // the block becomes another kind of block (typically: its type was missing when
              // it arrived and has now been restored): take it from the shared document again
              tr.replaceBlock(m.id, editor.schema.sanitizeBlocks([fromY(m.map, isText, contentOf)]));
              continue;
            }
            // Interleaved undos by two users can leave a key without a value (Yjs deletes the
            // value one user restored and finds nothing it may restore). Keep what we have
            // and write it back below so every client converges on a valid block.
            if ((rawType === undefined || rawAttrs === undefined) && b.type !== 'unknown') repairs.push(m.id);
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
          // 5. the selection follows its characters, wherever they went (into the new block
          // of a split, into the previous one of a join), not offsets in a block
          const sel = fromRelative(selRel);
          if (sel) tr.select(sel);
          remoteMark = tr.steps.length;
        },
        { origin: 'remote', history: false },
      );
    } catch (err) {
      // the incremental translation failed: fall back to a full reload from the shared state
      if (!(err instanceof Desync)) console.error('[zeditor/collab] resync after error', err);
      const sel = editor.selection;
      const rel = selRel;
      loadFromY();
      editor.setSelection(fixSelection(fromRelative(rel) ?? sel, editor.doc, editor.schema));
    } finally {
      applyingRemote = false;
      remoteMark = -1;
    }
    selRel = toRelative(editor.selection);
    reorder(events);
    if (repairs.length)
      ydoc.transact(() => {
        for (const id of repairs) {
          const m = ymaps.get(id);
          const b = editor.doc.get(id);
          if (!m || !b) continue;
          if (m.get('type') === undefined) m.set('type', b.type);
          if (m.get('attrs') === undefined) m.set('attrs', JSON.parse(JSON.stringify(b.attrs)));
        }
      }, SILENT);
  };
  /**
   * Two users pressing Enter at different places of one paragraph each insert their new block
   * right after it. The text is in the right order (it never moved), but Yjs orders the two
   * new blocks by client id, which can be the wrong way round. Such a pair (inserted at the
   * same spot without knowing of each other, text order and block order disagreeing) is put
   * in text order by one client: the author of the block that has to move, or, when that
   * author is not around, the present client with the lowest id.
   */
  const reorder = (events: Y.YEvent<any>[]) => {
    const origin = (m: Y.Map<any>) => (m as any)._item?.origin ?? null;
    const together = (a: Y.Map<any>, b: Y.Map<any>) => {
      const x = origin(a);
      const y = origin(b);
      return x === y || (!!x && !!y && x.client === y.client && x.clock === y.clock);
    };
    const pairs: [string, string][] = [];
    for (const e of events) {
      if (!(e.target instanceof Y.Array) || !known(ownerOf(e.target))) continue;
      const list = (e.target as Y.Array<Y.Map<any>>).toArray();
      for (const op of e.changes.delta as any[]) {
        if (!Array.isArray(op.insert)) continue;
        for (const m of op.insert as Y.Map<any>[]) {
          const i = m instanceof Y.Map ? list.indexOf(m) : -1;
          if (i < 0) continue;
          for (const [first, second] of [
            [list[i - 1], m],
            [m, list[i + 1]],
          ]) {
            if (!first || !second || !together(first, second)) continue;
            const a = segOfMap(first);
            const b = segOfMap(second);
            if (!a || !b || segs.indexOf(b) > segs.indexOf(a)) continue;
            const author = itemId(second).client;
            const present = [...awareness.getStates().keys(), ydoc.clientID];
            const mine = author === ydoc.clientID || (!present.includes(author) && Math.min(...present) === ydoc.clientID);
            if (mine) pairs.push([String(second.get('id')), String(first.get('id'))]);
          }
        }
      }
    }
    for (const [move, before] of pairs) {
      const b = editor.doc.get(move);
      const target = editor.doc.get(before);
      if (!b || !target || !b.parent || b.parent !== target.parent || b.index !== target.index + 1 || editor.readOnly) continue;
      editor.update((tr) => void tr.move([move], target.parent!.id, target.index), { history: false, origin: 'collab' });
    }
  };
  // A remote change can touch the block tree and the flow in one transaction: collect what
  // both observers report, and translate it once Yjs has finished with every pending
  // transaction. Not earlier: a transaction started from inside another one's observers gets
  // its insertions packed into that one's update message while its deletions travel later,
  // so other clients would briefly see a moved block twice.
  let treeEvents: Y.YEvent<any>[] = [];
  let flowDelta: any[] | null = null;
  const pending = new Set<Y.Transaction>();
  const isForeign = (tx: Y.Transaction) => tx.origin !== LOCAL && tx.origin !== SILENT && !destroyed;
  const onTree = (events: Y.YEvent<any>[], tx: Y.Transaction) => {
    if (!isForeign(tx)) return;
    for (const e of events) {
      void e.changes; // must be computed while the transaction is current
      treeEvents.push(e);
    }
    pending.add(tx);
  };
  const onFlow = (e: Y.YTextEvent, tx: Y.Transaction) => {
    if (!isForeign(tx)) return;
    const delta = e.delta as any[];
    if (!delta.length) return;
    flowDelta = delta;
    pending.add(tx);
  };
  const onSettled = () => {
    if (!pending.size) return;
    const events = treeEvents;
    const delta = flowDelta ?? [];
    const several = pending.size > 1;
    treeEvents = [];
    flowDelta = null;
    pending.clear();
    if (destroyed) return;
    // content arrived in a previously empty shared document: adopt it wholesale
    if (!ymaps.size) {
      if (root.length) loadFromY();
      else rebuild();
      return;
    }
    try {
      // changes of several transactions cannot be replayed one by one any more (the shared
      // document already holds all of them): take the result as a whole
      if (several) loadFromY();
      else onRemote(events, delta);
    } catch (err) {
      console.error('[zeditor/collab] resync after error', err);
      loadFromY();
    }
  };

  /* ---- positions that survive other people's edits */
  /** the user's selection as relative positions, kept current so a remote change can be followed */
  let selRel: RelSelection | null = null;
  /**
   * A text selection as Yjs relative positions (each end is tied to a character instead of
   * an offset), so it can be resolved correctly after any number of concurrent edits. Offsets
   * alone go stale the moment someone else types earlier in the same block.
   * Must be called while the shared text matches the document the selection belongs to.
   */
  const toRelative = (sel: Selection | null): RelSelection | null => {
    if (!sel || sel.type !== 'text') return null;
    const caretOnly = sel.anchor.id === sel.focus.id && sel.anchor.offset === sel.focus.offset;
    const ab = editor.doc.get(sel.anchor.id);
    const fb = editor.doc.get(sel.focus.id);
    const forward = sel.anchor.id === sel.focus.id || !ab || !fb ? sel.anchor.offset <= sel.focus.offset : editor.doc.compare(ab, fb) < 0;
    const point = (p: { id: string; offset: number }, end: boolean) => {
      const seg = primary.get(p.id);
      if (!seg) return null;
      // a caret and the end of a range hold on to the character before them, the start of a
      // range to the character after it (the same sides the editor uses for remote edits)
      return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(flow, startOf(seg) + 1 + Math.max(0, Math.min(p.offset, seg.len)), caretOnly || end ? -1 : 0));
    };
    try {
      const anchor = point(sel.anchor, !forward);
      const focus = point(sel.focus, forward);
      return anchor && focus ? { anchor, focus } : null;
    } catch {
      return null;
    }
  };
  const fromRelative = (rel: any): Selection | null => {
    try {
      if (!rel || typeof rel !== 'object' || !rel.anchor || !rel.focus) return null;
      const point = (json: any) => {
        const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), ydoc);
        if (!abs || abs.type !== flow) return null;
        let p = pre;
        for (const s of segs) {
          if (abs.index > p && abs.index <= p + 1 + s.len) return primary.get(s.id) === s && editor.doc.get(s.id)?.content ? { id: s.id, offset: abs.index - p - 1 } : null;
          p += size(s);
          if (p >= abs.index) break;
        }
        return null;
      };
      const anchor = point(rel.anchor);
      const focus = point(rel.focus);
      return anchor && focus ? { type: 'text', anchor, focus } : null;
    } catch {
      return null; // malformed or not yet resolvable (the edit it refers to has not arrived)
    }
  };
  /** the selection a peer (or an undo step) recorded, as it is in the document now */
  const resolve = (sel: Selection | null | undefined, rel: any): Selection | null => fixSelection(fromRelative(rel) ?? sel ?? null, editor.doc, editor.schema);

  /* ---- presence */
  const presenceSubs = new Set<(s: RemoteState[]) => void>();
  const publishSelection = () => {
    if (destroyed) return;
    const cur = awareness.getLocalState();
    const sel = editor.selection;
    const rel = toRelative(sel);
    selRel = rel;
    if (cur && JSON.stringify(cur.selection) === JSON.stringify(sel) && JSON.stringify(cur.rel ?? null) === JSON.stringify(rel)) return;
    awareness.setLocalState({ ...(cur ?? { user }), selection: sel ? JSON.parse(JSON.stringify(sel)) : null, rel });
  };
  const remoteStates = (): RemoteState[] => {
    const out: RemoteState[] = [];
    awareness.getStates().forEach((st: any, clientId: number) => {
      if (clientId === ydoc.clientID || !st?.user) return;
      out.push({ clientId, user: st.user, selection: resolve(st.selection, st.rel) });
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
    undoManager = new Y.UndoManager([root, flow], { trackedOrigins: new Set([LOCAL]), captureTimeout: 500 });
    const um = undoManager;
    // Selections are kept with relative positions too: by the time a step is undone, other
    // people may have typed before it, and the plain offsets would put the caret in the wrong place.
    const after = (e: any) => e.stackItem.meta.set('after', { sel: editor.selection, rel: toRelative(editor.selection) });
    /** the redo (undo) item Yjs creates while an undo (redo) runs: it inherits the selections */
    let counterpart: any = null;
    um.on('stack-item-added', (e: any) => {
      if (um.undoing || um.redoing) {
        counterpart = e.stackItem;
        return;
      }
      if (!e.stackItem.meta.has('before')) e.stackItem.meta.set('before', pendingBefore ?? { sel: editor.selection, rel: null });
      after(e);
    });
    um.on('stack-item-updated', (e: any) => {
      if (!um.undoing && !um.redoing) after(e);
    });
    um.on('stack-item-popped', (e: any) => {
      for (const k of ['before', 'after']) if (counterpart && e.stackItem.meta.has(k)) counterpart.meta.set(k, e.stackItem.meta.get(k));
      counterpart = null;
      const saved = e.stackItem.meta.get(e.type === 'undo' ? 'before' : 'after');
      if (saved?.sel) editor.setSelection(resolve(saved.sel, saved.rel), { scroll: true });
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
  /** the selection before the next local edit (captured while the shared text still matches it) */
  let pendingBefore: { sel: Selection | null; rel: RelSelection | null } | null = null;
  const captureBefore = () => {
    pendingBefore = { sel: editor.selection, rel: toRelative(editor.selection) };
  };

  /* ---- wire up */
  if (root.length) loadFromY();
  else if (opts.seed) seed();
  root.observeDeep(onTree);
  flow.observe(onFlow);
  ydoc.on('afterAllTransactions', onSettled);
  awareness.setLocalState({ user, selection: editor.selection, rel: toRelative(editor.selection) });
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

  const api: Collab & { _verify(): string | null } = {
    doc: ydoc,
    awareness,
    undoManager,
    /** @internal consistency check for tests: null, or what is out of step */
    _verify(): string | null {
      const st = readFlow(flow);
      const strip = (list: Seg[]) => JSON.stringify(list.map((x) => [x.id, x.len, x.closed, x.gap]));
      if (st.pre !== pre || strip(st.segs) !== strip(segs)) return 'mirror of the flow: ' + strip(segs) + ' / flow: ' + strip(st.segs);
      for (const b of editor.doc.descendants()) {
        if (!b.content) continue;
        const shared = normalizeInline(editor.schema.parseInline(st.content.get(b.id) ?? [], undefined, []));
        const want = JSON.stringify(shared);
        if (!jsonEq(b.content, shared)) return 'text of ' + b.id + ': ' + JSON.stringify(b.content) + ' / shared: ' + want;
      }
      return null;
    },
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
      root.unobserveDeep(onTree);
      flow.unobserve(onFlow);
      ydoc.off('afterAllTransactions', onSettled);
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
  return api;
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
