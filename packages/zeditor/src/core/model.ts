/**
 * Document model. Browser independent.
 *
 * A document is a tree of blocks. A block is one of four kinds (declared by its NodeSpec):
 *  - text:      has inline `content`, and optionally nested `children` blocks
 *  - container: has `children` blocks only
 *  - atom:      has neither (image, divider, embed ...)
 * Inline content is a flat array of text spans and inline atoms. Each inline atom
 * occupies exactly one offset unit; text occupies one unit per UTF-16 code unit.
 */

export type Attrs = Record<string, any>;
/** mark type -> `true` or an attrs object */
export type MarkSet = Record<string, any>;

export interface TextSpan {
  text: string;
  marks?: MarkSet;
}
export interface InlineAtom {
  atom: string;
  attrs?: Attrs;
  marks?: MarkSet;
}
export type Inline = TextSpan | InlineAtom;

export interface BlockJSON {
  id: string;
  type: string;
  attrs?: Attrs;
  content?: Inline[];
  children?: BlockJSON[];
}

export interface DocJSON {
  format: 'zeditor';
  version: number;
  /** schema versions of extensions that were installed when the document was saved */
  extensions?: Record<string, number>;
  blocks: BlockJSON[];
}

/** Placeholder character used when inline atoms are flattened to text. */
export const OBJ = '￼';

export const isAtom = (n: Inline): n is InlineAtom => (n as InlineAtom).atom !== undefined;
export const inlineLen = (n: Inline): number => (isAtom(n) ? 1 : n.text.length);

export function contentLength(content: readonly Inline[] | undefined): number {
  let n = 0;
  if (content) for (const c of content) n += inlineLen(c);
  return n;
}

/** Text of inline content. Atoms become `atomText` (default U+FFFC) so offsets stay aligned. */
export function contentText(content: readonly Inline[] | undefined, atomText: string | ((a: InlineAtom) => string) = OBJ): string {
  let s = '';
  if (content)
    for (const c of content) s += isAtom(c) ? (typeof atomText === 'string' ? atomText : atomText(c)) : c.text;
  return s;
}

function stable(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
/** Deterministic structural equality for plain JSON values. */
export function jsonEq(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  return stable(a) === stable(b);
}
export function marksEq(a: MarkSet | undefined, b: MarkSet | undefined): boolean {
  const ae = !a || Object.keys(a).length === 0;
  const be = !b || Object.keys(b).length === 0;
  if (ae || be) return ae && be;
  return stable(a) === stable(b);
}
export function cleanMarks(m: MarkSet | undefined): MarkSet | undefined {
  if (!m) return undefined;
  for (const _ in m) return m;
  return undefined;
}

/** Merge adjacent equal-mark spans and drop empty text. Returns a new array. */
export function normalizeInline(content: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const c of content) {
    if (isAtom(c)) {
      out.push(c.marks && !cleanMarks(c.marks) ? { atom: c.atom, attrs: c.attrs } : c);
      continue;
    }
    if (!c.text) continue;
    const last = out[out.length - 1];
    if (last && !isAtom(last) && marksEq(last.marks, c.marks)) {
      out[out.length - 1] = last.marks ? { text: last.text + c.text, marks: last.marks } : { text: last.text + c.text };
    } else {
      const m = cleanMarks(c.marks);
      out.push(m ? { text: c.text, marks: m } : { text: c.text });
    }
  }
  return out;
}

export function sliceInline(content: readonly Inline[] | undefined, from: number, to = Infinity): Inline[] {
  const out: Inline[] = [];
  if (!content || to <= from) return out;
  let pos = 0;
  for (const c of content) {
    const len = inlineLen(c);
    const end = pos + len;
    if (end > from && pos < to) {
      if (isAtom(c)) out.push(c);
      else {
        const s = Math.max(0, from - pos);
        const e = Math.min(len, to - pos);
        const text = c.text.slice(s, e);
        if (text) out.push(c.marks ? { text, marks: c.marks } : { text });
      }
    }
    pos = end;
    if (pos >= to) break;
  }
  return out;
}

export function replaceInline(content: readonly Inline[] | undefined, from: number, to: number, insert: readonly Inline[]): Inline[] {
  return normalizeInline([...sliceInline(content, 0, from), ...insert, ...sliceInline(content, to)]);
}

/** Marks of the character before `offset` (or after it at offset 0). */
export function marksAt(content: readonly Inline[] | undefined, offset: number): MarkSet | undefined {
  if (!content || !content.length) return undefined;
  let pos = 0;
  for (const c of content) {
    const end = pos + inlineLen(c);
    if (offset <= end && (offset > pos || offset === 0)) return c.marks;
    pos = end;
  }
  return content[content.length - 1].marks;
}

export function inlineAt(content: readonly Inline[] | undefined, offset: number): Inline | undefined {
  let pos = 0;
  if (content)
    for (const c of content) {
      const end = pos + inlineLen(c);
      if (offset >= pos && offset < end) return c;
      pos = end;
    }
  return undefined;
}

/** Apply `fn` to the marks of every inline in [from, to). */
export function mapMarks(
  content: readonly Inline[] | undefined,
  from: number,
  to: number,
  fn: (marks: MarkSet | undefined, node: Inline) => MarkSet | undefined,
): Inline[] {
  const mid = sliceInline(content, from, to).map((c) => {
    const m = cleanMarks(fn(c.marks, c));
    if (isAtom(c)) return m ? { atom: c.atom, attrs: c.attrs, marks: m } : { atom: c.atom, attrs: c.attrs };
    return m ? { text: c.text, marks: m } : { text: c.text };
  });
  return mid;
}

/** Iterate ranges of a mark: yields [from, to, attrs] for maximal runs with equal mark value. */
export function markRanges(content: readonly Inline[] | undefined, type: string): { from: number; to: number; value: any }[] {
  const out: { from: number; to: number; value: any }[] = [];
  let pos = 0;
  if (content)
    for (const c of content) {
      const len = inlineLen(c);
      const v = c.marks?.[type];
      if (v !== undefined) {
        const last = out[out.length - 1];
        if (last && last.to === pos && jsonEq(last.value, v)) last.to = pos + len;
        else out.push({ from: pos, to: pos + len, value: v });
      }
      pos += len;
    }
  return out;
}

let idGen: () => string = () => {
  const a = new Uint8Array(9);
  const c = (globalThis as any).crypto;
  if (c?.getRandomValues) c.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  let s = '';
  for (const b of a) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36];
  return 'b' + s;
};
export const newId = (): string => idGen();
/** Replace the id generator (useful for deterministic tests). */
export function setIdGenerator(fn: () => string): void {
  idGen = fn;
}

export class Block {
  parent: Block | null = null;
  constructor(
    public id: string,
    public type: string,
    public attrs: Attrs,
    public content: Inline[] | undefined,
    public children: Block[] | undefined,
  ) {
    if (children) for (const c of children) c.parent = this;
  }
  get index(): number {
    return this.parent ? this.parent.children!.indexOf(this) : -1;
  }
  get length(): number {
    return contentLength(this.content);
  }
  get text(): string {
    return contentText(this.content);
  }
  get prevSibling(): Block | null {
    const i = this.index;
    return i > 0 ? this.parent!.children![i - 1] : null;
  }
  get nextSibling(): Block | null {
    const i = this.index;
    return i >= 0 && i < this.parent!.children!.length - 1 ? this.parent!.children![i + 1] : null;
  }
  toJSON(): BlockJSON {
    const j: BlockJSON = { id: this.id, type: this.type };
    let has = false;
    for (const _ in this.attrs) {
      has = true;
      break;
    }
    if (has) j.attrs = JSON.parse(JSON.stringify(this.attrs));
    if (this.content) j.content = JSON.parse(JSON.stringify(this.content));
    if (this.children) j.children = this.children.map((c) => c.toJSON());
    return j;
  }
}

export const ROOT_ID = 'root';

/** Mutable document tree with an id index. Mutate only through steps. */
export class Doc {
  root: Block;
  private byId = new Map<string, Block>();

  constructor(blocks: Block[] = []) {
    this.root = new Block(ROOT_ID, 'doc', {}, undefined, blocks);
    this.byId.set(ROOT_ID, this.root);
    for (const b of blocks) this.index(b);
  }
  index(b: Block): void {
    this.byId.set(b.id, b);
    if (b.children) for (const c of b.children) this.index(c);
  }
  unindex(b: Block): void {
    if (this.byId.get(b.id) === b) this.byId.delete(b.id);
    if (b.children) for (const c of b.children) this.unindex(c);
  }
  get(id: string): Block | undefined {
    return this.byId.get(id);
  }
  has(id: string): boolean {
    return this.byId.has(id);
  }
  get size(): number {
    return this.byId.size - 1;
  }
  get blocks(): Block[] {
    return this.root.children!;
  }

  /** Next block in document order (pre-order). */
  next(b: Block, skipChildren = false): Block | null {
    if (!skipChildren && b.children && b.children.length) return b.children[0];
    let cur: Block | null = b;
    while (cur && cur !== this.root) {
      const n = cur.nextSibling;
      if (n) return n;
      cur = cur.parent;
    }
    return null;
  }
  /** Previous block in document order. */
  prev(b: Block): Block | null {
    const p = b.prevSibling;
    if (p) {
      let d = p;
      while (d.children && d.children.length) d = d.children[d.children.length - 1];
      return d;
    }
    return b.parent && b.parent !== this.root ? b.parent : null;
  }
  first(): Block | null {
    return this.root.children![0] ?? null;
  }
  last(): Block | null {
    let d: Block = this.root;
    while (d.children && d.children.length) d = d.children[d.children.length - 1];
    return d === this.root ? null : d;
  }
  *descendants(of: Block = this.root): Generator<Block> {
    if (of.children)
      for (const c of of.children) {
        yield c;
        yield* this.descendants(c);
      }
  }
  /** -1 if a is before b in document order, 1 if after, 0 if same. */
  compare(a: Block, b: Block): number {
    if (a === b) return 0;
    const pa = this.path(a);
    const pb = this.path(b);
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
    return pa.length < pb.length ? -1 : 1;
  }
  path(b: Block): number[] {
    const p: number[] = [];
    let cur: Block | null = b;
    while (cur && cur.parent) {
      p.unshift(cur.index);
      cur = cur.parent;
    }
    return p;
  }
  isAncestor(anc: Block, b: Block): boolean {
    let cur = b.parent;
    while (cur) {
      if (cur === anc) return true;
      cur = cur.parent;
    }
    return false;
  }
  ancestors(b: Block): Block[] {
    const out: Block[] = [];
    let cur = b.parent;
    while (cur && cur !== this.root) {
      out.push(cur);
      cur = cur.parent;
    }
    return out;
  }
  closest(b: Block | null | undefined, pred: (b: Block) => boolean): Block | null {
    let cur: Block | null | undefined = b;
    while (cur && cur !== this.root) {
      if (pred(cur)) return cur;
      cur = cur.parent;
    }
    return null;
  }
  toJSON(): BlockJSON[] {
    return this.root.children!.map((b) => b.toJSON());
  }
}

export function blockFromPlain(j: BlockJSON): Block {
  return new Block(
    j.id,
    j.type,
    j.attrs ? { ...j.attrs } : {},
    j.content ? normalizeInline(j.content) : undefined,
    j.children ? j.children.map(blockFromPlain) : undefined,
  );
}

/** Deep clone block JSON with fresh ids. `idMap` receives old -> new. */
export function cloneWithNewIds(j: BlockJSON, idMap?: Map<string, string>): BlockJSON {
  const id = newId();
  idMap?.set(j.id, id);
  const out: BlockJSON = { ...JSON.parse(JSON.stringify({ ...j, children: undefined })), id };
  if (j.children) out.children = j.children.map((c) => cloneWithNewIds(c, idMap));
  else delete out.children;
  return out;
}
