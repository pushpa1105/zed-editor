import { createHeadlessEditor, Editor, textSel, BlockJSON, setIdGenerator, HeadlessOptions } from '../../src/core';

let n = 0;
export function resetIds() {
  n = 0;
  setIdGenerator(() => 'i' + (++n).toString(36));
}
export const p = (text: string, id?: string): BlockJSON => ({ id: id ?? 'p' + ++n, type: 'paragraph', content: text ? [{ text }] : [] });
export function make(blocks: BlockJSON[] = [p('', 'a')], opts: HeadlessOptions = {}): Editor {
  return createHeadlessEditor({ content: blocks, ...opts });
}
/** text of all text blocks, joined by | */
export function texts(e: Editor): string {
  const out: string[] = [];
  for (const b of e.doc.descendants()) if (b.content) out.push(b.text);
  return out.join('|');
}
export function caret(e: Editor, id: string, offset: number, fid = id, foff = offset) {
  e.setSelection(textSel(id, offset, fid, foff));
}
export function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** structural invariants that must hold after every transaction */
export function checkInvariants(e: Editor) {
  const seen = new Set<string>();
  const walk = (b: any, parent: any) => {
    if (seen.has(b.id)) throw new Error('duplicate id ' + b.id);
    seen.add(b.id);
    if (e.doc.get(b.id) !== b) throw new Error('index mismatch ' + b.id);
    if (b.parent !== parent) throw new Error('parent mismatch ' + b.id);
    const kind = b.type === 'unknown' ? 'atom' : e.schema.kind(b);
    if (!kind) throw new Error('block of unregistered type ' + b.type);
    if (kind === 'text' && !Array.isArray(b.content)) throw new Error('text block without content ' + b.id);
    if (kind === 'text' && b.children && !b.children.length) throw new Error('empty children array on text block ' + b.id);
    if (kind === 'container' && !e.schema.node(b.type)!.allowEmpty && !(b.children && b.children.length)) throw new Error('empty container ' + b.type);
    if (kind === 'atom' && (b.content || b.children)) throw new Error('atom with content');
    if (parent !== e.doc.root && b.type !== 'unknown' && !e.schema.canContain(parent, b.type)) throw new Error(`${b.type} not allowed in ${parent.type}`);
    if (b.content)
      for (let i = 0; i < b.content.length; i++) {
        const y = b.content[i];
        if (!('atom' in y) && !y.text) throw new Error('empty span');
        if (i === 0) continue;
        const x = b.content[i - 1];
        if (!('atom' in x) && !('atom' in y) && JSON.stringify(x.marks ?? {}) === JSON.stringify(y.marks ?? {})) throw new Error('unmerged spans in ' + b.id);
      }
    for (const c of b.children ?? []) walk(c, b);
  };
  for (const b of e.doc.blocks) walk(b, e.doc.root);
  if (seen.size !== e.doc.size) throw new Error(`index size ${e.doc.size} != tree size ${seen.size}`);
  if (!e.doc.blocks.length) throw new Error('empty document');
  const s = e.selection;
  if (s?.type === 'text') {
    for (const pt of [s.anchor, s.focus]) {
      const b = e.doc.get(pt.id);
      if (!b || !b.content) throw new Error('selection points at missing/non-text block');
      if (pt.offset < 0 || pt.offset > b.length) throw new Error('selection offset out of range');
    }
  } else if (s?.type === 'block') for (const id of s.ids) if (!e.doc.has(id)) throw new Error('block selection of missing block');
}
