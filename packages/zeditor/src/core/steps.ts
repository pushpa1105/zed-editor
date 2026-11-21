import { Attrs, Block, BlockJSON, Doc, Inline, blockFromPlain, contentLength, replaceInline, sliceInline } from './model';

export type Step =
  /** replace inline content [from, to) of a text block */
  | { t: 'text'; id: string; from: number; to: number; insert: Inline[] }
  /** replace the type and/or the whole attrs object of a block */
  | { t: 'attrs'; id: string; type?: string; attrs?: Attrs }
  /** insert blocks as children of `parent` ('root' for top level) */
  | { t: 'insert'; parent: string; index: number; blocks: BlockJSON[] }
  | { t: 'remove'; parent: string; index: number; count: number };

export class StepError extends Error {}

/** Apply a step in place and return its inverse. Throws StepError when it does not fit. */
export function applyStep(doc: Doc, step: Step): Step {
  switch (step.t) {
    case 'text': {
      const b = doc.get(step.id);
      if (!b || !b.content) throw new StepError(`text step: no text block ${step.id}`);
      const len = contentLength(b.content);
      if (step.from < 0 || step.to < step.from || step.to > len) throw new StepError(`text step out of range in ${step.id}`);
      const removed = sliceInline(b.content, step.from, step.to);
      b.content = replaceInline(b.content, step.from, step.to, step.insert);
      return { t: 'text', id: step.id, from: step.from, to: step.from + contentLength(step.insert), insert: removed };
    }
    case 'attrs': {
      const b = doc.get(step.id);
      if (!b) throw new StepError(`attrs step: no block ${step.id}`);
      const inv: Step = { t: 'attrs', id: step.id };
      if (step.type !== undefined) {
        inv.type = b.type;
        b.type = step.type;
      }
      if (step.attrs !== undefined) {
        inv.attrs = b.attrs;
        b.attrs = step.attrs;
      }
      return inv;
    }
    case 'insert': {
      const p = doc.get(step.parent);
      if (!p) throw new StepError(`insert step: no parent ${step.parent}`);
      if (!p.children) p.children = [];
      if (step.index < 0 || step.index > p.children.length) throw new StepError('insert step: index out of range');
      const blocks = step.blocks.map(blockFromPlain);
      const ids = new Set<string>();
      const check = (x: Block) => {
        if (doc.has(x.id) || ids.has(x.id)) throw new StepError(`insert step: duplicate id ${x.id}`);
        ids.add(x.id);
        x.children?.forEach(check);
      };
      blocks.forEach(check);
      for (const b of blocks) {
        b.parent = p;
        doc.index(b);
      }
      p.children.splice(step.index, 0, ...blocks);
      return { t: 'remove', parent: step.parent, index: step.index, count: blocks.length };
    }
    case 'remove': {
      const p = doc.get(step.parent);
      if (!p || !p.children) throw new StepError(`remove step: no parent ${step.parent}`);
      if (step.index < 0 || step.count < 0 || step.index + step.count > p.children.length) throw new StepError('remove step: out of range');
      const removed = p.children.splice(step.index, step.count);
      const json = removed.map((b) => b.toJSON());
      for (const b of removed) {
        doc.unindex(b);
        b.parent = null;
      }
      if (!p.children.length && p.content) p.children = undefined;
      return { t: 'insert', parent: step.parent, index: step.index, blocks: json };
    }
  }
}

/** Map an offset in block `id` through a step. `assoc` decides the side at an insertion point. */
export function mapOffset(step: Step, id: string, offset: number, assoc: -1 | 1 = 1): number {
  if (step.t !== 'text' || step.id !== id) return offset;
  const ins = contentLength(step.insert);
  const del = step.to - step.from;
  if (offset < step.from) return offset;
  if (offset > step.to) return offset + ins - del;
  if (del === ins && del > 0) return offset; // same-size replace (mark change): keep
  if (del === 0) return offset === step.from && assoc < 0 ? offset : offset + ins;
  if (offset === step.from) return offset;
  return step.from + ins;
}

/** Id of the block whose own state a step changes (for rendering and listeners). */
export function touched(step: Step): string {
  return step.t === 'text' || step.t === 'attrs' ? step.id : step.parent;
}
