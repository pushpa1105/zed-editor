/**
 * Built-in editing commands. All of them work on the headless Editor (no DOM).
 */
import {
  Attrs,
  Block,
  BlockJSON,
  Inline,
  InlineAtom,
  MarkSet,
  cloneWithNewIds,
  contentLength,
  contentText,
  isAtom,
  jsonEq,
  mapMarks,
  marksAt,
  newId,
  sliceInline,
  inlineAt,
} from './model';
import type { CommandFn, Editor, Transaction } from './editor';
import {
  Point,
  Selection,
  blockSel,
  blocksBetween,
  firstTextBlock,
  isCollapsed,
  lastTextBlock,
  selRange,
  textBlocksBetween,
  textSel,
  topMost,
} from './selection';
import { cellsInSelection } from './table';

/* ------------------------------------------------------------------ helpers */

export function isoAncestor(editor: Editor, b: Block): Block | null {
  return editor.doc.closest(b.parent, (x) => !!editor.schema.node(x.type)?.isolating);
}

const SEG: any = typeof Intl !== 'undefined' && (Intl as any).Segmenter ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' }) : null;
const EMOJIISH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|‍|️|⃣/u;

/** Offset of the next grapheme cluster boundary after `offset`. */
export function nextGrapheme(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  const win = text.slice(offset, offset + 64);
  if (SEG) {
    for (const s of SEG.segment(win)) return offset + s.segment.length;
  }
  const cp = win.codePointAt(0)!;
  let n = cp > 0xffff ? 2 : 1;
  while (/[̀-ͯ‍️]/.test(win[n] ?? '')) n++;
  return offset + n;
}
/**
 * Offset where Backspace should stop. Emoji sequences are removed as a whole; otherwise one
 * code point is removed, matching native behaviour for combining marks and Indic scripts.
 */
export function prevDeleteBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  const start = Math.max(0, offset - 64);
  const win = text.slice(start, offset);
  let cluster = '';
  if (SEG) for (const s of SEG.segment(win)) cluster = s.segment;
  if (cluster && cluster.length > 1 && EMOJIISH.test(cluster)) return offset - cluster.length;
  const lo = text.charCodeAt(offset - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && offset >= 2) {
    const hi = text.charCodeAt(offset - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return offset - 2;
  }
  return offset - 1;
}
export function prevWordBoundary(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && /\s/.test(text[i - 1])) i--;
  if (i > 0 && /[\p{L}\p{N}_\p{M}]/u.test(text[i - 1])) while (i > 0 && /[\p{L}\p{N}_\p{M}]/u.test(text[i - 1])) i--;
  else if (i > 0) i = prevDeleteBoundary(text, i);
  return i;
}
export function nextWordBoundary(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i < text.length && /[\p{L}\p{N}_\p{M}]/u.test(text[i])) while (i < text.length && /[\p{L}\p{N}_\p{M}]/u.test(text[i])) i++;
  else if (i < text.length) i = nextGrapheme(text, i);
  return i;
}

/** Marks that newly typed text gets at `offset` (respects non-inclusive marks such as links). */
export function typingMarks(editor: Editor, block: Block, offset: number): MarkSet | undefined {
  const spec = editor.schema.node(block.type);
  if (!spec || spec.code || spec.marks === false) return undefined;
  if (editor.storedMarks) return editor.storedMarks;
  const before = offset > 0 ? inlineAt(block.content, offset - 1)?.marks : undefined;
  const after = inlineAt(block.content, offset)?.marks;
  const base = offset > 0 ? before : after;
  if (!base) return undefined;
  let out: MarkSet | undefined;
  for (const k in base) {
    const ms = editor.schema.marks.get(k);
    const inclusive = ms ? ms.inclusive !== false : false;
    // non-inclusive marks continue only strictly inside the marked run
    if (inclusive || (before && after && jsonEq(before[k], after[k]) && before[k] !== undefined)) (out ??= {})[k] = base[k];
  }
  return out;
}

/** Content adapted to the target block (code blocks hold plain text only). */
function adapt(editor: Editor, content: Inline[], target: Block): Inline[] {
  const spec = editor.schema.node(target.type);
  if (spec?.code) {
    const t = contentText(content, '');
    return t ? [{ text: t }] : [];
  }
  if (spec?.marks === false) return content.map((c) => (isAtom(c) ? { atom: c.atom, attrs: c.attrs } : { text: c.text }));
  return content;
}

export interface TextRange {
  block: Block;
  from: number;
  to: number;
}
/** Text ranges covered by the current selection (text, block or cell selection). */
export function selectedRanges(editor: Editor, sel: Selection | null = editor.selection): TextRange[] {
  const { doc, schema } = editor;
  if (!sel) return [];
  if (sel.type === 'text') {
    const r = selRange(doc, sel);
    return textBlocksBetween(doc, schema, r.from.id, r.to.id).map((b) => ({
      block: b,
      from: b.id === r.from.id ? r.from.offset : 0,
      to: b.id === r.to.id ? r.to.offset : b.length,
    }));
  }
  const roots = sel.type === 'block' ? sel.ids.map((id) => doc.get(id)!).filter(Boolean) : cellsInSelection(editor, sel);
  const out: TextRange[] = [];
  for (const r of roots) {
    if (schema.isText(r)) out.push({ block: r, from: 0, to: r.length });
    for (const b of doc.descendants(r)) if (schema.isText(b)) out.push({ block: b, from: 0, to: b.length });
  }
  return out;
}

/** Top-most blocks touched by the selection, in document order. */
export function selectedBlocks(editor: Editor, sel: Selection | null = editor.selection): Block[] {
  const { doc } = editor;
  if (!sel) return [];
  if (sel.type === 'block') return topMost(doc, sel.ids);
  if (sel.type === 'cell') {
    const t = doc.get(sel.table);
    return t ? [t] : [];
  }
  const r = selRange(doc, sel);
  const blocks = textBlocksBetween(doc, editor.schema, r.from.id, r.to.id);
  return topMost(
    doc,
    blocks.map((b) => b.id),
  );
}

/** The text block holding the selection focus, if any. */
export function focusBlock(editor: Editor): Block | null {
  const sel = editor.selection;
  if (!sel || sel.type !== 'text') return null;
  return editor.doc.get(sel.focus.id) ?? null;
}

function suggesting(editor: Editor): { author: string } | null {
  const s = editor.storage.suggest;
  return s && s.active ? s : null;
}

/* ------------------------------------------------------------------ deleting */

/**
 * Delete everything between two points (from <= to in document order) and join the blocks.
 * Returns the caret position after deletion.
 */
export function deleteRange(tr: Transaction, from: Point, to: Point): Point {
  const editor = tr.editor;
  const { doc, schema } = tr;
  const a = doc.get(from.id);
  const b = doc.get(to.id);
  if (!a || !b) return from;
  const sug = suggesting(editor);
  if (sug) {
    // suggestion mode: mark as deleted instead of deleting; own pending insertions are removed
    const id = newId();
    const blocks = textBlocksBetween(doc, schema, a.id, b.id);
    for (let i = blocks.length - 1; i >= 0; i--) {
      const blk = blocks[i];
      const s = blk === a ? from.offset : 0;
      const e = blk === b ? to.offset : blk.length;
      if (e <= s) continue;
      const parts = sliceInline(blk.content, s, e);
      const out: Inline[] = [];
      for (const p of parts) {
        const cur = p.marks?.suggestion;
        if (cur && cur.kind === 'insert' && cur.author === sug.author) continue;
        if (cur) out.push(p);
        else out.push({ ...p, marks: { ...(p.marks ?? {}), suggestion: { id, kind: 'delete', author: sug.author, at: Date.now() } } });
      }
      tr.step({ t: 'text', id: blk.id, from: s, to: e, insert: out });
    }
    return from;
  }
  if (a === b) {
    tr.replaceText(a.id, from.offset, to.offset);
    return from;
  }
  if (isoAncestor(editor, a) !== isoAncestor(editor, b)) {
    // the range crosses an isolating boundary (e.g. into a table cell): clear text, keep structure
    for (const blk of textBlocksBetween(doc, schema, a.id, b.id)) {
      const s = blk === a ? from.offset : 0;
      const e = blk === b ? to.offset : blk.length;
      tr.replaceText(blk.id, s, e);
    }
    return from;
  }
  const tail = sliceInline(b.content, to.offset);
  const bAnc = new Set(doc.ancestors(b).map((x) => x.id));
  const between = blocksBetween(doc, a.id, b.id)
    .slice(1, -1)
    .filter((x) => !bAnc.has(x.id));
  const removable = topMost(
    doc,
    between.map((x) => x.id),
  );
  for (let i = removable.length - 1; i >= 0; i--) tr.remove(removable[i].id);
  tr.replaceText(a.id, from.offset, a.length, adapt(editor, tail, a));
  const bNow = doc.get(b.id)!;
  let parent = bNow.parent!;
  const idx = bNow.index;
  const kids = bNow.children?.map((c) => c.toJSON()) ?? [];
  tr.removeAt(parent.id, idx, 1);
  if (kids.length) {
    if (kids.every((k) => k.type === 'unknown' || schema.canContain(parent, k.type))) tr.insert(parent.id, idx, kids);
    else tr.insertAfter(a.id, kids);
  }
  // remove containers that became empty
  while (parent !== doc.root && schema.kind(parent) === 'container' && !parent.children!.length && !schema.node(parent.type)?.isolating) {
    const pp: Block = parent.parent!;
    tr.remove(parent.id);
    parent = pp;
  }
  return from;
}

function removeBlocks(tr: Transaction, blocks: Block[], fresh = false): void {
  const { doc, schema } = tr;
  const editor = tr.editor;
  if (!blocks.length) return;
  const first = blocks[0];
  const parent = first.parent!;
  const index = first.index;
  const before = doc.prev(first);
  for (let i = blocks.length - 1; i >= 0; i--) tr.remove(blocks[i].id);
  const p = doc.get(parent.id) ?? doc.root;
  const at = p.children?.[index];
  const iso = (x: Block | null) => (x ? isoAncestor(editor, x) : null);
  if (!fresh && at && schema.isText(at)) tr.select(textSel(at.id, 0));
  else if (!fresh && before && doc.has(before.id) && schema.isText(before) && iso(before) === (p === doc.root ? null : schema.node(p.type)?.isolating ? p : iso(p))) tr.select(textSel(before.id, before.length));
  else {
    const para = schema.create('paragraph');
    const host = schema.isText(p) || schema.canContain(p, 'paragraph') ? p : doc.root;
    tr.insert(host.id, host === p ? Math.min(index, p.children?.length ?? 0) : host.children!.length, [para]);
    tr.select(textSel(para.id, 0));
  }
}

export const deleteSelection: CommandFn = (editor) => {
  const sel = editor.selection;
  if (!sel || editor.readOnly) return false;
  if (sel.type === 'text') {
    if (isCollapsed(sel)) return false;
    return editor.update((tr) => {
      const r = selRange(editor.doc, sel);
      const p = deleteRange(tr, r.from, r.to);
      tr.select(textSel(p.id, p.offset)).scroll();
    });
  }
  if (sel.type === 'block') {
    return editor.update((tr) => {
      removeBlocks(tr, topMost(editor.doc, sel.ids));
      tr.scroll();
    });
  }
  return editor.update((tr) => {
    for (const cell of cellsInSelection(editor, sel)) {
      const kids = cell.children ?? [];
      const para = editor.schema.create('paragraph');
      tr.removeAt(cell.id, 0, kids.length);
      tr.insert(cell.id, 0, [para]);
    }
    tr.select(sel);
  });
};

function liftOut(tr: Transaction, block: Block): void {
  // move `block` out of its parent text block: later siblings become its children
  const { doc, schema } = tr;
  const parent = block.parent!;
  const idx = block.index;
  const later = parent.children!.slice(idx + 1);
  if (later.length && schema.node(block.type)?.children === true) {
    tr.move(
      later.map((x) => x.id),
      block.id,
      block.children?.length ?? 0,
    );
  }
  const p = doc.get(parent.id)!;
  tr.move([block.id], p.parent!.id, p.index + 1);
}

function backspaceAtStart(editor: Editor, block: Block): boolean {
  const { doc, schema } = editor;
  const spec = schema.node(block.type)!;
  const parent = block.parent!;
  return editor.update((tr) => {
    const keep = () => tr.select(textSel(block.id, 0));
    if (block.type !== 'paragraph') {
      if (spec.continues && schema.isText(parent)) {
        liftOut(tr, block);
        return keep();
      }
      tr.setType(block.id, 'paragraph');
      return keep();
    }
    if ((block.attrs.indent ?? 0) > 0) {
      tr.setAttrs(block.id, { indent: block.attrs.indent - 1 || undefined });
      return keep();
    }
    if (schema.isText(parent)) {
      if (block.index === 0 && true) {
        // first child: merge into the parent's text
        const p = deleteRange(tr, { id: parent.id, offset: parent.length }, { id: block.id, offset: 0 });
        tr.select(textSel(p.id, p.offset));
        return;
      }
    }
    const prev = doc.prev(block);
    if (!prev) return keep();
    if (prev === parent && schema.kind(parent) === 'container') {
      if (spec && schema.node(parent.type)?.isolating) return keep();
      // first block of a callout-like container: lift it out in front of the container
      const gp = parent.parent!;
      if (!schema.canContain(gp, block.type)) return keep();
      tr.move([block.id], gp.id, parent.index);
      const p2 = doc.get(parent.id);
      if (p2 && !p2.children!.length) tr.remove(p2.id);
      return keep();
    }
    const prevIso = schema.node(prev.type)?.isolating ? prev : isoAncestor(editor, prev);
    if (prevIso !== isoAncestor(editor, block)) {
      // previous content lives in an isolated region (table, columns): select that block
      let top: Block = prev;
      while (top.parent && top.parent !== parent && top.parent !== doc.root) top = top.parent;
      const target = top.parent === parent ? top : prev;
      if (!block.length && !block.children && parent.children!.length > 1) tr.remove(block.id);
      tr.select(blockSel([target.id]));
      return;
    }
    if (!schema.isText(prev)) {
      if (!block.length && !block.children) tr.remove(block.id);
      tr.select(blockSel([prev.id]));
      return;
    }
    const p = deleteRange(tr, { id: prev.id, offset: prev.length }, { id: block.id, offset: 0 });
    tr.select(textSel(p.id, p.offset));
  });
}

export const deleteBackward: CommandFn = (editor, unit: 'char' | 'word' | 'line' = 'char') => {
  const sel = editor.selection;
  if (!sel || editor.readOnly) return false;
  if (!isCollapsed(sel)) return deleteSelection(editor);
  const { id, offset } = (sel as any).focus as Point;
  const block = editor.doc.get(id)!;
  if (offset === 0) return backspaceAtStart(editor, block);
  const text = block.text;
  const start = unit === 'line' ? Math.max(0, text.lastIndexOf('\n', offset - 1) + (text[offset - 1] === '\n' ? 0 : 1)) : unit === 'word' ? prevWordBoundary(text, offset) : prevDeleteBoundary(text, offset);
  return editor.update(
    (tr) => {
      const p = deleteRange(tr, { id, offset: start }, { id, offset });
      tr.select(textSel(p.id, p.offset)).scroll();
    },
    { group: 'delete' },
  );
};

export const deleteForward: CommandFn = (editor, unit: 'char' | 'word' | 'line' = 'char') => {
  const sel = editor.selection;
  if (!sel || editor.readOnly) return false;
  if (!isCollapsed(sel)) return deleteSelection(editor);
  const { doc, schema } = editor;
  const { id, offset } = (sel as any).focus as Point;
  const block = doc.get(id)!;
  const text = block.text;
  if (offset < text.length) {
    let end = unit === 'word' ? nextWordBoundary(text, offset) : nextGrapheme(text, offset);
    if (unit === 'line') {
      const nl = text.indexOf('\n', offset);
      end = nl < 0 ? text.length : nl === offset ? offset + 1 : nl;
    }
    return editor.update(
      (tr) => {
        const sug = suggesting(editor);
        deleteRange(tr, { id, offset }, { id, offset: end });
        tr.select(textSel(id, sug ? end : offset));
      },
      { group: 'delete' },
    );
  }
  const next = doc.next(block);
  if (!next) return true;
  if (isoAncestor(editor, next) !== isoAncestor(editor, block) && !doc.isAncestor(block, next)) {
    if (schema.node(next.type)?.isolating) return true;
  }
  return editor.update((tr) => {
    if (!schema.isText(next)) {
      if (schema.node(next.type)?.isolating || (schema.kind(next) === 'container' && next.type !== 'unknown')) {
        const t = firstTextBlock(doc, schema, next);
        if (t && isoAncestor(editor, t) === isoAncestor(editor, block)) {
          deleteRange(tr, { id, offset }, { id: t.id, offset: 0 });
          tr.select(textSel(id, offset));
          return;
        }
      }
      tr.select(blockSel([next.id]));
      return;
    }
    deleteRange(tr, { id, offset }, { id: next.id, offset: 0 });
    tr.select(textSel(id, offset));
  });
};

/* ------------------------------------------------------------------ inserting */

export const insertText: CommandFn = (editor, text: string, opts: { marks?: MarkSet; rules?: boolean } = {}) => {
  const sel = editor.selection;
  if (!sel || editor.readOnly || typeof text !== 'string') return false;
  if (sel.type === 'cell') return false;
  const { doc, schema } = editor;
  let handled = false;
  const ok = editor.update(
    (tr) => {
      let p: Point;
      if (sel.type === 'block') {
        const blocks = topMost(doc, sel.ids);
        removeBlocks(tr, blocks, true);
        const s = tr.selection as any;
        p = s.focus;
      } else {
        const r = selRange(doc, sel);
        p = r.collapsed ? r.from : deleteRange(tr, r.from, r.to);
        if (!r.collapsed && suggesting(editor)) p = r.to;
      }
      const block = doc.get(p.id)!;
      const spec = schema.node(block.type)!;
      let marks = opts.marks ?? typingMarks(editor, block, p.offset);
      const sug = suggesting(editor);
      if (sug && !spec.code) {
        const near = marksAt(block.content, p.offset)?.suggestion;
        const sid = near && near.kind === 'insert' && near.author === sug.author ? near.id : newId();
        const { suggestion: _drop, ...rest } = marks ?? {};
        marks = { ...rest, suggestion: { id: sid, kind: 'insert', author: sug.author, at: near?.id === sid ? near.at : Date.now() } };
      } else if (marks?.suggestion) {
        const { suggestion: _drop, ...rest } = marks;
        marks = rest;
      }
      const clean = spec.code ? text : text.replace(/\r\n?/g, '\n');
      tr.replaceText(p.id, p.offset, p.offset, clean, spec.code || spec.marks === false ? undefined : marks);
      tr.select(textSel(p.id, p.offset + clean.length)).scroll();
      if (editor.storedMarks) tr.setMeta('storedMarks', editor.storedMarks);
      handled = true;
    },
    // consecutive typing merges into one undo entry until a pause (history delay) or another kind of edit
    { group: 'type' },
  );
  if (ok && handled && opts.rules !== false) runInputRules(editor);
  return ok;
};

/** Apply the first matching input rule at the caret. The rule becomes its own undo entry. */
export function runInputRules(editor: Editor): boolean {
  const sel = editor.selection;
  if (!sel || !isCollapsed(sel) || sel.type !== 'text' || suggesting(editor)) return false;
  const block = editor.doc.get(sel.focus.id);
  if (!block) return false;
  const spec = editor.schema.node(block.type);
  const offset = sel.focus.offset;
  const start = Math.max(0, offset - 300);
  const before = contentText(sliceInline(block.content, start, offset));
  for (const rule of editor.inputRules) {
    if (spec?.code && !rule.inCode) continue;
    const m = rule.match.exec(before);
    if (!m) continue;
    editor.cutHistory();
    const from = start + m.index;
    if (rule.run(editor, m, { block, from, to: offset })) {
      editor.cutHistory();
      return true;
    }
  }
  return false;
}

export const insertLineBreak: CommandFn = (editor) => insertText(editor, '\n', { rules: false });

export const splitBlock: CommandFn = (editor) => {
  const sel = editor.selection;
  if (!sel || editor.readOnly) return false;
  const { doc, schema } = editor;
  if (sel.type === 'block') {
    const blocks = topMost(doc, sel.ids);
    const last = blocks[blocks.length - 1];
    if (!last) return false;
    return editor.update((tr) => {
      const para = schema.create('paragraph');
      const host = schema.canContain(last.parent!, 'paragraph') ? last : topLevel(editor, last);
      tr.insertAfter(host.id, [para]);
      tr.select(textSel(para.id, 0)).scroll();
    });
  }
  if (sel.type !== 'text') return false;
  editor.cutHistory();
  return editor.update((tr) => {
    const r = selRange(doc, sel);
    const p = r.collapsed ? r.from : deleteRange(tr, r.from, r.to);
    const block = doc.get(p.id)!;
    const spec = schema.node(block.type)!;
    const parent = block.parent!;
    if (spec.code) {
      const text = block.text;
      if (p.offset === text.length && text.endsWith('\n') && schema.canContain(parent, 'paragraph')) {
        // empty last line: leave the code block
        tr.replaceText(block.id, text.length - 1, text.length);
        const para = schema.create('paragraph');
        tr.insertAfter(block.id, [para]);
        tr.select(textSel(para.id, 0)).scroll();
        return;
      }
      // keep the indentation of the current line
      const lineStart = text.lastIndexOf('\n', p.offset - 1) + 1;
      const indent = /^[ \t]*/.exec(text.slice(lineStart, p.offset))![0];
      tr.replaceText(block.id, p.offset, p.offset, '\n' + indent);
      tr.select(textSel(block.id, p.offset + 1 + indent.length)).scroll();
      return;
    }
    if (block.length === 0 && !block.children) {
      if (schema.isText(parent) && (spec.continues || block.type === 'paragraph')) {
        liftOut(tr, block);
        tr.select(textSel(block.id, 0)).scroll();
        return;
      }
      if (block.type !== 'paragraph' && (spec.continues || block.type === 'quote')) {
        tr.setType(block.id, 'paragraph');
        tr.select(textSel(block.id, 0));
        return;
      }
      if (block.type === 'paragraph' && schema.kind(parent) === 'container' && !schema.node(parent.type)!.isolating && block.index === parent.children!.length - 1 && parent.children!.length > 1) {
        // empty last paragraph of a callout-like container: leave the container
        const gp = parent.parent!;
        if (schema.canContain(gp, 'paragraph')) {
          tr.move([block.id], gp.id, parent.index + 1);
          tr.select(textSel(block.id, 0)).scroll();
          return;
        }
      }
    }
    const tail = sliceInline(block.content, p.offset);
    const atStart = p.offset === 0 && block.length > 0;
    let type = spec.continues ? block.type : 'paragraph';
    let attrs: Attrs | undefined;
    if (spec.continues) {
      attrs = { ...block.attrs };
      if ('checked' in attrs) attrs.checked = false;
    } else if (block.attrs.align || block.attrs.indent) attrs = { align: block.attrs.align, indent: block.attrs.indent };
    if (!schema.canContain(parent, type)) type = schema.defaultChild(schema.node(parent.type)!);
    if (atStart && !spec.continues) {
      // Enter at the start of a heading/quote: push it down, keep its type
      const para = schema.create(type, attrs);
      tr.insertBefore(block.id, [para]);
      tr.select(textSel(block.id, 0)).scroll();
      return;
    }
    const nb = schema.create(type, attrs, tail);
    tr.replaceText(block.id, p.offset, block.length);
    if (block.type === 'toggle' && block.attrs.open !== false && schema.canContain(block, 'paragraph') && p.offset > 0) {
      tr.insert(block.id, 0, [nb]);
    } else if (block.children && spec.continues && p.offset > 0) {
      // list item with children: the new item goes first among the children's level only when
      // splitting in the middle would otherwise orphan them; keep children with the original
      tr.insertAfter(block.id, [nb]);
    } else tr.insertAfter(block.id, [nb]);
    tr.select(textSel(nb.id, 0)).scroll();
  });
};

function topLevel(editor: Editor, b: Block): Block {
  let cur = b;
  while (cur.parent && !editor.schema.canContain(cur.parent, 'paragraph')) cur = cur.parent;
  return cur;
}

/**
 * Insert blocks at the selection. An empty paragraph under the caret is replaced; otherwise the
 * blocks are inserted after the current block. Returns the inserted ids via `opts.out`.
 */
export const insertBlocks: CommandFn = (editor, blocks: BlockJSON[], opts: { select?: boolean; after?: string; replace?: string } = {}) => {
  if (editor.readOnly || !blocks?.length) return false;
  const { doc, schema } = editor;
  const clean = schema.sanitizeBlocks(blocks, doc);
  if (!clean.length) return false;
  return editor.update((tr) => {
    const sel = editor.selection;
    let anchor: Block | null = null;
    let replace = false;
    if (opts.replace && doc.get(opts.replace)) {
      anchor = doc.get(opts.replace)!;
      replace = true;
    } else if (opts.after && doc.get(opts.after)) anchor = doc.get(opts.after)!;
    else if (sel?.type === 'text') {
      if (!isCollapsed(sel)) {
        const r = selRange(doc, sel);
        const p = deleteRange(tr, r.from, r.to);
        anchor = doc.get(p.id)!;
      } else anchor = doc.get(sel.focus.id)!;
      replace = !!anchor && anchor.type === 'paragraph' && anchor.length === 0 && !anchor.children;
    } else if (sel?.type === 'block') {
      const b = topMost(doc, sel.ids);
      anchor = b[b.length - 1] ?? null;
    } else if (sel?.type === 'cell') anchor = lastTextBlock(doc, schema, doc.get(sel.focus)!);
    if (!anchor) anchor = doc.last();
    let parent: Block = anchor ? anchor.parent! : doc.root;
    let index = anchor ? anchor.index + 1 : 0;
    // climb until the parent accepts every block
    while (parent !== doc.root && !clean.every((b) => b.type === 'unknown' || schema.canContain(parent, b.type))) {
      index = parent.index + 1;
      parent = parent.parent!;
      replace = false;
    }
    if (replace && anchor) {
      index = anchor.index;
      tr.remove(anchor.id);
    }
    tr.insert(parent.id, index, clean);
    if (opts.select !== false) {
      const lastJ = clean[clean.length - 1];
      const last = doc.get(lastJ.id)!;
      const t = lastTextBlock(doc, schema, last);
      const firstT = clean.length === 1 ? firstTextBlock(doc, schema, last) : t;
      if (firstT && clean.length === 1 && schema.kind(last) !== 'text') tr.select(textSel(firstT.id, 0));
      else if (t) tr.select(textSel(t.id, t.length));
      else {
        // atom: keep typing possible after it
        if (last.nextSibling === null && schema.canContain(parent, 'paragraph')) {
          const para = schema.create('paragraph');
          tr.insertAfter(last.id, [para]);
          tr.select(textSel(para.id, 0));
        } else {
          const nt = last.nextSibling && schema.isText(last.nextSibling) ? last.nextSibling : null;
          tr.select(nt ? textSel(nt.id, 0) : blockSel([last.id]));
        }
      }
    }
    tr.scroll();
  });
};

export const insertBlock: CommandFn = (editor, type: string, attrs?: Attrs, opts?: any) => {
  if (!editor.schema.node(type)) return false;
  return insertBlocks(editor, [editor.schema.create(type, attrs)], opts);
};

export const insertInline: CommandFn = (editor, atom: InlineAtom, opts: { trailingSpace?: boolean } = {}) => {
  const sel = editor.selection;
  if (!sel || sel.type !== 'text' || editor.readOnly) return false;
  const { doc, schema } = editor;
  return editor.update((tr) => {
    const r = selRange(doc, sel);
    const p = r.collapsed ? r.from : deleteRange(tr, r.from, r.to);
    const block = doc.get(p.id)!;
    if (schema.node(block.type)?.code) {
      const t = schema.node(atom.atom)?.toText?.(atom) ?? '';
      tr.replaceText(p.id, p.offset, p.offset, t);
      tr.select(textSel(p.id, p.offset + t.length));
      return;
    }
    const ins: Inline[] = [{ atom: atom.atom, attrs: schema.parseAttrs(schema.node(atom.atom)?.attrs, atom.attrs, true) }];
    if (opts.trailingSpace) ins.push({ text: ' ' });
    tr.replaceText(p.id, p.offset, p.offset, ins);
    tr.select(textSel(p.id, p.offset + contentLength(ins))).scroll();
  });
};

/* ------------------------------------------------------------------ marks */

/** True when every selected character has the mark (or stored/typing marks for a caret). */
export function isMarkActive(editor: Editor, type: string, value?: any): boolean {
  const sel = editor.selection;
  if (!sel) return false;
  const test = (m: MarkSet | undefined) => m?.[type] !== undefined && (value === undefined || jsonEq(m[type], value));
  if (isCollapsed(sel) && sel.type === 'text') {
    const b = editor.doc.get(sel.focus.id);
    if (!b) return false;
    if (editor.storedMarks) return test(editor.storedMarks);
    return test(typingMarks(editor, b, sel.focus.offset)) || (editor.schema.marks.get(type)?.inclusive === false && test(marksAt(b.content, sel.focus.offset)) && sel.focus.offset > 0 && test(inlineAt(b.content, sel.focus.offset)?.marks));
  }
  let any = false;
  for (const r of selectedRanges(editor)) {
    if (editor.schema.node(r.block.type)?.code) continue;
    for (const c of sliceInline(r.block.content, r.from, r.to)) {
      if (!test(c.marks)) return false;
      any = true;
    }
  }
  return any;
}
/** Value of a mark at the selection start (e.g. link href, color). */
export function markValue(editor: Editor, type: string): any {
  const sel = editor.selection;
  if (!sel) return undefined;
  if (sel.type === 'text' && isCollapsed(sel)) {
    const b = editor.doc.get(sel.focus.id);
    if (!b) return undefined;
    if (editor.storedMarks && type in editor.storedMarks) return editor.storedMarks[type];
    return (inlineAt(b.content, sel.focus.offset)?.marks ?? marksAt(b.content, sel.focus.offset))?.[type] ?? marksAt(b.content, sel.focus.offset)?.[type];
  }
  for (const r of selectedRanges(editor)) for (const c of sliceInline(r.block.content, r.from, r.to)) if (c.marks?.[type] !== undefined) return c.marks[type];
  return undefined;
}

function applyMark(editor: Editor, type: string, value: any | null, ranges = selectedRanges(editor)): boolean {
  const spec = editor.schema.marks.get(type);
  return editor.update((tr) => {
    for (const r of ranges) {
      const ns = editor.schema.node(r.block.type);
      if (r.to <= r.from || ns?.code || ns?.marks === false) continue;
      const next = mapMarks(r.block.content, r.from, r.to, (m) => {
        const out: MarkSet = { ...(m ?? {}) };
        if (value === null) delete out[type];
        else {
          out[type] = value;
          for (const ex of spec?.excludes ?? []) delete out[ex];
        }
        return out;
      });
      tr.step({ t: 'text', id: r.block.id, from: r.from, to: r.to, insert: next });
    }
    tr.select(editor.selection);
  });
}

export const setMark: CommandFn = (editor, type: string, value: any = true) => {
  const sel = editor.selection;
  if (!sel || editor.readOnly) return false;
  const spec = editor.schema.marks.get(type);
  if (spec?.attrs && typeof value === 'object') {
    value = editor.schema.parseMarks({ [type]: value })?.[type];
    if (value === undefined) return false;
  }
  if (sel.type === 'text' && isCollapsed(sel)) {
    const b = editor.doc.get(sel.focus.id);
    if (!b) return false;
    const base = { ...(editor.storedMarks ?? typingMarks(editor, b, sel.focus.offset) ?? {}) };
    base[type] = value;
    for (const ex of spec?.excludes ?? []) delete base[ex];
    editor.setStoredMarks(base);
    return true;
  }
  return applyMark(editor, type, value);
};
export const unsetMark: CommandFn = (editor, type: string) => {
  const sel = editor.selection;
  if (!sel || editor.readOnly) return false;
  if (sel.type === 'text' && isCollapsed(sel)) {
    const b = editor.doc.get(sel.focus.id);
    if (!b) return false;
    const base = { ...(editor.storedMarks ?? typingMarks(editor, b, sel.focus.offset) ?? {}) };
    delete base[type];
    editor.setStoredMarks(base);
    return true;
  }
  return applyMark(editor, type, null);
};
export const toggleMark: CommandFn = (editor, type: string, value: any = true) =>
  isMarkActive(editor, type) ? unsetMark(editor, type) : setMark(editor, type, value);

const KEEP_ON_CLEAR = new Set(['comment', 'suggestion']);
export const clearFormatting: CommandFn = (editor) => {
  if (editor.readOnly) return false;
  const ranges = selectedRanges(editor);
  return editor.update((tr) => {
    for (const r of ranges) {
      if (r.to > r.from) {
        const next = mapMarks(r.block.content, r.from, r.to, (m) => {
          if (!m) return m;
          const out: MarkSet = {};
          for (const k in m) if (KEEP_ON_CLEAR.has(k)) out[k] = m[k];
          return out;
        });
        tr.step({ t: 'text', id: r.block.id, from: r.from, to: r.to, insert: next });
      }
      if (r.block.attrs.align) tr.setAttrs(r.block.id, { align: undefined });
    }
    tr.select(editor.selection);
  });
};

/** Range of the run around `offset` carrying mark `type` with one value. */
export function markRangeAt(block: Block, offset: number, type: string): { from: number; to: number; value: any } | null {
  let pos = 0;
  let cur: { from: number; to: number; value: any } | null = null;
  for (const c of block.content ?? []) {
    const len = isAtom(c) ? 1 : c.text.length;
    const v = c.marks?.[type];
    if (v !== undefined) {
      if (cur && cur.to === pos && jsonEq(cur.value, v)) cur.to = pos + len;
      else {
        if (cur && offset >= cur.from && offset <= cur.to) return cur;
        cur = { from: pos, to: pos + len, value: v };
      }
    } else {
      if (cur && offset >= cur.from && offset <= cur.to) return cur;
      cur = null;
    }
    pos += len;
  }
  return cur && offset >= cur.from && offset <= cur.to ? cur : null;
}

export const setLink: CommandFn = (editor, href: string, opts: { text?: string; title?: string } = {}) => {
  const sel = editor.selection;
  if (!sel || editor.readOnly) return false;
  const value = editor.schema.parseMarks({ link: { href, title: opts.title } })?.link;
  if (!value) return false;
  if (sel.type === 'text' && isCollapsed(sel)) {
    const b = editor.doc.get(sel.focus.id)!;
    const run = markRangeAt(b, sel.focus.offset, 'link');
    if (run && !opts.text) return applyMark(editor, 'link', value, [{ block: b, from: run.from, to: run.to }]);
    const text = opts.text || href;
    return editor.update((tr) => {
      const marks = { ...(typingMarks(editor, b, sel.focus.offset) ?? {}), link: value };
      tr.replaceText(b.id, sel.focus.offset, sel.focus.offset, text, marks);
      tr.select(textSel(b.id, sel.focus.offset + text.length));
    });
  }
  return applyMark(editor, 'link', value);
};
export const unsetLink: CommandFn = (editor) => {
  const sel = editor.selection;
  if (!sel || editor.readOnly) return false;
  if (sel.type === 'text' && isCollapsed(sel)) {
    const b = editor.doc.get(sel.focus.id)!;
    const run = markRangeAt(b, sel.focus.offset, 'link');
    if (!run) return false;
    return applyMark(editor, 'link', null, [{ block: b, from: run.from, to: run.to }]);
  }
  return applyMark(editor, 'link', null);
};

/* ------------------------------------------------------------------ block types */

function targetTextBlocks(editor: Editor): Block[] {
  const seen = new Set<string>();
  const out: Block[] = [];
  for (const r of selectedRanges(editor))
    if (!seen.has(r.block.id)) {
      seen.add(r.block.id);
      out.push(r.block);
    }
  return out;
}

export const setBlockType: CommandFn = (editor, type: string, attrs?: Attrs, ids?: string[]) => {
  const spec = editor.schema.node(type);
  if (!spec || spec.kind !== 'text' || editor.readOnly) return false;
  const blocks = ids ? ids.map((i) => editor.doc.get(i)!).filter((b) => b && editor.schema.isText(b)) : targetTextBlocks(editor);
  if (!blocks.length) return false;
  return editor.update((tr) => {
    for (const stale of blocks) {
      // earlier iterations may have re-created blocks (moves): always look up by id
      const b = editor.doc.get(stale.id);
      if (!b || !b.parent || !editor.schema.canContain(b.parent, type)) continue;
      if (spec.code || spec.marks === false) {
        const plain = adapt(editor, b.content ?? [], { type } as Block);
        if (!jsonEq(plain, b.content)) tr.step({ t: 'text', id: b.id, from: 0, to: b.length, insert: plain });
      }
      if (b.children && spec.children !== true) {
        // target type cannot nest: children become following siblings
        const kids = b.children.map((c) => c.id);
        tr.move(kids, b.parent!.id, b.index + 1);
      }
      tr.setType(b.id, type, attrs);
    }
    tr.select(editor.selection);
  });
};

export function isBlockActive(editor: Editor, type: string, attrs?: Attrs): boolean {
  const blocks = targetTextBlocks(editor);
  if (!blocks.length) return false;
  return blocks.every((b) => b.type === type && (!attrs || Object.keys(attrs).every((k) => jsonEq(b.attrs[k], attrs[k]))));
}
export const toggleBlockType: CommandFn = (editor, type: string, attrs?: Attrs) =>
  isBlockActive(editor, type, attrs) ? setBlockType(editor, 'paragraph') : setBlockType(editor, type, attrs);

export const setAlign: CommandFn = (editor, align: 'left' | 'center' | 'right' | 'justify') => {
  if (editor.readOnly) return false;
  const blocks = targetTextBlocks(editor).filter((b) => editor.schema.node(b.type)?.attrs?.align);
  const atoms = editor.selection?.type === 'block' ? selectedBlocks(editor).filter((b) => editor.schema.node(b.type)?.attrs?.align) : [];
  const all = [...new Set([...blocks, ...atoms])];
  if (!all.length) return false;
  return editor.update((tr) => {
    for (const b of all) tr.setAttrs(b.id, { align: align === 'left' ? undefined : align });
    tr.select(editor.selection);
  });
};

const MAX_INDENT = 8;
function nests(editor: Editor, b: Block): boolean {
  const spec = editor.schema.node(b.type);
  if (!spec) return false;
  if (spec.continues) return true;
  return editor.mode === 'block' || editor.schema.isText(b.parent);
}

export const indent: CommandFn = (editor) => {
  if (editor.readOnly) return false;
  const { schema } = editor;
  const blocks = selectedBlocks(editor);
  if (!blocks.length) return false;
  let did = false;
  const ok = editor.update((tr) => {
    // group contiguous siblings so they nest under the same previous sibling
    let i = 0;
    while (i < blocks.length) {
      const b = blocks[i];
      let j = i;
      while (j + 1 < blocks.length && blocks[j + 1].parent === b.parent && blocks[j + 1].index === blocks[j].index + 1) j++;
      const group = blocks.slice(i, j + 1);
      i = j + 1;
      const prev = b.prevSibling;
      if (nests(editor, b) && prev && schema.node(prev.type)?.children === true && group.every((g) => schema.canContain(prev, g.type) || g.type === 'unknown')) {
        if (tr.move(group.map((g) => g.id), prev.id, prev.children?.length ?? 0)) {
          did = true;
          if (prev.type === 'toggle' && prev.attrs.open === false) tr.setAttrs(prev.id, { open: true });
        }
      } else
        for (const g of group) {
          if (schema.node(g.type)?.attrs?.indent && !schema.node(g.type)?.continues && (g.attrs.indent ?? 0) < MAX_INDENT) {
            tr.setAttrs(g.id, { indent: (g.attrs.indent ?? 0) + 1 });
            did = true;
          }
        }
    }
    tr.select(editor.selection);
  });
  return ok && did;
};

export const outdent: CommandFn = (editor) => {
  if (editor.readOnly) return false;
  const { schema } = editor;
  const blocks = selectedBlocks(editor);
  if (!blocks.length) return false;
  let did = false;
  const ok = editor.update((tr) => {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = editor.doc.get(blocks[i].id);
      if (!b) continue;
      if ((b.attrs.indent ?? 0) > 0) {
        tr.setAttrs(b.id, { indent: b.attrs.indent - 1 || undefined });
        did = true;
      } else if (schema.isText(b.parent) && schema.canContain(b.parent!.parent!, b.type)) {
        // siblings after the group stay with the old parent unless this is the last selected one
        const lastOfGroup = i === blocks.length - 1 || blocks[i + 1].parent !== b.parent;
        if (lastOfGroup) liftOut(tr, b);
        else {
          const p = b.parent!;
          tr.move([b.id], p.parent!.id, p.index + 1);
        }
        did = true;
      }
    }
    tr.select(editor.selection);
  });
  return ok && did;
};

export const toggleCheck: CommandFn = (editor, id?: string) => {
  if (editor.readOnly) return false;
  const blocks = id ? [editor.doc.get(id)!].filter(Boolean) : targetTextBlocks(editor);
  const items = blocks.filter((b) => b.type === 'list' && b.attrs.kind === 'check');
  if (!items.length) return false;
  const to = !items.every((b) => b.attrs.checked);
  return editor.update((tr) => {
    for (const b of items) tr.setAttrs(b.id, { checked: to });
    tr.select(editor.selection);
  });
};

/* ------------------------------------------------------------------ block operations */

function idsOrSelection(editor: Editor, ids?: string[]): Block[] {
  if (ids && ids.length) return topMost(editor.doc, ids);
  return selectedBlocks(editor);
}

export const deleteBlocks: CommandFn = (editor, ids?: string[]) => {
  if (editor.readOnly) return false;
  const blocks = idsOrSelection(editor, ids);
  if (!blocks.length) return false;
  return editor.update((tr) => removeBlocks(tr, blocks));
};

export const duplicateBlocks: CommandFn = (editor, ids?: string[]) => {
  if (editor.readOnly) return false;
  const blocks = idsOrSelection(editor, ids);
  if (!blocks.length) return false;
  return editor.update((tr) => {
    const last = blocks[blocks.length - 1];
    const copies = blocks.map((b) => cloneWithNewIds(b.toJSON()));
    tr.insert(last.parent!.id, last.index + 1, copies);
    tr.select(blockSel(copies.map((c) => c.id))).scroll();
  });
};

function contiguous(blocks: Block[]): boolean {
  for (let i = 1; i < blocks.length; i++) if (blocks[i].parent !== blocks[0].parent || blocks[i].index !== blocks[i - 1].index + 1) return false;
  return true;
}

export const moveBlocksUp: CommandFn = (editor, ids?: string[]) => {
  if (editor.readOnly) return false;
  const blocks = idsOrSelection(editor, ids);
  if (!blocks.length || !contiguous(blocks)) return false;
  const first = blocks[0];
  const parent = first.parent!;
  const sel = editor.selection;
  if (first.index === 0) {
    // leave a nesting parent: move in front of it
    if (!editor.schema.isText(parent) || !blocks.every((b) => editor.schema.canContain(parent.parent!, b.type))) return false;
    return editor.update((tr) => {
      tr.move(blocks.map((b) => b.id), parent.parent!.id, parent.index);
      tr.select(sel).scroll();
    });
  }
  return editor.update((tr) => {
    tr.move(blocks.map((b) => b.id), parent.id, first.index - 1);
    tr.select(sel).scroll();
  });
};
export const moveBlocksDown: CommandFn = (editor, ids?: string[]) => {
  if (editor.readOnly) return false;
  const blocks = idsOrSelection(editor, ids);
  if (!blocks.length || !contiguous(blocks)) return false;
  const last = blocks[blocks.length - 1];
  const parent = last.parent!;
  const sel = editor.selection;
  if (last.index === parent.children!.length - 1) {
    if (!editor.schema.isText(parent) || !blocks.every((b) => editor.schema.canContain(parent.parent!, b.type))) return false;
    return editor.update((tr) => {
      tr.move(blocks.map((b) => b.id), parent.parent!.id, parent.index + 1);
      tr.select(sel).scroll();
    });
  }
  return editor.update((tr) => {
    tr.move(blocks.map((b) => b.id), parent.id, last.index + 2);
    tr.select(sel).scroll();
  });
};

/** Move blocks next to / into a target block. Used by drag and drop. Invalid moves return false. */
export const moveBlocksTo: CommandFn = (editor, ids: string[], targetId: string, place: 'before' | 'after' | 'inside' = 'after') => {
  if (editor.readOnly) return false;
  const { doc, schema } = editor;
  const blocks = topMost(doc, ids);
  const target = doc.get(targetId);
  if (!blocks.length || !target || target === doc.root) return false;
  if (blocks.some((b) => b === target || doc.isAncestor(b, target))) return false;
  let parent: Block;
  let index: number;
  if (place === 'inside') {
    if (schema.node(target.type)?.children !== true && schema.kind(target) !== 'container') return false;
    parent = target;
    index = target.children?.length ?? 0;
  } else {
    parent = target.parent!;
    index = target.index + (place === 'after' ? 1 : 0);
  }
  let moved = false;
  const ok = editor.update((tr) => {
    moved = tr.move(blocks.map((b) => b.id), parent.id, index);
    if (moved) tr.select(blockSel(blocks.map((b) => b.id)));
  });
  return ok && moved;
};

export const selectBlocks: CommandFn = (editor, ids: string[]) => {
  const blocks = topMost(editor.doc, ids);
  if (!blocks.length) return false;
  editor.setSelection(blockSel(blocks.map((b) => b.id)));
  return true;
};

export const selectAll: CommandFn = (editor) => {
  const { doc, schema } = editor;
  const sel = editor.selection;
  const cur = sel?.type === 'text' ? doc.get(sel.focus.id) : sel?.type === 'block' ? doc.get(sel.ids[0]) : sel?.type === 'cell' ? doc.get(sel.focus) : null;
  // scope: the isolating region that holds the selection (table cell, column, page) or the document
  let scope: Block = doc.root;
  if (cur) scope = isoAncestor(editor, cur) ?? doc.root;
  if (sel?.type === 'text' && cur) {
    const r = selRange(doc, sel);
    const wholeBlock = r.from.id === r.to.id && r.from.offset === 0 && r.to.offset === cur.length;
    if (editor.mode === 'block' && !wholeBlock && cur.length > 0) {
      editor.setSelection(textSel(cur.id, 0, cur.id, cur.length));
      return true;
    }
    const first = firstTextBlock(doc, schema, scope === doc.root ? undefined : scope);
    const last = lastTextBlock(doc, schema, scope === doc.root ? undefined : scope);
    const coversScope = first && last && r.from.id === first.id && r.from.offset === 0 && r.to.id === last.id && r.to.offset === last.length;
    if (coversScope && scope !== doc.root) {
      // second press inside a region: widen to the next enclosing scope
      const outer = isoAncestor(editor, scope) ?? doc.root;
      if (scope.type === 'table_cell') {
        const table = doc.closest(scope, (x) => x.type === 'table');
        if (table) {
          const cells = [...doc.descendants(table)].filter((x) => x.type === 'table_cell');
          editor.setSelection({ type: 'cell', table: table.id, anchor: cells[0].id, focus: cells[cells.length - 1].id });
          return true;
        }
      }
      scope = outer;
    }
    if (editor.mode === 'block') {
      editor.setSelection(blockSel(scope.children!.map((b) => b.id)));
      return true;
    }
    const f2 = firstTextBlock(doc, schema, scope === doc.root ? undefined : scope);
    const l2 = lastTextBlock(doc, schema, scope === doc.root ? undefined : scope);
    if (f2 && l2) editor.setSelection(textSel(f2.id, 0, l2.id, l2.length));
    return true;
  }
  if (sel?.type === 'block' && cur) scope = isoAncestor(editor, cur) ?? doc.root;
  editor.setSelection(blockSel(scope.children!.map((b) => b.id)));
  return true;
};

/** Wrap the selected top-level blocks in a container block (callout, columns...). */
export const wrapIn: CommandFn = (editor, type: string, attrs?: Attrs, ids?: string[]) => {
  const spec = editor.schema.node(type);
  if (!spec || spec.kind !== 'container' || editor.readOnly) return false;
  const blocks = idsOrSelection(editor, ids);
  if (!blocks.length || !contiguous(blocks)) return false;
  const parent = blocks[0].parent!;
  if (!editor.schema.canContain(parent, type) || !blocks.every((b) => editor.schema.canContain({ type }, b.type))) return false;
  return editor.update((tr) => {
    const index = blocks[0].index;
    const json = blocks.map((b) => b.toJSON());
    const sel = editor.selection;
    tr.removeAt(parent.id, index, blocks.length);
    const wrapper = editor.schema.create(type, attrs, undefined, json);
    tr.insert(parent.id, index, [wrapper]);
    tr.select(sel);
  });
};

/** Replace a container by its children. */
export const unwrap: CommandFn = (editor, id?: string) => {
  if (editor.readOnly) return false;
  const { doc, schema } = editor;
  let target = id ? doc.get(id) : null;
  if (!target) {
    const b = selectedBlocks(editor)[0];
    target = b ? (schema.kind(b) === 'container' ? b : doc.closest(b.parent, (x) => schema.kind(x) === 'container' && !schema.node(x.type)?.isolating)) : null;
  }
  if (!target || schema.kind(target) !== 'container' || !target.parent) return false;
  const t = target;
  if (!t.children!.every((c) => schema.canContain(t.parent!, c.type) || c.type === 'unknown')) return false;
  return editor.update((tr) => {
    const sel = editor.selection;
    const kids = t.children!.map((c) => c.toJSON());
    const parent = t.parent!.id;
    const index = t.index;
    tr.removeAt(parent, index, 1);
    tr.insert(parent, index, kids);
    tr.select(sel?.type === 'block' ? blockSel(kids.map((k) => k.id)) : sel);
  });
};

export const setBlockAttrs: CommandFn = (editor, id: string, attrs: Attrs) => {
  if (editor.readOnly || !editor.doc.get(id)) return false;
  const b = editor.doc.get(id)!;
  const spec = editor.schema.node(b.type);
  // validate known attrs through the schema
  const patch: Attrs = {};
  for (const k in attrs) {
    const s = spec?.attrs?.[k];
    let v = attrs[k];
    if (v !== undefined && s?.validate) {
      try {
        v = s.validate(v);
      } catch {
        v = undefined;
      }
      if (v === undefined) v = s.default;
    }
    patch[k] = v;
  }
  return editor.update((tr) => {
    tr.setAttrs(id, patch);
  });
};

export const undo: CommandFn = (editor) => !editor.readOnly && editor.undo();
export const redo: CommandFn = (editor) => !editor.readOnly && editor.redo();

export const coreCommands: Record<string, CommandFn> = {
  insertText,
  insertLineBreak,
  splitBlock,
  deleteSelection,
  deleteBackward,
  deleteForward,
  insertBlocks,
  insertBlock,
  insertInline,
  setMark,
  unsetMark,
  toggleMark,
  clearFormatting,
  setLink,
  unsetLink,
  setBlockType,
  toggleBlockType,
  setAlign,
  indent,
  outdent,
  toggleCheck,
  deleteBlocks,
  duplicateBlocks,
  moveBlocksUp,
  moveBlocksDown,
  moveBlocksTo,
  selectBlocks,
  selectAll,
  wrapIn,
  unwrap,
  setBlockAttrs,
  undo,
  redo,
};

declare module './editor' {
  interface Commands {
    insertText(text: string, opts?: { marks?: MarkSet; rules?: boolean }): boolean;
    insertLineBreak(): boolean;
    splitBlock(): boolean;
    deleteSelection(): boolean;
    deleteBackward(unit?: 'char' | 'word' | 'line'): boolean;
    deleteForward(unit?: 'char' | 'word' | 'line'): boolean;
    insertBlocks(blocks: BlockJSON[], opts?: { select?: boolean; after?: string; replace?: string }): boolean;
    insertBlock(type: string, attrs?: Attrs, opts?: { select?: boolean; after?: string; replace?: string }): boolean;
    insertInline(atom: InlineAtom, opts?: { trailingSpace?: boolean }): boolean;
    setMark(type: string, value?: any): boolean;
    unsetMark(type: string): boolean;
    toggleMark(type: string, value?: any): boolean;
    clearFormatting(): boolean;
    setLink(href: string, opts?: { text?: string; title?: string }): boolean;
    unsetLink(): boolean;
    setBlockType(type: string, attrs?: Attrs, ids?: string[]): boolean;
    toggleBlockType(type: string, attrs?: Attrs): boolean;
    setAlign(align: 'left' | 'center' | 'right' | 'justify'): boolean;
    indent(): boolean;
    outdent(): boolean;
    toggleCheck(id?: string): boolean;
    deleteBlocks(ids?: string[]): boolean;
    duplicateBlocks(ids?: string[]): boolean;
    moveBlocksUp(ids?: string[]): boolean;
    moveBlocksDown(ids?: string[]): boolean;
    moveBlocksTo(ids: string[], targetId: string, place?: 'before' | 'after' | 'inside'): boolean;
    selectBlocks(ids: string[]): boolean;
    selectAll(): boolean;
    wrapIn(type: string, attrs?: Attrs, ids?: string[]): boolean;
    unwrap(id?: string): boolean;
    setBlockAttrs(id: string, attrs: Attrs): boolean;
    undo(): boolean;
    redo(): boolean;
  }
}
