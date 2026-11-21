/**
 * EditorView: renders an Editor into a contenteditable element and translates native input
 * into commands. Rendering is incremental: only blocks touched by a transaction are patched,
 * and text nodes are left alone when they already hold the right text (native typing, IME).
 */
import { Block, jsonEq, sliceInline } from '../core/model';
import type { Editor, TransactionEvent } from '../core/editor';
import { Point, Selection, isCollapsed, selEq, selRange, textSel, blockSel, firstTextBlock, lastTextBlock, topMost } from '../core/selection';
import { deleteRange, typingMarks, runInputRules, isoAncestor } from '../core/commands';
import { copyPayload, cutPayload, pasteData, MIME } from '../core/clipboard';
import { activePage, getPages } from '../core/builtin';
import { findCell, findTable, cellsInSelection } from '../core/table';
import {
  InlineRenderer,
  InlineState,
  MarkRenderer,
  NodeRenderer,
  NodeViewHandle,
  RenderContext,
  defaultAtomRenderer,
  defaultContainerRenderer,
  defaultTextRenderer,
  domFromOffset,
  inlineRenderers,
  markRenderers,
  nodeRenderers,
  offsetFromDOM,
  patchInline,
  readDOMText,
  inlinePrompt,
} from './render';
import { h, keyName } from './dom';

export interface ViewOptions {
  /** host overrides for block rendering, by node type */
  renderers?: Record<string, NodeRenderer>;
  inlineRenderers?: Record<string, InlineRenderer>;
  markRenderers?: Record<string, MarkRenderer>;
  placeholder?: string;
  spellcheck?: boolean;
  autofocus?: boolean;
  ariaLabel?: string;
  /** 'tabs' shows one page at a time, 'paged' shows all pages as sheets */
  pageView?: 'tabs' | 'paged';
}

interface BlockView {
  id: string;
  type: string;
  block: Block;
  attrs: any;
  content: any;
  handle: NodeViewHandle;
  inline: InlineState | null;
  childIds: string[];
  ownsChildren: boolean;
}

export interface HighlightRange {
  id: string;
  from: number;
  to: number;
}
export type HighlightSource = () => Record<string, HighlightRange[]>;

/** number of blocks above which off-screen rendering is skipped (content-visibility) */
const LARGE_DOC = 400;

const HAS_HIGHLIGHTS = typeof CSS !== 'undefined' && !!(CSS as any).highlights && typeof (globalThis as any).Highlight === 'function';

export class EditorView {
  readonly root: HTMLElement;
  readonly ctx: RenderContext;
  composing = false;
  pageView: 'tabs' | 'paged';
  private views = new Map<string, BlockView>();
  private contentMap = new WeakMap<Node, BlockView>();
  private rootView: BlockView;
  private orphans = new Set<string>();
  private offs: (() => void)[] = [];
  private lastDOMSel: { an: Node | null; ao: number; fn: Node | null; fo: number } | null = null;
  private selected: HTMLElement[] = [];
  private markR: Record<string, MarkRenderer>;
  private inlineR: Record<string, InlineRenderer>;
  private highlightSources = new Map<string, HighlightSource>();
  private highlightNames = new Set<string>();
  private highlightTimer: any = null;
  private overlay: HTMLElement | null = null;
  private composeBlock: string | null = null;
  private dragCell: { table: string; anchor: string } | null = null;
  private destroyed = false;
  private suppressSelection = 0;
  private escapeArmed = false;
  private large = false;
  private scrollTimer: any = 0;

  constructor(
    readonly editor: Editor,
    mount: HTMLElement,
    readonly options: ViewOptions = {},
  ) {
    this.pageView = options.pageView ?? 'tabs';
    this.markR = { ...markRenderers, ...(options.markRenderers ?? {}) };
    this.inlineR = { ...inlineRenderers, ...(options.inlineRenderers ?? {}) };
    this.root = mount;
    this.ctx = { editor, view: this, label: (k, f) => editor.label(k, f) };
    const r = this.root;
    r.classList.add('z-root');
    r.setAttribute('role', 'textbox');
    r.setAttribute('aria-multiline', 'true');
    r.setAttribute('aria-label', options.ariaLabel ?? editor.label('editor'));
    r.setAttribute('translate', 'no');
    r.spellcheck = options.spellcheck !== false;
    r.textContent = '';
    this.rootView = { id: 'root', type: 'doc', block: editor.doc.root, attrs: null, content: null, handle: { dom: r, childrenDOM: r }, inline: null, childIds: [], ownsChildren: false };
    editor.view = this;
    this.applyEditable();
    this.reconcileChildren(this.rootView, editor.doc.root);
    this.applyPages();
    this.updateSelectionClasses();
    this.updateEmpty();
    this.bind();
    if (options.autofocus) this.focus();
  }

  /* ------------------------------------------------------------------ public helpers */

  hasFocus(): boolean {
    const a = this.root.ownerDocument.activeElement;
    return !!a && (a === this.root || this.root.contains(a));
  }
  focus(): void {
    if (this.destroyed) return;
    if (!this.hasFocus()) this.root.focus({ preventScroll: true });
    this.syncSelectionToDOM(true);
  }
  /** outer DOM element of a block */
  domOf(id: string): HTMLElement | null {
    return this.views.get(id)?.handle.dom ?? null;
  }
  contentOf(id: string): HTMLElement | null {
    return this.views.get(id)?.handle.contentDOM ?? null;
  }
  /** id of the closest block containing a DOM node */
  blockIdAt(node: Node | null): string | null {
    for (let n: Node | null = node; n && n !== this.root; n = n.parentNode) {
      const id = (n as HTMLElement).dataset?.zid;
      if (id && this.views.has(id)) return id;
    }
    return null;
  }
  setRenderer(type: string, renderer: NodeRenderer | null): void {
    const opts = this.options as ViewOptions;
    opts.renderers = { ...(opts.renderers ?? {}) };
    if (renderer) opts.renderers[type] = renderer;
    else delete opts.renderers[type];
    for (const v of [...this.views.values()]) if (v.type === type) this.replace(v, v.block);
  }
  /** Re-render one block from scratch (used by host-rendered node views). */
  refresh(id: string): void {
    const v = this.views.get(id);
    if (v) this.replace(v, v.block);
  }
  setPageView(mode: 'tabs' | 'paged'): void {
    this.pageView = mode;
    this.applyPages();
    this.editor.emit('update');
  }

  /* ------------------------------------------------------------------ rendering */

  private rendererFor(block: Block): NodeRenderer {
    const spec = this.editor.schema.node(block.type);
    return (
      this.options.renderers?.[block.type] ??
      (spec?.render as NodeRenderer | undefined) ??
      nodeRenderers[block.type] ??
      (spec?.kind === 'text' ? defaultTextRenderer : spec?.kind === 'container' ? defaultContainerRenderer : spec ? defaultAtomRenderer : nodeRenderers.unknown)
    );
  }

  private create(block: Block): BlockView {
    let handle: NodeViewHandle;
    try {
      handle = this.rendererFor(block)(block, this.ctx);
    } catch (err) {
      // a failing host renderer must not take the editor down
      console.error('[zeditor] renderer for "' + block.type + '" failed', err);
      const spec = this.editor.schema.node(block.type);
      handle = (spec?.kind === 'text' ? defaultTextRenderer : spec?.kind === 'container' ? defaultContainerRenderer : defaultAtomRenderer)(block, this.ctx);
    }
    const dom = handle.dom;
    dom.dataset.zid = block.id;
    dom.dataset.type = block.type;
    dom.classList.add('z-block');
    const view: BlockView = { id: block.id, type: block.type, block, attrs: block.attrs, content: undefined, handle, inline: null, childIds: [], ownsChildren: false };
    this.views.set(block.id, view);
    if (handle.contentDOM && block.content) {
      view.inline = { leaves: [], trailer: null };
      this.contentMap.set(handle.contentDOM, view);
      this.renderInline(view, block, true);
    }
    this.reconcileChildren(view, block);
    return view;
  }

  private renderInline(view: BlockView, block: Block, force = false): void {
    const el = view.handle.contentDOM!;
    if (this.composing && !force && view.id === this.composeBlock && readDOMText(el) === block.text) {
      // An IME is composing in this block and the DOM already shows the model's text.
      // Replacing or re-wrapping its text node now would abort the composition, so the DOM
      // is left exactly as the browser made it; it is normalized on compositionend.
      view.content = block.content;
      if (block.content!.length) el.removeAttribute('data-empty');
      return;
    }
    patchInline(el, view.inline!, block.content ?? [], this.ctx, { mark: this.markR, inline: this.inlineR }, force);
    view.content = block.content;
    if (block.content!.length) el.removeAttribute('data-empty');
    else el.setAttribute('data-empty', '');
  }

  private replace(view: BlockView, block: Block): BlockView {
    const oldDom = view.handle.dom;
    const parent = oldDom.parentNode;
    const next = oldDom.nextSibling;
    // detach child block DOM first so the new view can adopt it
    for (const id of view.childIds) this.views.get(id)?.handle.dom.remove();
    try {
      view.handle.destroy?.();
    } catch {
      /* ignore */
    }
    this.views.delete(view.id);
    const nv = this.create(block);
    if (parent) parent.insertBefore(nv.handle.dom, next);
    oldDom.remove();
    for (const cls of ['z-selected', 'z-cell-selected']) if (oldDom.classList.contains(cls)) nv.handle.dom.classList.add(cls);
    return nv;
  }

  /** Bring a view in line with its block (which may be a new object after a move or undo). */
  private sync(view: BlockView, block: Block): BlockView {
    if (view.type !== block.type) return this.replace(view, block);
    if (view.attrs !== block.attrs) {
      if (!jsonEq(view.attrs, block.attrs)) {
        let res: boolean | void = false;
        if (view.handle.update) {
          try {
            res = view.handle.update(block);
          } catch (err) {
            console.error('[zeditor] node view update failed', err);
            res = false;
          }
        }
        if (res === false) return this.replace(view, block);
      }
      view.attrs = block.attrs;
    }
    view.block = block;
    if (view.inline && block.content && view.content !== block.content) this.renderInline(view, block);
    this.reconcileChildren(view, block);
    return view;
  }

  private childrenDOM(view: BlockView): HTMLElement {
    if (view.handle.childrenDOM) return view.handle.childrenDOM;
    const el = h('div', { class: 'z-children' });
    view.handle.dom.append(el);
    view.handle.childrenDOM = el;
    view.ownsChildren = true;
    return el;
  }

  private reconcileChildren(view: BlockView, block: Block): void {
    const kids = block.children ?? [];
    if (!kids.length && !view.handle.childrenDOM) {
      view.childIds = [];
      return;
    }
    // fast path: same children, same objects
    if (kids.length === view.childIds.length) {
      let same = true;
      for (let i = 0; i < kids.length; i++) {
        const cv = this.views.get(kids[i].id);
        if (view.childIds[i] !== kids[i].id || !cv || cv.block !== kids[i]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    const parentDOM = this.childrenDOM(view);
    const ids = new Set<string>();
    for (const k of kids) ids.add(k.id);
    for (const old of view.childIds) if (!ids.has(old)) this.orphans.add(old);
    let cursor: ChildNode | null = parentDOM.firstChild;
    let placed: ChildNode | null = null;
    const skip = () => {
      while (cursor && !(cursor as HTMLElement).dataset?.zid) cursor = cursor.nextSibling;
    };
    for (const kid of kids) {
      let cv = this.views.get(kid.id);
      if (!cv) cv = this.create(kid);
      else if (cv.block !== kid) cv = this.sync(cv, kid);
      // creating / syncing a child may have adopted DOM nodes from this parent (a block that
      // moved into the new child), so the cursor is re-derived from the last placed node
      cursor = placed ? placed.nextSibling : parentDOM.firstChild;
      skip();
      const dom = cv.handle.dom;
      if (cursor !== dom) parentDOM.insertBefore(dom, cursor);
      placed = dom;
    }
    cursor = placed ? placed.nextSibling : parentDOM.firstChild;
    while (cursor) {
      const next: ChildNode | null = cursor.nextSibling;
      const zid = (cursor as HTMLElement).dataset?.zid;
      if (zid && !ids.has(zid)) cursor.remove();
      cursor = next;
    }
    view.childIds = kids.map((k) => k.id);
    if (view.ownsChildren) view.handle.dom.classList.toggle('z-has-children', kids.length > 0);
  }

  private dropOrphans(): void {
    if (!this.orphans.size) return;
    const doc = this.editor.doc;
    const drop = (id: string) => {
      const v = this.views.get(id);
      if (!v || doc.get(id)) return; // still in the document (moved): keep
      for (const c of v.childIds) drop(c);
      try {
        v.handle.destroy?.();
      } catch {
        /* ignore */
      }
      v.handle.dom.remove();
      this.views.delete(id);
    };
    for (const id of this.orphans) drop(id);
    this.orphans.clear();
  }

  private onTransaction = (ev: TransactionEvent): void => {
    if (this.destroyed) return;
    const { tr } = ev;
    const doc = this.editor.doc;
    if (ev.docChanged) {
      if (tr.dirty.has('root')) {
        this.rootView.block = doc.root;
        this.reconcileChildren(this.rootView, doc.root);
      }
      for (const id of tr.dirty) {
        if (id === 'root') continue;
        const block = doc.get(id);
        const view = this.views.get(id);
        if (block && view) this.sync(view, block);
      }
      this.dropOrphans();
      this.updateEmpty();
    }
    this.applyPages();
    this.updateSelectionClasses();
    if (!this.composing || tr.meta.origin === 'history') this.syncSelectionToDOM(tr.meta.focus === true);
    if (tr.scrollIntoView && !this.scrollTimer) {
      const run = () => {
        this.scrollTimer = 0;
        if (!this.destroyed) this.scrollToSelection();
      };
      this.scrollTimer = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 0);
    }
    this.scheduleHighlights();
  };

  private updateEmpty(): void {
    this.root.classList.toggle('z-empty', this.editor.isEmpty);
    // large documents: let the browser skip layout and paint of off-screen blocks
    const large = this.editor.doc.size > LARGE_DOC;
    if (large !== this.large) {
      this.large = large;
      this.root.classList.toggle('z-large', large);
    }
  }

  /** Show only the active page in 'tabs' mode; show all pages as sheets in 'paged' mode. */
  applyPages(): void {
    const pages = getPages(this.editor);
    this.root.classList.toggle('z-paged', pages.length > 0);
    this.root.dataset.pageView = pages.length ? this.pageView : '';
    if (!pages.length) return;
    const active = activePage(this.editor);
    pages.forEach((p, i) => {
      const dom = this.domOf(p.id);
      if (!dom) return;
      const show = this.pageView === 'paged' || p === active;
      dom.hidden = !show;
      dom.dataset.pageNumber = String(i + 1);
      dom.classList.toggle('z-page-active', p === active);
    });
  }

  private applyEditable(): void {
    const ro = this.editor.readOnly;
    this.root.contentEditable = ro ? 'false' : 'true';
    this.root.setAttribute('aria-readonly', String(ro));
    this.root.classList.toggle('z-readonly', ro);
    if (ro) this.root.tabIndex = 0;
  }

  /* ------------------------------------------------------------------ positions */

  pointFromDOM(node: Node | null, offset: number): Point | null {
    if (!node || !this.root.contains(node)) return null;
    for (let cur: Node | null = node; cur && cur !== this.root.parentNode; cur = cur.parentNode) {
      const v = this.contentMap.get(cur);
      if (v && this.views.get(v.id) === v) return { id: v.id, offset: Math.min(offsetFromDOM(cur as HTMLElement, node, offset), v.block.length) };
      if (cur.nodeType === 1 && (cur as HTMLElement).getAttribute('contenteditable') === 'false' && !(cur as HTMLElement).hasAttribute('data-atom') && cur !== this.root) return null;
    }
    // a point between blocks: resolve to the nearest text position
    if (node.nodeType !== 1) return null;
    const el = node as HTMLElement;
    const { doc, schema } = this.editor;
    const at = el.childNodes[offset] as HTMLElement | undefined;
    const before = el.childNodes[offset - 1] as HTMLElement | undefined;
    const resolve = (n: HTMLElement | undefined, end: boolean): Point | null => {
      if (!n || n.nodeType !== 1) return null;
      const id = n.dataset?.zid ?? (n.querySelector?.('[data-zid]') as HTMLElement | null)?.dataset.zid;
      const b = id ? doc.get(id) : null;
      if (!b) return null;
      const t = end ? lastTextBlock(doc, schema, b) : firstTextBlock(doc, schema, b);
      return t ? { id: t.id, offset: end ? t.length : 0 } : null;
    };
    return resolve(at, false) ?? resolve(before, true);
  }

  domFromPoint(p: Point): { node: Node; offset: number } | null {
    const v = this.views.get(p.id);
    if (!v || !v.inline || !v.handle.contentDOM) return null;
    return domFromOffset(v.handle.contentDOM, v.inline, p.offset);
  }

  /** DOM Range for a span of text inside one block. */
  rangeFor(id: string, from: number, to: number): Range | null {
    const a = this.domFromPoint({ id, offset: from });
    const b = this.domFromPoint({ id, offset: to });
    if (!a || !b) return null;
    const r = this.root.ownerDocument.createRange();
    try {
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
    } catch {
      return null;
    }
    return r;
  }

  /** Viewport rectangle of a caret position. */
  coordsAt(p: Point): DOMRect | null {
    const r = this.rangeFor(p.id, p.offset, p.offset);
    if (!r) return null;
    const rects = r.getClientRects();
    if (rects.length) return rects[rects.length - 1];
    // collapsed ranges in empty blocks have no rects: use the content box
    const el = this.contentOf(p.id);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(el).lineHeight) || box.height;
    return new DOMRect(box.left, box.top, 0, Math.min(box.height, lh));
  }

  /** Bounding rectangle of the current selection, for floating UI. */
  selectionRect(): DOMRect | null {
    const sel = this.editor.selection;
    if (!sel) return null;
    if (sel.type === 'text') {
      const s = this.root.ownerDocument.getSelection();
      if (s && s.rangeCount && this.root.contains(s.anchorNode) && !s.isCollapsed) {
        const r = s.getRangeAt(0).getBoundingClientRect();
        if (r.width || r.height) return r;
      }
      return this.coordsAt(sel.focus);
    }
    const id = sel.type === 'block' ? sel.ids[0] : sel.focus;
    return this.domOf(id)?.getBoundingClientRect() ?? null;
  }

  private scrollToSelection(): void {
    const sel = this.editor.selection;
    if (!sel || !this.hasFocus()) return;
    const blockDom = this.domOf(sel.type === 'text' ? sel.focus.id : sel.type === 'block' ? sel.ids[sel.ids.length - 1] : sel.focus);
    let rect = sel.type === 'text' ? this.coordsAt(sel.focus) : blockDom?.getBoundingClientRect();
    if (blockDom && (!rect || (!rect.height && !rect.width))) {
      // the block is not rendered yet (off-screen in a large document): bring it in first
      blockDom.scrollIntoView({ block: 'center' });
      rect = sel.type === 'text' ? this.coordsAt(sel.focus) : blockDom.getBoundingClientRect();
    }
    if (!rect) return;
    // find the scroll container
    let sc: HTMLElement | null = this.root;
    while (sc && sc !== document.body) {
      const st = getComputedStyle(sc);
      if (/(auto|scroll)/.test(st.overflowY) && sc.scrollHeight > sc.clientHeight) break;
      sc = sc.parentElement;
    }
    const pad = 24;
    if (sc && sc !== document.body && sc !== document.documentElement) {
      const box = sc.getBoundingClientRect();
      if (rect.top < box.top + pad) sc.scrollTop -= box.top + pad - rect.top;
      else if (rect.bottom > box.bottom - pad) sc.scrollTop += rect.bottom - (box.bottom - pad);
    }
    const vh = window.innerHeight;
    const r2 = sel.type === 'text' ? this.coordsAt(sel.focus) ?? rect : rect;
    if (r2.top < pad) window.scrollBy(0, r2.top - pad);
    else if (r2.bottom > vh - pad) window.scrollBy(0, r2.bottom - (vh - pad));
  }

  /* ------------------------------------------------------------------ selection sync */

  selectionFromDOM(): Selection | null {
    const s = this.root.ownerDocument.getSelection();
    if (!s || !s.rangeCount || !s.anchorNode || !this.root.contains(s.anchorNode)) return null;
    const a = this.pointFromDOM(s.anchorNode, s.anchorOffset);
    const f = s.isCollapsed ? a : this.pointFromDOM(s.focusNode, s.focusOffset);
    if (!a || !f) return null;
    if (a.id !== f.id) {
      const { doc } = this.editor;
      const ca = findCell(this.editor, doc.get(a.id));
      const cf = findCell(this.editor, doc.get(f.id));
      if (ca && cf && ca !== cf) {
        const ta = findTable(this.editor, ca);
        if (ta && ta === findTable(this.editor, cf)) return { type: 'cell', table: ta.id, anchor: ca.id, focus: cf.id };
      }
    }
    return { type: 'text', anchor: a, focus: f };
  }

  private onSelectionChange = (): void => {
    if (this.destroyed || this.composing || this.suppressSelection) return;
    const s = this.root.ownerDocument.getSelection();
    if (!s || !s.anchorNode || !this.root.contains(s.anchorNode)) return;
    const l = this.lastDOMSel;
    if (l && l.an === s.anchorNode && l.ao === s.anchorOffset && l.fn === s.focusNode && l.fo === s.focusOffset) return;
    const active = this.root.ownerDocument.activeElement as HTMLElement | null;
    if (active && active !== this.root && this.root.contains(active) && active.closest('[data-z-ignore]')) return;
    const sel = this.selectionFromDOM();
    if (!sel) return;
    this.lastDOMSel = { an: s.anchorNode, ao: s.anchorOffset, fn: s.focusNode, fo: s.focusOffset };
    if (!selEq(sel, this.editor.selection)) {
      this.suppressSelection++;
      try {
        this.editor.update((tr) => {
          tr.select(sel);
          tr.setMeta('fromDOM', true);
        });
      } finally {
        this.suppressSelection--;
      }
    }
  };

  /** Push the model selection into the DOM. Does nothing while the editor is not focused. */
  syncSelectionToDOM(force = false): void {
    if (this.destroyed) return;
    if (!force && !this.hasFocus()) return;
    const active = this.root.ownerDocument.activeElement as HTMLElement | null;
    if (!force && active && active !== this.root && active.closest('[data-z-ignore]')) return;
    const sel = this.editor.selection;
    const ds = this.root.ownerDocument.getSelection();
    if (!sel || !ds) return;
    let a: { node: Node; offset: number } | null = null;
    let f: { node: Node; offset: number } | null = null;
    if (sel.type === 'text') {
      a = this.domFromPoint(sel.anchor);
      f = this.domFromPoint(sel.focus);
    } else {
      // block / cell selections keep a collapsed, hidden caret so key events still arrive
      const id = sel.type === 'block' ? sel.ids[0] : sel.focus;
      const dom = this.domOf(id);
      if (dom?.parentNode) {
        const idx = Array.prototype.indexOf.call(dom.parentNode.childNodes, dom);
        a = f = { node: dom.parentNode, offset: idx };
        if (sel.type === 'cell') {
          const t = firstTextBlock(this.editor.doc, this.editor.schema, this.editor.doc.get(sel.focus)!);
          const p = t && this.domFromPoint({ id: t.id, offset: 0 });
          if (p) a = f = p;
        }
      }
    }
    if (!a || !f) return;
    if (ds.anchorNode === a.node && ds.anchorOffset === a.offset && ds.focusNode === f.node && ds.focusOffset === f.offset) {
      this.lastDOMSel = { an: a.node, ao: a.offset, fn: f.node, fo: f.offset };
      return;
    }
    this.suppressSelection++;
    try {
      ds.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
    } catch {
      /* stale nodes: ignore */
    } finally {
      this.suppressSelection--;
    }
    this.lastDOMSel = { an: ds.anchorNode, ao: ds.anchorOffset, fn: ds.focusNode, fo: ds.focusOffset };
  }

  private updateSelectionClasses(): void {
    for (const el of this.selected) el.classList.remove('z-selected', 'z-cell-selected', 'z-caret-block');
    this.selected = [];
    const sel = this.editor.selection;
    this.root.classList.toggle('z-hide-caret', !!sel && sel.type !== 'text');
    if (sel && sel.type === 'text' && isCollapsed(sel)) {
      const dom = this.domOf(sel.focus.id);
      if (dom) {
        dom.classList.add('z-caret-block');
        this.selected.push(dom);
      }
    }
    if (!sel || sel.type === 'text') return;
    if (sel.type === 'block') {
      for (const id of sel.ids) {
        const dom = this.domOf(id);
        if (dom) {
          dom.classList.add('z-selected');
          this.selected.push(dom);
        }
      }
    } else {
      for (const cell of cellsInSelection(this.editor, sel)) {
        const dom = this.domOf(cell.id);
        if (dom) {
          dom.classList.add('z-cell-selected');
          this.selected.push(dom);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ highlights (find, syntax, presence) */

  /**
   * Register a decoration source. It returns named ranges which are painted with the CSS
   * Custom Highlight API (`::highlight(name)`), so decorations never touch the editable DOM.
   * Where the API is missing, names starting with 'z-find' / 'z-remote' fall back to overlays.
   */
  addHighlightSource(key: string, source: HighlightSource): () => void {
    this.highlightSources.set(key, source);
    this.scheduleHighlights();
    return () => {
      this.highlightSources.delete(key);
      this.scheduleHighlights();
    };
  }
  scheduleHighlights(): void {
    if (!this.highlightSources.size && !this.highlightNames.size) return;
    if (this.highlightTimer) return;
    const run = () => {
      this.highlightTimer = null;
      if (!this.destroyed) this.paintHighlights();
    };
    this.highlightTimer = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16);
  }
  private paintHighlights(): void {
    const all: Record<string, Range[]> = {};
    for (const src of this.highlightSources.values()) {
      let res: Record<string, HighlightRange[]>;
      try {
        res = src();
      } catch {
        continue;
      }
      for (const name in res) {
        const list = (all[name] ??= []);
        for (const r of res[name]) {
          const dom = this.domOf(r.id);
          if (!dom || dom.offsetParent === null) continue;
          const range = this.rangeFor(r.id, r.from, r.to);
          if (range) list.push(range);
        }
      }
    }
    if (HAS_HIGHLIGHTS) {
      const reg = (CSS as any).highlights;
      for (const name of this.highlightNames) if (!all[name]) reg.delete(this.hlName(name));
      for (const name in all) reg.set(this.hlName(name), new (globalThis as any).Highlight(...all[name]));
    } else this.paintOverlay(all);
    this.highlightNames = new Set(Object.keys(all));
  }
  /** highlight names are global: suffix them per editor so several editors can coexist */
  private hlName(name: string): string {
    return name;
  }
  private paintOverlay(all: Record<string, Range[]>): void {
    const host = this.root.parentElement;
    if (!host) return;
    if (!this.overlay) {
      this.overlay = h('div', { class: 'z-highlight-overlay', 'aria-hidden': 'true' });
      host.append(this.overlay);
    }
    this.overlay.textContent = '';
    const base = host.getBoundingClientRect();
    for (const name in all) {
      if (!/^z-(find|remote)/.test(name)) continue;
      for (const range of all[name])
        for (const rect of range.getClientRects()) {
          const d = h('div', { class: 'z-hl ' + name });
          d.style.cssText = `left:${rect.left - base.left + host.scrollLeft}px;top:${rect.top - base.top + host.scrollTop}px;width:${rect.width}px;height:${rect.height}px`;
          this.overlay.append(d);
        }
    }
  }

  /* ------------------------------------------------------------------ events */

  private bind(): void {
    const r = this.root;
    const doc = r.ownerDocument;
    const on = <K extends keyof HTMLElementEventMap>(target: EventTarget, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions | boolean) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.offs.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(doc, 'selectionchange', this.onSelectionChange);
    on(r, 'beforeinput', this.onBeforeInput);
    on(r, 'input', this.onInput);
    on(r, 'compositionstart', this.onCompositionStart);
    on(r, 'compositionend', this.onCompositionEnd);
    on(r, 'keydown', this.onKeyDown);
    on(r, 'copy', this.onCopy);
    on(r, 'cut', this.onCut);
    on(r, 'paste', this.onPaste);
    on(r, 'mousedown', this.onMouseDown);
    on(r, 'click', this.onClick);
    on(r, 'dragstart', (e: DragEvent) => {
      // native text dragging would bypass the model
      if (!(e.target as HTMLElement)?.closest?.('[data-z-drag]')) e.preventDefault();
    });
    on(r, 'dragover', this.onDragOver);
    on(r, 'drop', this.onDrop);
    on(r, 'focus', () => {
      r.classList.add('z-focused');
      this.editor.emit('focus');
    });
    on(r, 'blur', () => {
      r.classList.remove('z-focused');
      this.editor.emit('blur');
    });
    on(doc, 'mouseup', () => {
      this.dragCell = null;
    });
    on(doc, 'mousemove', this.onMouseMove);
    this.offs.push(
      this.editor.on('transaction', this.onTransaction),
      this.editor.on('readonly', () => {
        this.applyEditable();
        for (const v of this.views.values()) if (v.type === 'code' || v.type === 'image') v.handle.update?.(v.block);
      }),
      this.editor.on('mode', () => {
        this.root.dataset.mode = this.editor.mode;
      }),
      this.editor.on('page', () => {
        this.applyPages();
        this.scheduleHighlights();
      }),
    );
    this.root.dataset.mode = this.editor.mode;
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.scheduleHighlights());
      ro.observe(r);
      this.offs.push(() => ro.disconnect());
    }
  }

  private ignored(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && t !== this.root && !!t.closest?.('[data-z-ignore]');
  }

  /** Make the model selection reflect the DOM right now (selectionchange is asynchronous). */
  private flushSelection(): void {
    if (this.composing) return;
    const s = this.root.ownerDocument.getSelection();
    if (!s || !s.anchorNode || !this.root.contains(s.anchorNode)) return;
    const cur = this.editor.selection;
    if (cur && cur.type !== 'text') {
      // the DOM caret of a block / cell selection is a placeholder
      const l = this.lastDOMSel;
      if (l && l.an === s.anchorNode && l.ao === s.anchorOffset && l.fn === s.focusNode && l.fo === s.focusOffset) return;
    }
    this.lastDOMSel = null;
    this.onSelectionChange();
  }

  private onBeforeInput = (e: InputEvent): void => {
    if (this.ignored(e)) return;
    const editor = this.editor;
    if (editor.readOnly) {
      e.preventDefault();
      return;
    }
    // focus is in an embedded control (caption, language select...) but the browser routed an
    // editing command to the editing host: never let it touch the document DOM
    const active = this.root.ownerDocument.activeElement as HTMLElement | null;
    if (active && active !== this.root && this.root.contains(active) && active.closest('[data-z-ignore]')) {
      e.preventDefault();
      return;
    }
    const type = e.inputType;
    if (type === 'insertCompositionText' || type === 'deleteCompositionText' || type === 'insertFromComposition' || this.composing) return; // native, reconciled on input
    this.flushSelection();
    // spellcheck / autocorrect replacements target a range that differs from the selection
    if ((type === 'insertReplacementText' || type === 'insertText') && e.getTargetRanges) {
      const tr = e.getTargetRanges()[0];
      if (tr && type === 'insertReplacementText') {
        const a = this.pointFromDOM(tr.startContainer, tr.startOffset);
        const f = this.pointFromDOM(tr.endContainer, tr.endOffset);
        if (a && f) editor.setSelection({ type: 'text', anchor: a, focus: f });
      }
    }
    const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
    let handled = true;
    switch (type) {
      case 'insertText':
      case 'insertReplacementText':
        if (text.includes('\n') && text.length > 1) pasteData(editor, { text, html: '', files: [] });
        else editor.exec('insertText', text);
        break;
      case 'insertParagraph':
        editor.exec('splitBlock');
        break;
      case 'insertLineBreak':
        editor.exec('insertLineBreak');
        break;
      case 'deleteContentBackward':
        editor.exec('deleteBackward', 'char');
        break;
      case 'deleteContentForward':
        editor.exec('deleteForward', 'char');
        break;
      case 'deleteWordBackward':
        editor.exec('deleteBackward', 'word');
        break;
      case 'deleteWordForward':
        editor.exec('deleteForward', 'word');
        break;
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward':
        editor.exec('deleteBackward', 'line');
        break;
      case 'deleteSoftLineForward':
      case 'deleteHardLineForward':
        editor.exec('deleteForward', 'line');
        break;
      case 'deleteByCut':
      case 'deleteByDrag':
      case 'deleteContent':
        editor.exec('deleteSelection');
        break;
      case 'insertFromPaste':
      case 'insertFromDrop':
      case 'insertFromYank':
        pasteData(editor, { text, html: e.dataTransfer?.getData('text/html') ?? '', files: [] });
        break;
      case 'historyUndo':
        editor.undo();
        break;
      case 'historyRedo':
        editor.redo();
        break;
      case 'formatBold':
        editor.exec('toggleMark', 'bold');
        break;
      case 'formatItalic':
        editor.exec('toggleMark', 'italic');
        break;
      case 'formatUnderline':
        editor.exec('toggleMark', 'underline');
        break;
      case 'formatStrikeThrough':
        editor.exec('toggleMark', 'strike');
        break;
      case 'insertTranspose':
      default:
        // unknown input types fall through to native handling and are reconciled on `input`
        handled = e.cancelable === false ? false : type.startsWith('format') || type.startsWith('insertOrderedList') || type.startsWith('insertUnorderedList') || type === 'insertHorizontalRule' || type === 'insertLink';
        break;
    }
    if (handled) {
      e.preventDefault();
      // if the browser ignored preventDefault (non-cancelable), `input` reconciles
      this.syncSelectionToDOM();
    }
  };

  private onInput = (e: Event): void => {
    if (this.ignored(e)) return;
    // only reached for native edits we did not cancel: composition steps and exotic input types
    this.syncFromDOM();
  };

  private onCompositionStart = (): void => {
    const editor = this.editor;
    if (editor.readOnly) return;
    this.flushSelection();
    const sel = editor.selection;
    // a selection spanning several blocks cannot be replaced natively without the browser
    // restructuring our DOM: delete it through the model before the IME starts inserting
    if (sel && sel.type === 'text' && sel.anchor.id !== sel.focus.id) editor.exec('deleteSelection');
    else if (sel && sel.type !== 'text') editor.exec('insertText', '', { rules: false });
    this.composing = true;
    const s = editor.selection;
    this.composeBlock = s && s.type === 'text' ? s.focus.id : null;
    this.root.classList.add('z-composing');
  };

  private onCompositionEnd = (): void => {
    if (!this.composing) return;
    this.composing = false;
    this.root.classList.remove('z-composing');
    const id = this.composeBlock;
    this.composeBlock = null;
    this.syncFromDOM();
    // normalize whatever the IME left in the DOM, then restore the caret
    const v = id ? this.views.get(id) : null;
    if (v && v.inline && v.block.content) {
      this.renderInline(v, v.block, true);
      this.syncSelectionToDOM();
    }
    runInputRules(this.editor);
  };

  /**
   * Reconcile the model with native DOM edits in the block that holds the DOM selection:
   * the block's DOM text is diffed against the model and the difference applied as one edit.
   */
  private syncFromDOM(): void {
    const editor = this.editor;
    const s = this.root.ownerDocument.getSelection();
    if (!s || !s.anchorNode || editor.readOnly) return;
    let view: BlockView | null = null;
    for (let cur: Node | null = s.anchorNode; cur && cur !== this.root; cur = cur.parentNode) {
      const v = this.contentMap.get(cur);
      if (v && this.views.get(v.id) === v) {
        view = v;
        break;
      }
    }
    if (!view && this.composeBlock) view = this.views.get(this.composeBlock) ?? null;
    if (!view || !view.handle.contentDOM) {
      // the browser edited outside any content element (e.g. deleted across blocks): re-render
      this.rerender();
      return;
    }
    const el = view.handle.contentDOM;
    const block = editor.doc.get(view.id);
    if (!block || !block.content) return;
    const domText = readDOMText(el);
    const modelText = block.text;
    const caret = s.anchorNode && el.contains(s.anchorNode) ? offsetFromDOM(el, s.focusNode ?? s.anchorNode, s.focusNode ? s.focusOffset : s.anchorOffset) : null;
    if (domText === modelText) {
      if (caret != null && !this.composing) {
        const sel = textSel(view.id, Math.min(caret, block.length));
        if (!selEq(sel, editor.selection)) editor.setSelection(sel);
      }
      return;
    }
    // minimal diff, biased so that the change ends at the caret
    let start = 0;
    const max = Math.min(domText.length, modelText.length);
    while (start < max && domText.charCodeAt(start) === modelText.charCodeAt(start)) start++;
    let endD = domText.length;
    let endM = modelText.length;
    while (endD > start && endM > start && domText.charCodeAt(endD - 1) === modelText.charCodeAt(endM - 1)) {
      endD--;
      endM--;
    }
    if (caret != null && caret >= start && caret < endD) {
      // repeated characters make the diff ambiguous: shift it so the insertion ends at the caret
      const shift = endD - caret;
      if (shift > 0 && start - shift >= 0 && domText.slice(start - shift, endD - shift) === domText.slice(start, endD) && endM - shift >= start - shift) {
        /* keep the simple diff: equal text either way */
      }
    }
    // never split a surrogate pair
    const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
    if (start > 0 && isLow(modelText.charCodeAt(start))) start--;
    if (endM < modelText.length && isLow(modelText.charCodeAt(endM))) {
      endM++;
      endD++;
    }
    let inserted = domText.slice(start, endD).replace(/￼/g, '');
    const spec = editor.schema.node(block.type);
    if (!spec?.code) inserted = inserted.replace(/ /g, (m, i) => (domText[start + i + 1] === ' ' || domText[start + i - 1] === ' ' ? m : m));
    const id = view.id;
    editor.update(
      (tr) => {
        const sug = editor.storage.suggest?.active;
        if (sug && endM > start) {
          deleteRange(tr, { id, offset: start }, { id, offset: endM });
          if (inserted) tr.replaceText(id, endM, endM, inserted, { ...(typingMarks(editor, block, endM) ?? {}), suggestion: { id: 's' + Date.now().toString(36), kind: 'insert', author: editor.storage.suggest.author, at: Date.now() } });
        } else {
          let marks = typingMarks(editor, block, start) ?? (endM > start ? sliceInline(block.content, start, start + 1)[0]?.marks : undefined);
          if (sug && inserted) marks = { ...(marks ?? {}), suggestion: { id: 's' + Date.now().toString(36), kind: 'insert', author: editor.storage.suggest.author, at: Date.now() } };
          tr.replaceText(id, start, endM, inserted, marks);
        }
        const b2 = editor.doc.get(id)!;
        tr.select(textSel(id, Math.min(caret ?? start + inserted.length, b2.length)));
        tr.setMeta('fromDOM', true);
      },
      { group: 'type' },
    );
    // if a filter rejected the edit (character limit), the DOM must be reset to the model
    const after = editor.doc.get(id);
    if (after && readDOMText(el) !== after.text && !this.composing) {
      this.renderInline(view, after, true);
      this.syncSelectionToDOM();
    }
  }

  /** Rebuild the whole DOM from the model (recovery path for unexpected native edits). */
  rerender(): void {
    for (const v of this.views.values()) {
      try {
        v.handle.destroy?.();
      } catch {
        /* ignore */
      }
    }
    this.views.clear();
    this.root.textContent = '';
    this.rootView.childIds = [];
    this.reconcileChildren(this.rootView, this.editor.doc.root);
    this.applyPages();
    this.updateSelectionClasses();
    this.syncSelectionToDOM();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.ignored(e)) return;
    if (e.isComposing || e.keyCode === 229 || this.composing) return;
    const editor = this.editor;
    const key = keyName(e);
    // Tab indents, so it cannot move focus. Pressing Escape first releases the next
    // Tab / Shift+Tab to the browser, which moves focus out of the editor.
    const armed = this.escapeArmed;
    // modifier keys on their own (the Shift of Shift+Tab) do not disarm
    if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') this.escapeArmed = key === 'Escape';
    if (armed && (key === 'Tab' || key === 'Shift-Tab')) return;
    if (editor.readOnly) {
      // navigation, copy and select-all stay available
      if (key === 'Mod-a') {
        e.preventDefault();
        editor.exec('selectAll');
      } else if (key === 'Backspace' || key === 'Delete') e.preventDefault(); // some browsers navigate back
      return;
    }
    this.flushSelection();
    for (const k of editor.keymaps) {
      if (k.key !== key) continue;
      let ok = false;
      try {
        ok = k.run(editor, e);
      } catch (err) {
        console.error('[zeditor] shortcut handler failed', err);
      }
      if (ok) {
        e.preventDefault();
        return;
      }
    }
    const sel = editor.selection;
    if (!sel) return;
    if (sel.type !== 'text') {
      if (key === 'Backspace' || key === 'Delete') {
        e.preventDefault();
        editor.exec('deleteSelection');
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        editor.exec('insertText', e.key);
      } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        // leave a block selection sideways into the neighbouring text
        if (sel.type === 'block') {
          const blocks = topMost(editor.doc, sel.ids);
          const b = key === 'ArrowLeft' ? blocks[0] : blocks[blocks.length - 1];
          let n: Block | null = b;
          do n = key === 'ArrowLeft' ? editor.doc.prev(n!) : editor.doc.next(n!, true);
          while (n && !editor.schema.isText(n));
          if (n) {
            e.preventDefault();
            editor.setSelection(textSel(n.id, key === 'ArrowLeft' ? n.length : 0), { scroll: true });
          }
        }
      }
      return;
    }
    // keyboard access to atom blocks (images, dividers...) next to the caret
    if (isCollapsed(sel) && (key === 'ArrowDown' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowLeft')) {
      const b = editor.doc.get(sel.focus.id);
      if (!b) return;
      const fwd = key === 'ArrowDown' || key === 'ArrowRight';
      const atEdge = fwd ? sel.focus.offset === b.length : sel.focus.offset === 0;
      if (!atEdge && (key === 'ArrowLeft' || key === 'ArrowRight')) return;
      if (!atEdge && !this.onEdgeLine(sel.focus, fwd)) return;
      const n = fwd ? editor.doc.next(b) : editor.doc.prev(b);
      if (n && editor.schema.isAtom(n) && isoAncestor(editor, n) === isoAncestor(editor, b)) {
        e.preventDefault();
        editor.setSelection(blockSel([n.id]), { scroll: true });
      }
    }
  };

  /** Is the caret on the first / last visual line of its block? */
  private onEdgeLine(p: Point, last: boolean): boolean {
    const caret = this.coordsAt(p);
    const el = this.contentOf(p.id);
    if (!caret || !el) return true;
    const box = el.getBoundingClientRect();
    return last ? box.bottom - caret.bottom < caret.height * 0.75 : caret.top - box.top < caret.height * 0.75;
  }

  /* ------------------------------------------------------------------ clipboard & drag */

  private onCopy = (e: ClipboardEvent): void => {
    if (this.ignored(e)) return;
    this.flushSelection();
    const p = copyPayload(this.editor);
    if (!p || !e.clipboardData) return;
    e.preventDefault();
    this.writeClipboard(e.clipboardData, p);
  };
  private onCut = (e: ClipboardEvent): void => {
    if (this.ignored(e)) return;
    this.flushSelection();
    const p = this.editor.readOnly ? copyPayload(this.editor) : cutPayload(this.editor);
    if (!p || !e.clipboardData) return;
    e.preventDefault();
    this.writeClipboard(e.clipboardData, p);
  };
  private writeClipboard(dt: DataTransfer, p: { text: string; html: string; json: any }): void {
    dt.setData('text/plain', p.text);
    dt.setData('text/html', p.html);
    try {
      dt.setData(MIME, JSON.stringify(p.json));
    } catch {
      /* custom types unsupported: the payload is also embedded in the HTML */
    }
  }
  private readTransfer(dt: DataTransfer): { text: string; html: string; files: File[]; json?: any } {
    let json: any;
    try {
      const raw = dt.getData(MIME);
      if (raw) json = JSON.parse(raw);
    } catch {
      json = undefined;
    }
    return { text: dt.getData('text/plain'), html: dt.getData('text/html'), files: Array.from(dt.files ?? []), json };
  }
  private onPaste = (e: ClipboardEvent): void => {
    if (this.ignored(e)) return;
    e.preventDefault();
    if (this.editor.readOnly || !e.clipboardData) return;
    this.flushSelection();
    const data = this.readTransfer(e.clipboardData);
    // screenshots and copied files arrive as files without meaningful text
    if (data.files.length && !data.json && (!data.html || /^\s*(<meta[^>]*>)?\s*<img\b[^>]*>\s*$/i.test(data.html))) {
      for (const rule of this.editor.pasteRules) if (rule.run(this.editor, data)) return;
      this.editor.emit('ui:files', { files: data.files, source: 'paste' });
      return;
    }
    pasteData(this.editor, data);
  };
  private onDragOver = (e: DragEvent): void => {
    if (this.editor.readOnly || !e.dataTransfer) return;
    const types = Array.from(e.dataTransfer.types ?? []);
    if (types.includes('Files') || types.includes('text/plain') || types.includes('text/html')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  private onDrop = (e: DragEvent): void => {
    if (this.editor.readOnly || !e.dataTransfer || e.defaultPrevented) return;
    const types = Array.from(e.dataTransfer.types ?? []);
    if (types.includes('application/x-zeditor-drag')) return; // block drag: handled by the block handle UI
    e.preventDefault();
    // move the caret to the drop point
    const d = this.root.ownerDocument as any;
    let node: Node | null = null;
    let offset = 0;
    if (d.caretPositionFromPoint) {
      const cp = d.caretPositionFromPoint(e.clientX, e.clientY);
      if (cp) (node = cp.offsetNode), (offset = cp.offset);
    } else if (d.caretRangeFromPoint) {
      const cr = d.caretRangeFromPoint(e.clientX, e.clientY);
      if (cr) (node = cr.startContainer), (offset = cr.startOffset);
    }
    const p = this.pointFromDOM(node, offset);
    const data = this.readTransfer(e.dataTransfer);
    if (p) this.editor.setSelection(textSel(p.id, p.offset));
    else {
      const id = this.blockIdAt(e.target as Node);
      if (id) this.editor.setSelection(blockSel([id]));
    }
    this.root.focus({ preventScroll: true });
    if (data.files.length) this.editor.emit('ui:files', { files: data.files, source: 'drop' });
    else pasteData(this.editor, data);
  };

  /* ------------------------------------------------------------------ pointer */

  private onMouseDown = (e: MouseEvent): void => {
    this.escapeArmed = false;
    if (this.ignored(e)) return;
    const t = e.target as HTMLElement;
    const editor = this.editor;
    // prevent the caret from landing inside non-editable controls
    if (t.closest('[data-z-check],[data-z-toggle],[data-z-callout-tone]')) {
      e.preventDefault();
      return;
    }
    const cellEl = t.closest('.z-cell') as HTMLElement | null;
    if (cellEl && e.button === 0 && !e.shiftKey) {
      const cell = editor.doc.get(cellEl.dataset.zid ?? '');
      const table = cell && findTable(editor, cell);
      if (cell && table) this.dragCell = { table: table.id, anchor: cell.id };
    }
    // clicking an atom block selects it as a block
    const id = this.blockIdAt(t);
    const b = id ? editor.doc.get(id) : null;
    if (b && editor.schema.isAtom(b) && !t.closest('a[href]')) {
      e.preventDefault();
      if (!this.hasFocus()) this.root.focus({ preventScroll: true });
      if (e.shiftKey && editor.selection?.type === 'block') editor.setSelection({ type: 'block', ids: [...new Set([...editor.selection.ids, b.id])], anchor: editor.selection.anchor });
      else editor.setSelection(blockSel([b.id]));
      this.syncSelectionToDOM(true);
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    const drag = this.dragCell;
    if (!drag || !(e.buttons & 1)) return;
    const el = (e.target as HTMLElement)?.closest?.('.z-cell') as HTMLElement | null;
    if (!el || !this.root.contains(el)) return;
    const cell = this.editor.doc.get(el.dataset.zid ?? '');
    if (!cell || findTable(this.editor, cell)?.id !== drag.table) return;
    const cur = this.editor.selection;
    if (cell.id === drag.anchor && cur?.type !== 'cell') return;
    e.preventDefault();
    const next: Selection = { type: 'cell', table: drag.table, anchor: drag.anchor, focus: cell.id };
    if (!selEq(next, cur)) {
      this.root.ownerDocument.getSelection()?.removeAllRanges();
      this.editor.setSelection(next);
      this.syncSelectionToDOM(true);
    }
  };

  private onClick = (e: MouseEvent): void => {
    if (this.ignored(e)) return;
    const t = e.target as HTMLElement;
    const editor = this.editor;
    const id = this.blockIdAt(t);
    if (t.closest('[data-z-check]')) {
      e.preventDefault();
      if (id) editor.exec('toggleCheck', id);
      return;
    }
    if (t.closest('[data-z-toggle]')) {
      e.preventDefault();
      if (id) editor.exec('toggleOpen', id);
      return;
    }
    if (t.closest('[data-z-callout-tone]') && id && !editor.readOnly) {
      e.preventDefault();
      const tones = ['note', 'info', 'success', 'warning', 'danger'];
      const iconsFor: Record<string, string> = { note: '💡', info: 'ℹ️', success: '✅', warning: '⚠️', danger: '⛔' };
      const cur = editor.doc.get(id)!.attrs.tone ?? 'note';
      const next = tones[(tones.indexOf(cur) + 1) % tones.length];
      editor.exec('setBlockAttrs', id, { tone: next, icon: iconsFor[next] });
      return;
    }
    const link = t.closest('a.z-link') as HTMLAnchorElement | null;
    if (link) {
      // in an editable document a plain click places the caret; Mod+click (or read-only) follows the link
      if (!(editor.readOnly || e.metaKey || e.ctrlKey)) e.preventDefault();
      return;
    }
    const eq = t.closest('[data-z-equation]') as HTMLElement | null;
    if (eq && id && !editor.readOnly) {
      const b = editor.doc.get(id)!;
      inlinePrompt(eq, { value: b.attrs.tex ?? '', label: editor.label('equation.edit'), multiline: true, onSubmit: (v) => editor.exec('setBlockAttrs', id, { tex: v }) });
      return;
    }
    const math = t.closest('.z-math') as HTMLElement | null;
    if (math && id && !editor.readOnly) {
      const v = this.views.get(id);
      const content = v?.handle.contentDOM;
      if (!v || !content) return;
      const off = offsetFromDOM(content, math, 0);
      const atom = sliceInline(v.block.content, off, off + 1)[0] as any;
      if (!atom?.atom) return;
      inlinePrompt(math, {
        value: atom.attrs?.tex ?? '',
        label: editor.label('equation.edit'),
        onSubmit: (tex) => editor.update((tr) => void tr.replaceText(id, off, off + 1, [{ ...atom, attrs: { ...atom.attrs, tex } }])),
      });
    }
  };

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.offs) off();
    this.offs = [];
    if (this.highlightTimer) (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout)(this.highlightTimer);
    if (HAS_HIGHLIGHTS) for (const name of this.highlightNames) (CSS as any).highlights.delete(this.hlName(name));
    this.overlay?.remove();
    for (const v of this.views.values()) {
      try {
        v.handle.destroy?.();
      } catch {
        /* ignore */
      }
    }
    this.views.clear();
    this.root.textContent = '';
    this.root.removeAttribute('contenteditable');
    this.root.classList.remove('z-root', 'z-focused', 'z-empty', 'z-readonly', 'z-paged', 'z-hide-caret', 'z-composing');
    if (this.editor.view === this) this.editor.view = null;
  }
}
