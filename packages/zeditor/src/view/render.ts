/**
 * DOM renderers for blocks, inline atoms and marks, and the incremental inline patcher.
 */
import { Block, Inline, InlineAtom, MarkSet, isAtom, jsonEq } from '../core/model';
import { safeUrl } from '../core/schema';
import type { Editor } from '../core/editor';
import { resolveEmbed } from '../core/builtin';
import { h } from './dom';
import { icon } from '../ui/icons';

export interface NodeViewHandle {
  /** outer element of the block */
  dom: HTMLElement;
  /** element that receives inline content (text blocks) */
  contentDOM?: HTMLElement;
  /** element that receives child blocks; may be created lazily via `ensureChildren` */
  childrenDOM?: HTMLElement;
  /** called when attrs changed. Return false to have the view re-created. */
  update?: (block: Block) => boolean | void;
  destroy?: () => void;
}
export interface RenderContext {
  editor: Editor;
  /** the EditorView (typed loosely to avoid a cycle) */
  view: any;
  label: (key: string, fallback?: string) => string;
}
export type NodeRenderer = (block: Block, ctx: RenderContext) => NodeViewHandle;
export type InlineRenderer = (atom: InlineAtom, ctx: RenderContext) => HTMLElement;
export type MarkRenderer = (value: any, ctx: RenderContext) => HTMLElement | null;

/* ------------------------------------------------------------------ marks */

export const markRenderers: Record<string, MarkRenderer> = {
  bold: () => h('strong'),
  italic: () => h('em'),
  underline: () => h('u'),
  strike: () => h('s'),
  code: () => h('code', { class: 'z-inline-code', spellcheck: 'false' }),
  sub: () => h('sub'),
  sup: () => h('sup'),
  link: (v) => h('a', { class: 'z-link', href: safeUrl(v?.href) || '#', title: v?.title || null, rel: 'noopener noreferrer nofollow', target: '_blank' }),
  color: (v) => {
    const el = h('span');
    el.style.color = String(v?.color ?? '');
    return el;
  },
  highlight: (v) => {
    const el = h('mark', { class: 'z-highlight' });
    if (v?.color) el.style.backgroundColor = String(v.color);
    return el;
  },
  comment: (v) => h('span', { class: 'z-comment', 'data-comment': (v?.ids ?? []).join(' ') }),
  suggestion: (v) => h(v?.kind === 'delete' ? 'del' : 'ins', { class: 'z-suggestion z-suggestion-' + (v?.kind ?? 'insert'), 'data-suggestion': v?.id, title: v?.author || null }),
  hashtag: () => h('span', { class: 'z-hashtag' }),
  fontSize: (v) => {
    const el = h('span');
    el.style.fontSize = String(v?.size ?? '');
    return el;
  },
  fontFamily: (v) => {
    const el = h('span');
    el.style.fontFamily = String(v?.family ?? '');
    return el;
  },
};

/* ------------------------------------------------------------------ inline atoms */

export const inlineRenderers: Record<string, InlineRenderer> = {
  mention: (a) => h('span', { class: 'z-mention', 'data-mention': a.attrs?.id }, '@' + (a.attrs?.label ?? '')),
  math: (a, ctx) => {
    const el = h('span', { class: 'z-math', role: 'button', tabindex: '-1', title: ctx.label('equation.edit') });
    renderMath(ctx.editor, a.attrs?.tex ?? '', el, false);
    return el;
  },
};

export function renderMath(editor: Editor, tex: string, el: HTMLElement, display: boolean): void {
  const fn = editor.storage.renderMath as ((tex: string, el: HTMLElement, display: boolean) => void) | undefined;
  el.textContent = '';
  if (fn && tex) {
    try {
      fn(tex, el, display);
      return;
    } catch {
      /* fall through to source */
    }
  }
  el.append(h('code', { class: 'z-math-src' }, tex || editor.label('equation.empty')));
}

/* ------------------------------------------------------------------ inline patching */

export interface Leaf {
  sig: string;
  text: string;
  len: number;
  dom: Node;
  textNode: Text | null;
}
export interface InlineState {
  leaves: Leaf[];
  trailer: HTMLElement | null;
}

function sigOf(c: Inline): string {
  if (isAtom(c)) return 'A' + c.atom + JSON.stringify(c.attrs ?? {}) + (c.marks ? JSON.stringify(c.marks) : '');
  return c.marks ? 'T' + JSON.stringify(c.marks) : 'T';
}

function buildLeaf(c: Inline, ctx: RenderContext, renderers: { mark: Record<string, MarkRenderer>; inline: Record<string, InlineRenderer> }): Leaf {
  const schema = ctx.editor.schema;
  let node: Node;
  let textNode: Text | null = null;
  if (isAtom(c)) {
    const r = renderers.inline[c.atom] ?? (schema.node(c.atom)?.render as InlineRenderer | undefined);
    let el: HTMLElement;
    if (r) el = r(c, ctx);
    else {
      const spec = schema.node(c.atom);
      el = h('span', { class: spec ? 'z-atom-default' : 'z-atom-unknown', title: spec ? null : ctx.label('unknown.hint') }, spec?.toText?.(c) || c.atom);
    }
    el.contentEditable = 'false';
    el.classList.add('z-atom');
    el.setAttribute('data-atom', c.atom);
    node = el;
  } else {
    textNode = document.createTextNode(c.text);
    node = textNode;
  }
  if (c.marks) {
    const keys = Object.keys(c.marks).sort((a, b) => (schema.marks.get(b)?.rank ?? 50) - (schema.marks.get(a)?.rank ?? 50) || (a < b ? 1 : -1));
    // innermost first: highest rank wraps the text, lowest rank ends up outermost
    for (const k of keys) {
      const r = renderers.mark[k] ?? (schema.marks.get(k)?.render as MarkRenderer | undefined);
      const el = r?.(c.marks[k], ctx);
      if (!el) continue;
      el.append(node);
      node = el;
    }
  }
  return { sig: sigOf(c), text: isAtom(c) ? '' : c.text, len: isAtom(c) ? 1 : c.text.length, dom: node, textNode };
}

/**
 * Bring `contentDOM` in line with `content`, touching as little DOM as possible. When only
 * text changed inside existing spans, only those text nodes are written — and not at all if
 * the DOM already holds the right text (native typing / IME composition).
 */
export function patchInline(
  contentDOM: HTMLElement,
  state: InlineState,
  content: readonly Inline[],
  ctx: RenderContext,
  renderers: { mark: Record<string, MarkRenderer>; inline: Record<string, InlineRenderer> },
  force = false,
): void {
  const old = state.leaves;
  const n = content.length;
  let same = !force && old.length === n;
  if (same) for (let i = 0; i < n; i++) if (old[i].sig !== sigOf(content[i]) || old[i].dom.parentNode !== contentDOM) same = false;
  if (same) {
    for (let i = 0; i < n; i++) {
      const c = content[i];
      const leaf = old[i];
      if (!isAtom(c) && leaf.textNode) {
        if (leaf.textNode.data !== c.text) leaf.textNode.data = c.text;
        leaf.text = c.text;
        leaf.len = c.text.length;
      }
    }
  } else {
    // keep an unchanged prefix and suffix, rebuild the middle
    let pre = 0;
    if (!force) while (pre < old.length && pre < n && old[pre].sig === sigOf(content[pre]) && old[pre].dom.parentNode === contentDOM && (isAtom(content[pre]) || old[pre].textNode?.data === (content[pre] as any).text)) pre++;
    let suf = 0;
    if (!force)
      while (suf < old.length - pre && suf < n - pre) {
        const o = old[old.length - 1 - suf];
        const c = content[n - 1 - suf];
        if (o.sig !== sigOf(c) || o.dom.parentNode !== contentDOM || (!isAtom(c) && o.textNode?.data !== c.text)) break;
        suf++;
      }
    const fresh: Leaf[] = [];
    for (let i = pre; i < n - suf; i++) fresh.push(buildLeaf(content[i], ctx, renderers));
    const before = suf > 0 ? old[old.length - suf].dom : state.trailer && state.trailer.parentNode === contentDOM ? state.trailer : null;
    for (let i = pre; i < old.length - suf; i++) if (old[i].dom.parentNode === contentDOM) contentDOM.removeChild(old[i].dom);
    if (force || pre + suf === 0) {
      // drop anything foreign the browser may have left behind (composition leftovers)
      for (const child of [...contentDOM.childNodes]) if (child !== state.trailer && !old.slice(old.length - suf).some((l) => l.dom === child)) contentDOM.removeChild(child);
    }
    for (const leaf of fresh) contentDOM.insertBefore(leaf.dom, before && before.parentNode === contentDOM ? before : null);
    state.leaves = [...old.slice(0, pre), ...fresh, ...old.slice(old.length - suf)];
  }
  // a trailing <br> keeps empty blocks, trailing newlines and trailing atoms caret-able
  const last = content[n - 1];
  const need = n === 0 || isAtom(last) || last.text.endsWith('\n');
  if (need) {
    if (!state.trailer) state.trailer = h('br', { class: 'z-trail' });
    if (state.trailer.parentNode !== contentDOM || contentDOM.lastChild !== state.trailer) contentDOM.append(state.trailer);
  } else if (state.trailer?.parentNode) state.trailer.remove();
}

/** Text of a content element as the model sees it: atoms are U+FFFC, the trailing <br> is ignored. */
export function readDOMText(contentDOM: HTMLElement): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      out += (node as Text).data;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    if (el.hasAttribute('data-atom')) {
      out += '￼';
      return;
    }
    if (el.tagName === 'BR') {
      // a <br> that ends the block is a layout artifact, any other one is a line break
      if (!isTrailingBR(el, contentDOM)) out += '\n';
      return;
    }
    if (el.getAttribute('contenteditable') === 'false') return;
    for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
  };
  for (let c = contentDOM.firstChild; c; c = c.nextSibling) walk(c);
  return out.replace(/​/g, '');
}
function isTrailingBR(br: Node, root: Node): boolean {
  let n: Node | null = br;
  while (n && n !== root) {
    if (n.nextSibling) return false;
    n = n.parentNode;
  }
  return true;
}

/** Model offset of a DOM point inside a content element. */
export function offsetFromDOM(contentDOM: HTMLElement, node: Node, offset: number): number {
  let count = 0;
  let done = false;
  const walk = (cur: Node): void => {
    if (done) return;
    if (cur === node && cur.nodeType === 3) {
      count += Math.min(offset, (cur as Text).data.length);
      done = true;
      return;
    }
    if (cur.nodeType === 3) {
      count += (cur as Text).data.length;
      return;
    }
    if (cur.nodeType !== 1) return;
    const el = cur as HTMLElement;
    if (el.hasAttribute('data-atom')) {
      if (cur === node || el.contains(node)) {
        // a point inside the atom counts as "before" it; (atom, >0) as "after" it
        if (cur === node && offset > 0) count += 1;
        done = true;
        return;
      }
      count += 1;
      return;
    }
    if (el.tagName === 'BR') {
      if (cur === node) {
        done = true;
        return;
      }
      if (!isTrailingBR(el, contentDOM)) count += 1;
      return;
    }
    let i = 0;
    for (let c = el.firstChild; c; c = c.nextSibling, i++) {
      if (cur === node && i === offset) {
        done = true;
        return;
      }
      walk(c);
      if (done) return;
    }
    if (cur === node) done = true;
  };
  walk(contentDOM);
  return count;
}

/** DOM point for a model offset, using the leaves rendered by `patchInline`. */
export function domFromOffset(contentDOM: HTMLElement, state: InlineState, offset: number): { node: Node; offset: number } {
  let pos = 0;
  const leaves = state.leaves;
  for (let i = 0; i < leaves.length; i++) {
    const l = leaves[i];
    if (l.textNode) {
      if (offset <= pos + l.len) return { node: l.textNode, offset: Math.max(0, offset - pos) };
    } else if (offset <= pos) return { node: contentDOM, offset: indexOf(contentDOM, l.dom) };
    else if (offset === pos + 1 && (i === leaves.length - 1 || !leaves[i + 1].textNode)) return { node: contentDOM, offset: indexOf(contentDOM, l.dom) + 1 };
    pos += l.len;
  }
  const last = leaves[leaves.length - 1];
  if (last?.textNode) return { node: last.textNode, offset: last.len };
  return { node: contentDOM, offset: leaves.length };
}
function indexOf(parent: Node, child: Node): number {
  let i = 0;
  for (let c = parent.firstChild; c && c !== child; c = c.nextSibling) i++;
  return i;
}

/* ------------------------------------------------------------------ blocks */

function applyCommon(dom: HTMLElement, b: Block): void {
  const a = b.attrs;
  dom.style.textAlign = a.align && /^(center|right|justify)$/.test(a.align) ? a.align : '';
  if (a.indent > 0) dom.style.setProperty('--z-indent', String(Math.min(8, a.indent | 0)));
  else dom.style.removeProperty('--z-indent');
}

const textRenderer =
  (tag: (b: Block) => string, cls: string): NodeRenderer =>
  (b) => {
    const contentDOM = h(tag(b), { class: 'z-content' });
    const dom = h('div', { class: 'z-block ' + cls }, contentDOM);
    const level = b.attrs.level;
    applyCommon(dom, b);
    return {
      dom,
      contentDOM,
      update: (nb) => {
        if (nb.attrs.level !== level) return false;
        applyCommon(dom, nb);
      },
    };
  };

export const defaultTextRenderer = textRenderer(() => 'div', 'z-text');
export const defaultContainerRenderer: NodeRenderer = (b) => {
  const dom = h('div', { class: 'z-block z-container z-' + cssName(b.type) });
  return { dom, childrenDOM: dom };
};
export const defaultAtomRenderer: NodeRenderer = (b, ctx) => {
  const dom = h('div', { class: 'z-block z-atom-block z-' + cssName(b.type), contenteditable: 'false' }, ctx.editor.schema.node(b.type)?.toText?.(b) || b.type);
  return { dom };
};
function cssName(type: string): string {
  return type.replace(/[^\w-]/g, '-');
}

function fileSize(n: number | undefined): string {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

/** Open a small inline editor for a text value (caption, equation, embed url). */
export function inlinePrompt(anchor: HTMLElement, opts: { value: string; label: string; multiline?: boolean; onSubmit: (v: string) => void; onCancel?: () => void }): void {
  const input = opts.multiline ? h('textarea', { class: 'z-input', rows: '3', 'aria-label': opts.label, placeholder: opts.label }) : h('input', { class: 'z-input', type: 'text', 'aria-label': opts.label, placeholder: opts.label });
  (input as HTMLInputElement).value = opts.value;
  const box = h('div', { class: 'z-popover z-prompt', 'data-z-ignore': '', role: 'dialog', 'aria-label': opts.label }, input);
  let done = false;
  const close = (commit: boolean) => {
    if (done) return;
    done = true;
    box.remove();
    document.removeEventListener('mousedown', outside, true);
    if (commit) opts.onSubmit((input as HTMLInputElement).value);
    else opts.onCancel?.();
  };
  const outside = (e: Event) => {
    if (!box.contains(e.target as Node)) close(true);
  };
  input.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    ke.stopPropagation();
    if (ke.key === 'Escape') {
      ke.preventDefault();
      close(false);
    } else if (ke.key === 'Enter' && (!opts.multiline || ke.ctrlKey || ke.metaKey)) {
      ke.preventDefault();
      close(true);
    }
  });
  (anchor.closest('.zeditor') ?? document.body).append(box);
  const r = anchor.getBoundingClientRect();
  box.style.position = 'fixed';
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 340)) + 'px';
  box.style.top = Math.min(r.bottom + 6, window.innerHeight - 120) + 'px';
  setTimeout(() => {
    input.focus();
    (input as HTMLInputElement).select?.();
    document.addEventListener('mousedown', outside, true);
  });
}

export const nodeRenderers: Record<string, NodeRenderer> = {
  paragraph: textRenderer(() => 'p', 'z-paragraph'),
  heading: textRenderer((b) => 'h' + Math.max(1, Math.min(6, b.attrs.level | 0 || 1)), 'z-heading'),
  quote: textRenderer(() => 'blockquote', 'z-quote'),

  list: (b, ctx) => {
    const marker = h('span', { class: 'z-marker', contenteditable: 'false', 'aria-hidden': 'true' });
    const contentDOM = h('div', { class: 'z-content' });
    const dom = h('div', { class: 'z-block z-list' }, marker, contentDOM);
    let kind = '';
    const sync = (nb: Block) => {
      const k = nb.attrs.kind ?? 'bullet';
      dom.dataset.kind = k;
      if (k !== kind) {
        marker.textContent = '';
        marker.removeAttribute('aria-hidden');
        if (k === 'check') {
          const box = h('span', { class: 'z-check', role: 'checkbox', tabindex: '-1', 'aria-label': ctx.label('check.toggle'), 'data-z-check': '' });
          marker.append(box);
        } else marker.setAttribute('aria-hidden', 'true');
        kind = k;
      }
      if (k === 'check') {
        dom.dataset.checked = nb.attrs.checked ? 'true' : 'false';
        marker.firstElementChild?.setAttribute('aria-checked', nb.attrs.checked ? 'true' : 'false');
      } else delete dom.dataset.checked;
      if (k === 'ordered' && nb.attrs.start != null) dom.style.counterReset = 'z-ol ' + ((nb.attrs.start | 0) - 1);
      else dom.style.counterReset = '';
      applyCommon(dom, nb);
    };
    sync(b);
    return { dom, contentDOM, update: sync };
  },

  toggle: (b, ctx) => {
    const btn = h('button', { class: 'z-toggle-btn', type: 'button', contenteditable: 'false', tabindex: '-1', 'aria-label': ctx.label('toggle.toggle'), 'data-z-toggle': '', html: icon('chevron') });
    const contentDOM = h('div', { class: 'z-content' });
    const dom = h('div', { class: 'z-block z-toggle' }, btn, contentDOM);
    const sync = (nb: Block) => {
      const open = nb.attrs.open !== false;
      dom.dataset.open = String(open);
      dom.dataset.level = nb.attrs.level ? String(nb.attrs.level) : '';
      btn.setAttribute('aria-expanded', String(open));
    };
    sync(b);
    return { dom, contentDOM, update: sync };
  },

  code: (b, ctx) => {
    const langs: string[] = ctx.editor.storage.codeLanguages ?? ['plain'];
    const select = h('select', { class: 'z-code-lang', 'aria-label': ctx.label('code.language'), 'data-z-ignore': '' }, ...langs.map((l) => h('option', { value: l }, l)));
    const copy = h('button', { class: 'z-code-copy', type: 'button', 'data-z-ignore': '', 'aria-label': ctx.label('code.copy') }, ctx.label('code.copy'));
    const bar = h('div', { class: 'z-code-bar', contenteditable: 'false' }, select, copy);
    const contentDOM = h('code', { class: 'z-content', spellcheck: 'false' });
    const dom = h('div', { class: 'z-block z-code' }, bar, h('pre', null, contentDOM));
    let id = b.id;
    select.addEventListener('change', () => ctx.editor.exec('setBlockAttrs', id, { language: select.value }));
    copy.addEventListener('click', () => {
      const text = ctx.editor.doc.get(id)?.text ?? '';
      const done = () => {
        copy.textContent = ctx.label('code.copied');
        setTimeout(() => (copy.textContent = ctx.label('code.copy')), 1200);
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => undefined);
    });
    const sync = (nb: Block) => {
      id = nb.id;
      const lang = nb.attrs.language ?? 'plain';
      if (![...select.options].some((o) => o.value === lang)) select.append(h('option', { value: lang }, lang));
      select.value = lang;
      dom.dataset.language = lang;
      select.disabled = ctx.editor.readOnly;
    };
    sync(b);
    return { dom, contentDOM, update: sync };
  },

  divider: () => ({ dom: h('div', { class: 'z-block z-divider', contenteditable: 'false' }, h('hr')) }),
  page_break: (_b, ctx) => ({ dom: h('div', { class: 'z-block z-page-break', contenteditable: 'false', role: 'separator', 'aria-label': ctx.label('pages.break') }, h('span', null, ctx.label('pages.break'))) }),

  unknown: (b, ctx) => ({
    dom: h(
      'div',
      { class: 'z-block z-unknown', contenteditable: 'false', title: ctx.label('unknown.hint') },
      h('strong', null, ctx.label('unknown.block')),
      h('span', { class: 'z-unknown-type' }, ' · ' + String(b.attrs.raw?.type ?? '?')),
    ),
  }),

  image: (b, ctx) => {
    const img = h('img', { class: 'z-image-img', draggable: 'false', alt: '' });
    const status = h('div', { class: 'z-upload-status', role: 'status' });
    const handle = h('span', { class: 'z-resize-handle', role: 'slider', tabindex: '0', 'aria-label': ctx.label('image.resize'), 'data-z-ignore': '' });
    const frame = h('div', { class: 'z-image-frame' }, img, handle, status);
    const caption = h('input', { class: 'z-caption', type: 'text', 'data-z-ignore': '', placeholder: ctx.label('image.captionPlaceholder'), 'aria-label': ctx.label('image.caption') });
    const altBtn = h('button', { class: 'z-alt-btn', type: 'button', 'data-z-ignore': '', title: ctx.label('image.alt') }, 'ALT');
    const dom = h('figure', { class: 'z-block z-image', contenteditable: 'false' }, frame, altBtn, caption);
    let cur = b;
    const editor = ctx.editor;
    // commit explicitly: `change` is not reliably fired for programmatic blurs in every engine
    const commitCaption = () => {
      if (caption.value !== (cur.attrs.caption ?? '')) editor.exec('setBlockAttrs', cur.id, { caption: caption.value });
    };
    caption.addEventListener('change', commitCaption);
    caption.addEventListener('blur', commitCaption);
    caption.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (e.key === 'Enter') commitCaption();
        else caption.value = cur.attrs.caption ?? '';
        caption.blur();
        ctx.view.focus();
      }
    });
    altBtn.addEventListener('click', () => inlinePrompt(altBtn, { value: cur.attrs.alt ?? '', label: ctx.label('image.altPrompt'), onSubmit: (v) => editor.exec('setBlockAttrs', cur.id, { alt: v }) }));
    // pointer resize (mouse, pen and touch), plus arrow keys on the handle
    handle.addEventListener('pointerdown', (e) => {
      if (editor.readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = img.getBoundingClientRect().width;
      let w = startW;
      const move = (ev: PointerEvent) => {
        w = Math.max(48, Math.round(startW + (ev.clientX - startX) * (dom.style.textAlign === 'center' ? 2 : 1)));
        img.style.width = w + 'px';
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        if (Math.round(w) !== Math.round(startW)) editor.exec('setBlockAttrs', cur.id, { width: w });
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      const w = Math.round(img.getBoundingClientRect().width) + (e.key === 'ArrowRight' ? 16 : -16);
      editor.exec('setBlockAttrs', cur.id, { width: Math.max(48, w) });
    });
    const offUpload = editor.on('upload', (ev: any) => {
      if (ev.id && ev.id === cur.attrs.uploadId && ev.state === 'uploading') status.style.setProperty('--z-progress', String(ev.progress ?? 0));
    });
    const sync = (nb: Block) => {
      cur = nb;
      const a = nb.attrs;
      const src = safeUrl(a.src, { image: true });
      if (img.getAttribute('src') !== src) {
        if (src) img.setAttribute('src', src);
        else img.removeAttribute('src');
      }
      img.alt = a.alt ?? '';
      img.style.width = a.width ? a.width + 'px' : '';
      if (document.activeElement !== caption) caption.value = a.caption ?? '';
      caption.readOnly = editor.readOnly;
      dom.dataset.status = a.status ?? '';
      dom.classList.toggle('z-has-alt', !!a.alt);
      status.textContent = '';
      if (a.status === 'uploading') status.append(h('span', { class: 'z-progress' }), ctx.label('image.uploading'));
      else if (a.status === 'error')
        status.append(
          ctx.label('image.failed') + ' ',
          h('button', { type: 'button', class: 'z-btn', 'data-z-ignore': '', onclick: () => editor.emit('ui:retryUpload', { id: a.uploadId }) }, ctx.label('upload.retry')),
        );
      applyCommon(dom, nb);
    };
    sync(b);
    return { dom, update: sync, destroy: offUpload };
  },

  file: (b, ctx) => {
    const link = h('a', { class: 'z-file-link', target: '_blank', rel: 'noopener noreferrer nofollow', 'data-z-ignore': '' });
    const meta = h('span', { class: 'z-file-meta' });
    const dom = h('div', { class: 'z-block z-file', contenteditable: 'false' }, h('span', { class: 'z-file-icon', html: icon('file') }), link, meta);
    const sync = (nb: Block) => {
      const a = nb.attrs;
      const url = safeUrl(a.url);
      link.textContent = a.name ?? 'file';
      if (url) {
        link.href = url;
        link.setAttribute('download', a.name ?? '');
      } else link.removeAttribute('href');
      meta.textContent = '';
      dom.dataset.status = a.status ?? '';
      if (a.status === 'uploading') meta.append(ctx.label('image.uploading'));
      else if (a.status === 'error') meta.append(ctx.label('image.failed') + ' ', h('button', { type: 'button', class: 'z-btn', 'data-z-ignore': '', onclick: () => ctx.editor.emit('ui:retryUpload', { id: a.uploadId }) }, ctx.label('upload.retry')));
      else meta.append(fileSize(a.size));
    };
    sync(b);
    return { dom, update: sync };
  },

  embed: (b, ctx) => {
    const dom = h('div', { class: 'z-block z-embed', contenteditable: 'false' });
    let url = '';
    const sync = (nb: Block) => {
      if (nb.attrs.url === url && dom.firstChild) return;
      url = nb.attrs.url;
      dom.textContent = '';
      const safe = safeUrl(url);
      const res = safe ? resolveEmbed(ctx.editor, safe) : null;
      if (res) {
        const frame = h('iframe', {
          class: 'z-embed-frame',
          src: res.src,
          title: nb.attrs.title || res.provider,
          loading: 'lazy',
          referrerpolicy: 'no-referrer',
          sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
          allow: 'fullscreen; picture-in-picture',
        });
        if (res.aspect) frame.style.aspectRatio = String(res.aspect);
        if (nb.attrs.height) frame.style.height = nb.attrs.height + 'px';
        dom.append(frame);
      } else if (safe) {
        dom.append(h('a', { class: 'z-embed-card', href: safe, target: '_blank', rel: 'noopener noreferrer nofollow', 'data-z-ignore': '' }, h('span', { html: icon('link') }), ' ', nb.attrs.title || safe));
      } else dom.append(h('span', { class: 'z-embed-empty' }, ctx.label('embed.prompt')));
    };
    sync(b);
    return { dom, update: sync };
  },

  equation: (b, ctx) => {
    const body = h('div', { class: 'z-equation-body' });
    const dom = h('div', { class: 'z-block z-equation', contenteditable: 'false', role: 'button', tabindex: '-1', title: ctx.label('equation.edit'), 'data-z-equation': '' }, body);
    const sync = (nb: Block) => renderMath(ctx.editor, nb.attrs.tex ?? '', body, true);
    sync(b);
    return { dom, update: sync };
  },

  callout: (b, ctx) => {
    const iconBtn = h('button', { class: 'z-callout-icon', type: 'button', contenteditable: 'false', tabindex: '-1', 'data-z-callout-tone': '', 'aria-label': ctx.label('callout.tone') });
    const childrenDOM = h('div', { class: 'z-callout-body' });
    const dom = h('div', { class: 'z-block z-callout', role: 'note' }, iconBtn, childrenDOM);
    const sync = (nb: Block) => {
      dom.dataset.tone = nb.attrs.tone ?? 'note';
      iconBtn.textContent = nb.attrs.icon || '💡';
    };
    sync(b);
    return { dom, childrenDOM, update: sync };
  },

  columns: () => {
    const dom = h('div', { class: 'z-block z-columns' });
    return { dom, childrenDOM: dom };
  },
  column: (b) => {
    const dom = h('div', { class: 'z-block z-column' });
    const sync = (nb: Block) => {
      dom.style.flex = `${nb.attrs.width ? +nb.attrs.width : 1} 1 0`;
    };
    sync(b);
    return { dom, childrenDOM: dom, update: sync };
  },

  table: (b) => {
    const colgroup = h('colgroup');
    const tbody = h('tbody');
    const table = h('table', { class: 'z-table' }, colgroup, tbody);
    const dom = h('div', { class: 'z-block z-table-wrap' }, table);
    const sync = (nb: Block) => {
      const w: number[] = Array.isArray(nb.attrs.colWidths) ? nb.attrs.colWidths : [];
      colgroup.textContent = '';
      let total = 0;
      for (const x of w) {
        const col = h('col');
        if (x > 0) {
          col.style.width = x + 'px';
          total += x;
        }
        colgroup.append(col);
      }
      table.style.tableLayout = w.some((x) => x > 0) ? 'fixed' : '';
      table.style.width = w.length && w.every((x) => x > 0) ? total + 'px' : '';
    };
    sync(b);
    return { dom, childrenDOM: tbody, update: sync };
  },
  table_row: () => {
    const dom = h('tr', { class: 'z-row' });
    return { dom, childrenDOM: dom };
  },
  table_cell: (b) => {
    const header = !!b.attrs.header;
    const dom = h(header ? 'th' : 'td', { class: 'z-cell' });
    if (header) dom.setAttribute('scope', 'col');
    const sync = (nb: Block) => {
      if (!!nb.attrs.header !== header) return false;
      (dom as HTMLTableCellElement).colSpan = nb.attrs.colspan > 1 ? nb.attrs.colspan : 1;
      (dom as HTMLTableCellElement).rowSpan = nb.attrs.rowspan > 1 ? nb.attrs.rowspan : 1;
      dom.style.backgroundColor = nb.attrs.background ?? '';
    };
    sync(b);
    return { dom, childrenDOM: dom, update: sync };
  },

  page: (b) => {
    const dom = h('section', { class: 'z-block z-page', role: 'region' });
    const sync = (nb: Block) => {
      dom.setAttribute('aria-label', nb.attrs.title || 'Page');
      dom.dataset.title = nb.attrs.title ?? '';
    };
    sync(b);
    return { dom, childrenDOM: dom, update: sync };
  },
};

export function sameMarks(a: MarkSet | undefined, b: MarkSet | undefined): boolean {
  return jsonEq(a ?? {}, b ?? {});
}
