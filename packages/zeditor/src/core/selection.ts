import { Block, Doc, splitsPair } from './model';
import { Schema } from './schema';
import { Step, mapOffset } from './steps';

export interface Point {
  id: string;
  offset: number;
}
export interface TextSelection {
  type: 'text';
  anchor: Point;
  focus: Point;
}
/** One or more whole blocks. `ids` are top-most selected blocks in document order. */
export interface BlockSelection {
  type: 'block';
  ids: string[];
  /** block where the selection started (for shift-extension) */
  anchor?: string;
}
/** Rectangular range of table cells between two cells of the same table. */
export interface CellSelection {
  type: 'cell';
  table: string;
  anchor: string;
  focus: string;
}
export type Selection = TextSelection | BlockSelection | CellSelection;

export const textSel = (id: string, offset: number, focusId = id, focusOffset = offset): TextSelection => ({
  type: 'text',
  anchor: { id, offset },
  focus: { id: focusId, offset: focusOffset },
});
export const blockSel = (ids: string[], anchor?: string): BlockSelection => ({ type: 'block', ids, anchor: anchor ?? ids[0] });

export function isCollapsed(sel: Selection | null): boolean {
  return !!sel && sel.type === 'text' && sel.anchor.id === sel.focus.id && sel.anchor.offset === sel.focus.offset;
}
export function selEq(a: Selection | null, b: Selection | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.type !== b.type) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function comparePoints(doc: Doc, a: Point, b: Point): number {
  if (a.id === b.id) return a.offset - b.offset;
  const ba = doc.get(a.id);
  const bb = doc.get(b.id);
  if (!ba || !bb) return 0;
  return doc.compare(ba, bb);
}

export interface Range {
  from: Point;
  to: Point;
  backward: boolean;
  collapsed: boolean;
}
export function selRange(doc: Doc, sel: TextSelection): Range {
  const c = comparePoints(doc, sel.anchor, sel.focus);
  return c <= 0
    ? { from: sel.anchor, to: sel.focus, backward: false, collapsed: c === 0 }
    : { from: sel.focus, to: sel.anchor, backward: true, collapsed: false };
}

/** Text blocks from `from` to `to` inclusive, in document order. */
export function textBlocksBetween(doc: Doc, schema: Schema, fromId: string, toId: string): Block[] {
  const out: Block[] = [];
  let cur = doc.get(fromId) ?? null;
  const end = doc.get(toId);
  while (cur) {
    if (schema.isText(cur)) out.push(cur);
    if (cur === end) break;
    cur = doc.next(cur);
  }
  return out;
}
/** All blocks (any kind) from `from` to `to` inclusive, in document order. */
export function blocksBetween(doc: Doc, fromId: string, toId: string): Block[] {
  const out: Block[] = [];
  let cur = doc.get(fromId) ?? null;
  const end = doc.get(toId);
  while (cur) {
    out.push(cur);
    if (cur === end) break;
    cur = doc.next(cur);
  }
  return out;
}

export function firstTextBlock(doc: Doc, schema: Schema, within?: Block): Block | null {
  if (within && schema.isText(within)) return within;
  for (const b of doc.descendants(within)) if (schema.isText(b)) return b;
  return null;
}
export function lastTextBlock(doc: Doc, schema: Schema, within?: Block): Block | null {
  let last: Block | null = within && schema.isText(within) ? within : null;
  for (const b of doc.descendants(within)) if (schema.isText(b)) last = b;
  return last;
}
export function nextTextBlock(doc: Doc, schema: Schema, b: Block): Block | null {
  let cur = doc.next(b);
  while (cur && !schema.isText(cur)) cur = doc.next(cur);
  return cur;
}
export function prevTextBlock(doc: Doc, schema: Schema, b: Block): Block | null {
  let cur = doc.prev(b);
  while (cur && !schema.isText(cur)) cur = doc.prev(cur);
  return cur;
}

/** Reduce a list of blocks to the top-most ones (drop blocks whose ancestor is also listed), in doc order. */
export function topMost(doc: Doc, ids: Iterable<string>): Block[] {
  const set = new Set(ids);
  const out: Block[] = [];
  for (const id of set) {
    const b = doc.get(id);
    if (!b || b === doc.root) continue;
    let p = b.parent;
    let covered = false;
    while (p) {
      if (set.has(p.id)) {
        covered = true;
        break;
      }
      p = p.parent;
    }
    if (!covered) out.push(b);
  }
  return out.sort((a, b) => doc.compare(a, b));
}

/**
 * Map a selection through steps that were already applied to `doc`.
 *
 * `foreign` marks steps the user did not make (another author, a server update). Text such a
 * step inserts exactly at the caret goes *after* the caret, and text inserted at an edge of
 * a selection stays outside it. Without this, two people typing at one position push each
 * other's caret forward and their characters interleave.
 */
export function mapSelection(sel: Selection | null, steps: readonly Step[], doc: Doc, schema: Schema, foreign = false): Selection | null {
  if (!sel) return null;
  if (sel.type === 'text') {
    let a = sel.anchor.offset;
    let f = sel.focus.offset;
    let aSide: -1 | 1 = 1;
    let fSide: -1 | 1 = 1;
    if (foreign) {
      const sameBlock = sel.anchor.id === sel.focus.id;
      if (sameBlock && a === f) aSide = fSide = -1;
      else {
        const ab = doc.get(sel.anchor.id);
        const fb = doc.get(sel.focus.id);
        const forward = sameBlock || !ab || !fb ? a <= f : doc.compare(ab, fb) < 0;
        // the end of the range stays put, the start moves right
        if (forward) fSide = -1;
        else aSide = -1;
      }
    }
    for (const s of steps) {
      a = mapOffset(s, sel.anchor.id, a, aSide);
      f = mapOffset(s, sel.focus.id, f, fSide);
    }
    // a range whose text was all removed must not come back inverted
    if (foreign && sel.anchor.id === sel.focus.id && sel.anchor.offset !== sel.focus.offset && (sel.anchor.offset < sel.focus.offset ? a > f : a < f)) a = f = Math.min(a, f);
    return fixSelection({ type: 'text', anchor: { id: sel.anchor.id, offset: a }, focus: { id: sel.focus.id, offset: f } }, doc, schema);
  }
  return fixSelection(sel, doc, schema);
}

/** Make a selection valid for the document (clamp offsets, drop missing blocks). */
export function fixSelection(sel: Selection | null, doc: Doc, schema: Schema): Selection | null {
  if (!sel) return null;
  if (sel.type === 'text') {
    const fix = (p: Point): Point | null => {
      const b = doc.get(p.id);
      if (b && schema.isText(b)) {
        let offset = Math.max(0, Math.min(p.offset, b.length));
        // a caret can never sit inside a surrogate pair (stale or foreign positions can point there)
        if (splitsPair(b.content, offset)) offset--;
        return { id: p.id, offset };
      }
      return null;
    };
    let a = fix(sel.anchor);
    let f = fix(sel.focus);
    if (!a && !f) {
      const b = doc.get(sel.focus.id) ?? doc.get(sel.anchor.id);
      if (b && b !== doc.root && !schema.isText(b)) return { type: 'block', ids: [b.id], anchor: b.id };
      const t = firstTextBlock(doc, schema);
      return t ? textSel(t.id, 0) : null;
    }
    a ??= f!;
    f ??= a;
    return { type: 'text', anchor: a, focus: f };
  }
  if (sel.type === 'block') {
    const ids = sel.ids.filter((id) => doc.has(id) && id !== 'root');
    if (!ids.length) {
      const t = firstTextBlock(doc, schema);
      return t ? textSel(t.id, 0) : null;
    }
    return { type: 'block', ids, anchor: sel.anchor && doc.has(sel.anchor) ? sel.anchor : ids[0] };
  }
  const t = doc.get(sel.table);
  const a = doc.get(sel.anchor);
  const f = doc.get(sel.focus);
  if (t && a && f && doc.isAncestor(t, a) && doc.isAncestor(t, f)) return sel;
  const cell = a ?? f;
  const tb = cell ? firstTextBlock(doc, schema, cell) : firstTextBlock(doc, schema);
  return tb ? textSel(tb.id, 0) : null;
}
