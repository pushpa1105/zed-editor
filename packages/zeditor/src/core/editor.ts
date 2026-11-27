import { Attrs, Block, BlockJSON, Doc, DocJSON, Inline, MarkSet, contentLength, jsonEq, setIdGenerator, withIdGenerator, globalId, BLOCK_ID } from './model';
import { summarizeTransaction, BlockChanges, BlockCreated, BlockUpdated, BlockDeleted, BlockMoved, BlockCompleted, BLOCK_EVENTS } from './events';
import { Schema, clone } from './schema';
import { Selection, fixSelection, mapSelection, selEq, firstTextBlock, textSel } from './selection';
import { Step, applyStep, touched } from './steps';
import { Extension, ResolvedExtensions, resolveExtensions, InputRule, PasteRule, ToolbarItem, SlashItem, TypeaheadSource, BlockAction } from './extension';

export type EditorMode = 'classic' | 'block';

export interface EditorOptions {
  /** initial document (validated and sanitized) */
  content?: DocJSON | BlockJSON[] | null;
  extensions?: Extension[];
  /** replace the default extension set entirely (advanced) */
  baseExtensions?: Extension[];
  mode?: EditorMode;
  readOnly?: boolean;
  /** `false` disables the built-in history (collaboration installs its own) */
  history?: { delay?: number; depth?: number } | false;
  /** maximum number of characters; transactions that exceed it are rejected */
  characterLimit?: number;
  /** label overrides, merged over the defaults */
  labels?: Record<string, string>;
  locale?: string;
  /**
   * Make ids for new blocks, e.g. `() => crypto.randomUUID()` or ids reserved by your backend.
   * Must return 1–64 characters of letters, digits, `_ : . -`; an invalid or already used id
   * falls back to the built-in generator (with a console warning).
   */
  idGenerator?: () => string;
}

export interface UpdateOptions {
  /** record in undo history (default true) */
  history?: boolean;
  /** consecutive transactions with the same group merge into one undo entry */
  group?: string;
  /**
   * who produced the change: 'local' (default), 'remote', 'history', or a custom string.
   * With 'remote' (or `tr.setMeta('foreign', true)` under a custom origin) text inserted exactly
   * at the user's caret lands after it, so the caret does not jump over other people's typing.
   */
  origin?: string;
}

export interface TransactionEvent {
  tr: Transaction;
  docChanged: boolean;
  selectionChanged: boolean;
  origin: string;
}

export interface EditorEvents {
  /** fired after every committed transaction, before 'change' / 'selection' */
  transaction: TransactionEvent;
  change: TransactionEvent;
  selection: { selection: Selection | null };
  /** anything consumers may render from changed: doc, selection, mode, readOnly, stored marks */
  update: undefined;
  mode: { mode: EditorMode };
  readonly: { readOnly: boolean };
  focus: undefined;
  blur: undefined;
  issues: { issues: string[] };
  destroy: undefined;
  /** every block change of one transaction (see core/events.ts) */
  blocks: BlockChanges;
  'block:created': BlockCreated & { origin: string };
  'block:updated': BlockUpdated & { origin: string };
  'block:deleted': BlockDeleted & { origin: string };
  'block:moved': BlockMoved & { origin: string };
  /** a check-list item (any block with a `checked` attribute) was checked */
  'block:completed': BlockCompleted & { origin: string };
  'block:uncompleted': BlockCompleted & { origin: string };
  /** the caret / block selection moved into another block (`id` null: no selection) */
  'block:focus': { id: string | null; previous: string | null };
  /** block ids were renamed with `remapIds` (old id → new id) */
  'ids:remapped': { map: Record<string, string> };
  [custom: string]: any;
}

export type CommandFn = (editor: Editor, ...args: any[]) => boolean;

/** Augment this interface from extensions to type `editor.commands`. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Commands {}
type CommandMap = { [K in keyof Commands]: Commands[K] } & Record<string, (...args: any[]) => boolean>;

export class Transaction {
  steps: Step[] = [];
  /** inverse of each step, same order */
  inverse: Step[] = [];
  /** `undefined` means: map the previous selection through the steps */
  selection: Selection | null | undefined = undefined;
  meta: Record<string, any> = {};
  /** ids of blocks whose attrs/content/children changed */
  dirty = new Set<string>();
  selectionBefore: Selection | null;
  scrollIntoView = false;

  constructor(public editor: Editor) {
    this.selectionBefore = editor.selection;
  }
  get doc(): Doc {
    return this.editor.doc;
  }
  get schema(): Schema {
    return this.editor.schema;
  }
  get docChanged(): boolean {
    return this.steps.length > 0;
  }

  step(s: Step): this {
    const inv = applyStep(this.doc, s);
    this.steps.push(s);
    this.inverse.push(inv);
    this.dirty.add(touched(s));
    return this;
  }
  /** Replace inline content of a text block. Strings inherit `marks`. */
  replaceText(id: string, from: number, to: number, insert: Inline[] | string = [], marks?: MarkSet): this {
    const ins: Inline[] = typeof insert === 'string' ? (insert ? [marks && Object.keys(marks).length ? { text: insert, marks } : { text: insert }] : []) : insert;
    if (from === to && !contentLength(ins)) return this;
    return this.step({ t: 'text', id, from, to, insert: ins });
  }
  /** Shallow-merge attrs. `undefined` values delete keys. */
  setAttrs(id: string, patch: Attrs): this {
    const b = this.doc.get(id);
    if (!b) return this;
    const next: Attrs = { ...b.attrs };
    for (const k in patch) {
      if (patch[k] === undefined) delete next[k];
      else next[k] = patch[k];
    }
    if (jsonEq(next, b.attrs)) return this;
    return this.step({ t: 'attrs', id, attrs: next });
  }
  /** Change the type of a block within the same kind. Attrs are reset to the new type's defaults plus `attrs`. */
  setType(id: string, type: string, attrs?: Attrs, keep: string[] = ['align', 'indent', 'dir']): this {
    const b = this.doc.get(id);
    if (!b) return this;
    const next = this.schema.defaults(type, attrs);
    for (const k of keep) if (b.attrs[k] !== undefined && next[k] === undefined && this.schema.node(type)?.attrs?.[k]) next[k] = b.attrs[k];
    if (b.type === type && jsonEq(next, b.attrs)) return this;
    return this.step({ t: 'attrs', id, type, attrs: next });
  }
  insert(parentId: string, index: number, blocks: BlockJSON[]): this {
    if (!blocks.length) return this;
    return this.step({ t: 'insert', parent: parentId, index, blocks });
  }
  insertAfter(id: string, blocks: BlockJSON[]): this {
    const b = this.doc.get(id);
    if (!b || !b.parent) return this;
    return this.insert(b.parent.id, b.index + 1, blocks);
  }
  insertBefore(id: string, blocks: BlockJSON[]): this {
    const b = this.doc.get(id);
    if (!b || !b.parent) return this;
    return this.insert(b.parent.id, b.index, blocks);
  }
  remove(id: string): this {
    const b = this.doc.get(id);
    if (!b || !b.parent) return this;
    return this.step({ t: 'remove', parent: b.parent.id, index: b.index, count: 1 });
  }
  removeAt(parentId: string, index: number, count = 1): this {
    if (count <= 0) return this;
    return this.step({ t: 'remove', parent: parentId, index, count });
  }
  /**
   * Move blocks (with their subtrees) to `parentId` at `index`, where `index` refers to the
   * child list before the move. Returns false (and does nothing) for invalid moves such as
   * moving a block into itself or one of its descendants.
   */
  move(ids: string[], parentId: string, index: number): boolean {
    const doc = this.doc;
    const target = doc.get(parentId);
    if (!target) return false;
    const blocks = ids.map((id) => doc.get(id)).filter((b): b is Block => !!b && b !== doc.root);
    if (!blocks.length) return false;
    for (const b of blocks) {
      if (b === target || doc.isAncestor(b, target)) return false;
      if (b.type !== 'unknown' && !this.schema.canContain(target, b.type)) return false;
    }
    const json = blocks.map((b) => b.toJSON());
    // remove back to front so earlier indices stay valid; adjust target index
    const sorted = [...blocks].sort((a, b) => doc.compare(b, a));
    for (const b of sorted) {
      if (b.parent === target && b.index < index) index--;
      this.remove(b.id);
    }
    const t2 = doc.get(parentId);
    if (!t2) return false;
    this.insert(parentId, Math.max(0, Math.min(index, t2.children?.length ?? 0)), json);
    return true;
  }
  /** Replace a block by other blocks (may be of a different kind). */
  replaceBlock(id: string, blocks: BlockJSON[]): this {
    const b = this.doc.get(id);
    if (!b || !b.parent) return this;
    const parent = b.parent.id;
    const index = b.index;
    this.removeAt(parent, index, 1);
    return this.insert(parent, index, blocks);
  }
  select(sel: Selection | null): this {
    this.selection = sel;
    return this;
  }
  setMeta(key: string, value: any): this {
    this.meta[key] = value;
    return this;
  }
  scroll(): this {
    this.scrollIntoView = true;
    return this;
  }
}

interface HistoryEntry {
  /** steps that undo the entry, already in application order */
  undo: Step[];
  redo: Step[];
  before: Selection | null;
  after: Selection | null;
  group?: string;
  time: number;
}

export interface HistoryProvider {
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  clear?(): void;
  /** start a new undo entry at the next change */
  cut?(): void;
}

class History implements HistoryProvider {
  undoStack: HistoryEntry[] = [];
  redoStack: HistoryEntry[] = [];
  private cutNext = false;
  constructor(
    private editor: Editor,
    private delay: number,
    private depth: number,
  ) {}
  record(tr: Transaction, group: string | undefined, after: Selection | null): void {
    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];
    const undo = [...tr.inverse].reverse();
    if (last && group && last.group === group && !this.cutNext && now - last.time < this.delay && selEq(last.after, tr.selectionBefore)) {
      last.undo = [...undo, ...last.undo];
      last.redo.push(...tr.steps);
      last.after = after;
      last.time = now;
    } else {
      this.undoStack.push({ undo, redo: [...tr.steps], before: tr.selectionBefore, after, group, time: now });
      if (this.undoStack.length > this.depth) this.undoStack.shift();
    }
    this.cutNext = false;
    this.redoStack.length = 0;
  }
  /** Force the next recorded transaction to start a new undo entry. */
  cut(): void {
    this.cutNext = true;
  }
  private run(from: HistoryEntry[], to: HistoryEntry[], dir: 'undo' | 'redo'): boolean {
    const e = from.pop();
    if (!e) return false;
    const ok = this.editor.update(
      (tr) => {
        for (const s of dir === 'undo' ? e.undo : e.redo) tr.step(clone(s));
        tr.select(dir === 'undo' ? e.before : e.after);
        tr.scroll();
      },
      { history: false, origin: 'history' },
    );
    if (!ok) return false; // entry no longer applies; drop it
    to.push(e);
    return true;
  }
  undo(): boolean {
    this.cutNext = true;
    return this.run(this.undoStack, this.redoStack, 'undo');
  }
  redo(): boolean {
    return this.run(this.redoStack, this.undoStack, 'redo');
  }
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

type Listener = (payload: any) => void;

/**
 * The headless editor: document, selection, history, commands and extensions.
 * It has no DOM dependency; `EditorView` renders it in a browser.
 */
export class Editor {
  readonly schema: Schema;
  doc!: Doc;
  selection: Selection | null = null;
  /** marks applied to the next typed text (set by toggling a mark with a collapsed selection) */
  storedMarks: MarkSet | null = null;
  mode: EditorMode;
  readOnly: boolean;
  readonly options: EditorOptions;
  readonly commands: CommandMap = {} as CommandMap;
  readonly extensions: Extension[];
  readonly inputRules: InputRule[];
  readonly pasteRules: PasteRule[];
  readonly keymaps: { key: string; run: (editor: Editor, event?: any) => boolean; priority: number; ext: string }[];
  readonly toolbarItems: ToolbarItem[];
  readonly slashItems: SlashItem[];
  readonly blockActions: BlockAction[];
  readonly typeaheads: TypeaheadSource[];
  labels: Record<string, string>;
  /** return false to reject a transaction (it is rolled back) */
  readonly filters: ((tr: Transaction) => boolean)[] = [];
  /** run inside every local transaction before commit; may add steps */
  readonly appenders: ((tr: Transaction) => void)[] = [];
  /** attached view, if any (set by EditorView) */
  view: any = null;
  /** free-form per-extension storage */
  readonly storage: Record<string, any> = {};
  history: HistoryProvider;
  destroyed = false;
  /** incremented on every committed transaction that changed the document */
  revision = 0;
  private listeners = new Map<string, Set<Listener>>();
  private tr: Transaction | null = null;
  private cleanups: (() => void)[] = [];
  private resolved: ResolvedExtensions;
  private builtinHistory: History | null = null;
  private idGen: (() => string) | null = null;
  private activeBlock: string | null = null;

  constructor(options: EditorOptions = {}) {
    this.options = options;
    this.mode = options.mode ?? 'classic';
    this.readOnly = !!options.readOnly;
    this.schema = new Schema();
    if (options.idGenerator) {
      const user = options.idGenerator;
      let warned = false;
      this.idGen = () => {
        for (let i = 0; i < 5; i++) {
          let id: string;
          try {
            id = String(user());
          } catch {
            break;
          }
          if (BLOCK_ID.test(id) && !this.doc?.has(id)) return id;
        }
        if (!warned) console.warn('[zeditor] idGenerator returned an invalid or duplicate id; using a generated one');
        warned = true;
        return globalId();
      };
      this.schema.idGenerator = this.idGen;
    }
    const r = (this.resolved = resolveExtensions([...(options.baseExtensions ?? []), ...(options.extensions ?? [])], this.schema));
    this.extensions = r.extensions;
    this.inputRules = r.inputRules;
    this.pasteRules = r.pasteRules;
    this.keymaps = r.keymaps;
    this.toolbarItems = r.toolbar;
    this.slashItems = r.slashItems;
    this.blockActions = r.blockActions;
    this.typeaheads = r.typeaheads;
    this.labels = { ...r.labels, ...(options.labels ?? {}) };
    for (const name in r.commands) {
      const fn = r.commands[name];
      (this.commands as any)[name] = (...args: any[]) => {
        if (this.destroyed) return false;
        return withIdGenerator(this.idGen, () => fn(this, ...args));
      };
    }
    if (options.history === false) this.history = { undo: () => false, redo: () => false, canUndo: () => false, canRedo: () => false };
    else this.history = this.builtinHistory = new History(this, options.history?.delay ?? 600, options.history?.depth ?? 500);
    withIdGenerator(this.idGen, () => this.load(options.content ?? null));
    const s0 = this.selection;
    this.activeBlock = s0?.type === 'text' ? s0.focus.id : null;
    for (const ext of this.extensions) {
      const c = ext.setup?.(this);
      if (typeof c === 'function') this.cleanups.push(c);
    }
  }

  /* ------------------------------------------------------------ events */

  on<K extends keyof EditorEvents>(event: K, fn: (payload: EditorEvents[K]) => void): () => void {
    let set = this.listeners.get(event as string);
    if (!set) this.listeners.set(event as string, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }
  emit<K extends keyof EditorEvents>(event: K, payload?: EditorEvents[K]): void {
    const set = this.listeners.get(event as string);
    if (set) for (const fn of [...set]) fn(payload);
  }
  /** whether anything listens to `event` (UI parts use it to detect a missing handler) */
  hasListener(event: string): boolean {
    return !!this.listeners.get(event)?.size;
  }
  /** number of registered listeners (for leak tests) */
  listenerCount(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
  /** Register a cleanup to run on destroy. */
  onDestroy(fn: () => void): void {
    this.cleanups.push(fn);
  }

  /* ------------------------------------------------------------ document */

  private load(content: unknown): string[] {
    const { blocks, issues } = this.schema.parse(content);
    this.doc = new Doc(blocks);
    const t = firstTextBlock(this.doc, this.schema);
    this.selection = t ? textSel(t.id, 0) : null;
    return issues;
  }
  getJSON(): DocJSON {
    return this.schema.serialize(this.doc);
  }
  /**
   * Replace the whole document. By default this resets history (loading a file);
   * pass `{ history: true }` to make the replacement an undoable edit.
   */
  setJSON(content: unknown, opts: { history?: boolean; origin?: string } = {}): string[] {
    const { blocks, issues } = this.schema.parse(content);
    const json = blocks.map((b) => b.toJSON());
    this.update(
      (tr) => {
        tr.removeAt('root', 0, this.doc.blocks.length);
        tr.insert('root', 0, json);
        const t = firstTextBlock(this.doc, this.schema);
        tr.select(t ? textSel(t.id, 0) : null);
        tr.setMeta('replaceAll', true);
      },
      { history: !!opts.history, origin: opts.origin ?? 'load' },
    );
    if (!opts.history) this.history.clear?.();
    if (issues.length) this.emit('issues', { issues });
    return issues;
  }
  /** Issues found while validating the given JSON, without loading it. */
  validate(content: unknown): string[] {
    return this.schema.parse(content).issues;
  }
  get isEmpty(): boolean {
    const b = this.doc.blocks;
    return b.length === 1 && this.schema.isText(b[0]) && b[0].length === 0 && !b[0].children;
  }

  /* ------------------------------------------------------------ transactions */

  /**
   * Run `fn` against a transaction and commit it. Nested calls join the outer transaction.
   * Returns false when the transaction was rejected or threw (the document is rolled back).
   */
  update(fn: (tr: Transaction) => void, opts: UpdateOptions = {}): boolean {
    if (this.destroyed) return false;
    if (this.tr) {
      fn(this.tr);
      return true;
    }
    return withIdGenerator(this.idGen, () => this.commit(fn, opts));
  }
  private hasListeners(names: readonly string[]): boolean {
    for (const n of names) if (this.listeners.get(n)?.size) return true;
    return false;
  }
  private emitBlockEvents(tr: Transaction, origin: string): void {
    if (!this.hasListeners(BLOCK_EVENTS)) return;
    const c = summarizeTransaction(tr.steps, tr.inverse, this.doc, origin);
    if (!c.created.length && !c.updated.length && !c.deleted.length && !c.moved.length) return;
    this.emit('blocks', c);
    for (const x of c.created) this.emit('block:created', { ...x, origin });
    for (const x of c.updated) this.emit('block:updated', { ...x, origin });
    for (const x of c.deleted) this.emit('block:deleted', { ...x, origin });
    for (const x of c.moved) this.emit('block:moved', { ...x, origin });
    for (const x of c.completed) this.emit('block:completed', { ...x, origin });
    for (const x of c.uncompleted) this.emit('block:uncompleted', { ...x, origin });
  }
  private emitFocus(): void {
    const s = this.selection;
    const id = s?.type === 'text' ? s.focus.id : s?.type === 'block' ? (s.ids[0] ?? null) : s?.type === 'cell' ? s.focus : null;
    if (id === this.activeBlock) return;
    const previous = this.activeBlock;
    this.activeBlock = id;
    this.emit('block:focus', { id, previous });
  }
  /** id of the block holding the caret (or the first selected block) */
  get activeBlockId(): string | null {
    return this.activeBlock;
  }
  private commit(fn: (tr: Transaction) => void, opts: UpdateOptions): boolean {
    const tr = (this.tr = new Transaction(this));
    const origin = opts.origin ?? 'local';
    tr.meta.origin = origin;
    tr.meta.addToHistory = opts.history !== false;
    let ok = true;
    let error: unknown;
    try {
      fn(tr);
      if (tr.docChanged) {
        this.normalize(tr);
        if (origin === 'local') for (const a of this.appenders) a(tr);
        if (origin === 'local' || origin === 'paste') for (const f of this.filters) if (!f(tr)) ok = false;
      }
    } catch (e) {
      ok = false;
      error = e;
    }
    if (!ok) {
      for (let i = tr.inverse.length - 1; i >= 0; i--) applyStep(this.doc, tr.inverse[i]);
      this.tr = null;
      if (error) {
        if (opts.origin === 'history') return false;
        throw error;
      }
      this.emit('rejected', { tr });
      return false;
    }
    this.tr = null;
    const prevSel = this.selection;
    // a change the user did not make (another author, the server): see mapSelection
    const foreign = origin === 'remote' || tr.meta.foreign === true;
    const next = tr.selection !== undefined ? fixSelection(tr.selection, this.doc, this.schema) : mapSelection(prevSel, tr.steps, this.doc, this.schema, foreign);
    this.selection = next;
    const selectionChanged = !selEq(prevSel, next);
    const docChanged = tr.docChanged;
    if (!docChanged && !selectionChanged && !tr.meta.force) return true;
    // someone else's edit must not drop the formatting the user armed for their next character,
    // as long as their caret is still a caret in the same block
    const caretIn = (s: Selection | null) => (s?.type === 'text' && s.anchor.id === s.focus.id && s.anchor.offset === s.focus.offset ? s.anchor.id : null);
    const keepStored = foreign && caretIn(prevSel) !== null && caretIn(prevSel) === caretIn(next);
    if (tr.meta.storedMarks !== undefined) this.storedMarks = tr.meta.storedMarks;
    else if ((selectionChanged || docChanged) && !keepStored) this.storedMarks = null;
    if (docChanged) {
      this.revision++;
      if (opts.history !== false && tr.meta.history !== false && this.builtinHistory && this.history === this.builtinHistory)
        this.builtinHistory.record(tr, opts.group ?? tr.meta.group, next);
    }
    const ev: TransactionEvent = { tr, docChanged, selectionChanged, origin };
    this.emit('transaction', ev);
    if (docChanged) {
      this.emit('change', ev);
      this.emitBlockEvents(tr, origin);
    }
    if (selectionChanged) {
      this.emit('selection', { selection: next });
      this.emitFocus();
    }
    this.emit('update');
    return true;
  }

  /**
   * Rename blocks, e.g. to the ids your backend assigned after saving them.
   * References to the old ids inside other blocks (relations, synced copies, sub-page parents,
   * page links) are updated too, and so are the undo / redo history and the selection.
   * The rename is not an undo step. Returns false (and changes nothing) when a new id is
   * invalid, already used, or an old id does not exist.
   */
  remapIds(map: Record<string, string>): boolean {
    const pairs = Object.entries(map).filter(([a, b]) => a !== b);
    if (!pairs.length) return true;
    const targets = new Set<string>();
    for (const [from, to] of pairs) {
      if (from === 'root' || !this.doc.has(from) || !BLOCK_ID.test(to) || targets.has(to) || (this.doc.has(to) && !map[to])) return false;
      targets.add(to);
    }
    const m = new Map(pairs);
    const swap = (x: any): any => {
      if (typeof x === 'string') return m.get(x) ?? x;
      if (Array.isArray(x)) return x.map(swap);
      if (x && typeof x === 'object') {
        const o: any = {};
        for (const k in x) o[k] = k === 'text' ? x[k] : swap(x[k]);
        return o;
      }
      return x;
    };
    const renameJSON = (j: BlockJSON): BlockJSON => ({ ...swap({ ...j, children: undefined, content: undefined }), ...(j.content ? { content: swap(j.content) } : {}), ...(j.children ? { children: j.children.map(renameJSON) } : {}) });
    // topmost renamed blocks are replaced (with their subtree); other blocks only get their
    // references rewritten
    const renamedTop = [...m.keys()].filter((id) => {
      for (let p = this.doc.get(id)!.parent; p && p.id !== 'root'; p = p.parent) if (m.has(p.id)) return false;
      return true;
    });
    const inside = (b: Block) => {
      for (let p: Block | null = b; p && p.id !== 'root'; p = p.parent) if (renamedTop.includes(p.id)) return true;
      return false;
    };
    const selection = swap(this.selection);
    const ok = this.update(
      (tr) => {
        for (const b of this.doc.descendants()) {
          if (inside(b)) continue;
          const a = swap(b.attrs);
          if (JSON.stringify(a) !== JSON.stringify(b.attrs)) tr.step({ t: 'attrs', id: b.id, attrs: a });
          if (b.content) {
            const c = swap(b.content);
            if (JSON.stringify(c) !== JSON.stringify(b.content)) tr.step({ t: 'text', id: b.id, from: 0, to: contentLength(b.content), insert: c });
          }
        }
        for (const id of renamedTop) {
          const b = this.doc.get(id)!;
          const parent = b.parent!.id;
          const index = b.parent!.children!.indexOf(b);
          const json = renameJSON(b.toJSON());
          tr.removeAt(parent, index, 1);
          tr.insert(parent, index, [json]);
        }
        tr.select(selection);
        tr.setMeta('remap', map);
      },
      { history: false, origin: 'remap' },
    );
    if (!ok) return false;
    const h = this.builtinHistory;
    if (h) {
      h.undoStack = swap(h.undoStack).map((e: any, i: number) => ({ ...e, time: h.undoStack[i].time }));
      h.redoStack = swap(h.redoStack).map((e: any, i: number) => ({ ...e, time: h.redoStack[i].time }));
    }
    if (this.activeBlock && m.has(this.activeBlock)) this.activeBlock = m.get(this.activeBlock)!;
    this.emit('ids:remapped', { map: Object.fromEntries(pairs) });
    return true;
  }

  /** Keep structural invariants: non-empty root and containers. */
  private normalize(tr: Transaction): void {
    const doc = this.doc;
    for (let guard = 0; guard < 4; guard++) {
      let changed = false;
      for (const id of [...tr.dirty]) {
        const b = doc.get(id);
        if (!b) continue;
        if (b === doc.root) {
          if (!b.children!.length) {
            tr.insert('root', 0, [this.schema.create('paragraph')]);
            changed = true;
          }
          continue;
        }
        const spec = this.schema.node(b.type);
        if (spec?.kind === 'container' && !spec.allowEmpty && (!b.children || !b.children.length)) {
          tr.insert(b.id, 0, [this.schema.create(this.schema.defaultChild(spec))]);
          changed = true;
        }
      }
      for (const n of this.resolved.normalizers) if (n(tr) === true) changed = true;
      if (!changed) break;
    }
  }

  setSelection(sel: Selection | null, opts: { scroll?: boolean } = {}): void {
    this.update((tr) => {
      tr.select(sel);
      if (opts.scroll) tr.scroll();
    });
  }
  /** Start a new undo entry at the next change. */
  cutHistory(): void {
    this.history.cut?.();
  }
  undo(): boolean {
    return this.history.undo();
  }
  redo(): boolean {
    return this.history.redo();
  }
  canUndo(): boolean {
    return this.history.canUndo();
  }
  canRedo(): boolean {
    return this.history.canRedo();
  }

  /* ------------------------------------------------------------ state */

  /** Switch editing mode. Not a document change: no undo entry, selection and scroll are kept. */
  setMode(mode: EditorMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // no entry is added, but edits made before and after the switch do not merge into one
    this.cutHistory();
    this.emit('mode', { mode });
    this.emit('update');
  }
  setReadOnly(readOnly: boolean): void {
    if (readOnly === this.readOnly) return;
    this.readOnly = readOnly;
    this.emit('readonly', { readOnly });
    this.emit('update');
  }
  setStoredMarks(marks: MarkSet | null): void {
    this.storedMarks = marks;
    this.emit('update');
  }
  /** Run a command by name. Unknown names return false. */
  exec(name: string, ...args: any[]): boolean {
    const c = (this.commands as any)[name];
    return typeof c === 'function' ? !!c(...args) : false;
  }
  label(key: string, fallback?: string): string {
    return this.labels[key] ?? fallback ?? key;
  }
  focus(): void {
    this.view?.focus();
  }
  hasExtension(name: string): boolean {
    return this.extensions.some((e) => e.name === name);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.emit('destroy');
    for (const c of this.cleanups.reverse()) {
      try {
        c();
      } catch {
        /* ignore */
      }
    }
    this.cleanups = [];
    this.destroyed = true;
    this.listeners.clear();
    this.filters.length = 0;
    this.appenders.length = 0;
  }
}

export { setIdGenerator };
