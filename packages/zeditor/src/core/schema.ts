import { Attrs, Block, BlockJSON, Doc, DocJSON, Inline, InlineAtom, MarkSet, newId, normalizeInline } from './model';

export interface AttrSpec {
  default?: any;
  /** Return the sanitized value, or `undefined` to fall back to the default. */
  validate?: (value: any) => any;
}

export type NodeKind = 'text' | 'container' | 'atom' | 'inline';

/** Minimal element shape produced by the built-in HTML parser. */
export interface HtmlEl {
  tag: string;
  attrs: Record<string, string>;
  children: (HtmlEl | string)[];
  style: Record<string, string>;
  classes: string[];
  parent?: HtmlEl;
}

export interface ParseRule {
  /** lower-case tag name, or '*' */
  tag: string;
  /** extra predicate; return false to skip */
  match?: (el: HtmlEl) => boolean;
  /** attrs for the created node / mark; return false to skip the rule */
  getAttrs?: (el: HtmlEl) => Attrs | undefined | false;
  priority?: number;
}

export interface NodeSpec {
  type: string;
  kind: NodeKind;
  attrs?: Record<string, AttrSpec>;
  /** container: allowed child types (default: any block). text: `true` allows nested child blocks. */
  children?: boolean | string[];
  /** text blocks: allow marks (default true) */
  marks?: boolean;
  /** text blocks: plain text, whitespace preserved, Enter inserts a newline */
  code?: boolean;
  /** selection and joins do not cross this node's boundary (table cells, columns) */
  isolating?: boolean;
  /** only valid inside these parent types */
  parents?: string[];
  /** child type created to keep a container non-empty (default 'paragraph') */
  defaultChild?: string;
  /** container may have zero children (table rows fully covered by merged cells) */
  allowEmpty?: boolean;
  /** Enter on this text block continues with the same type (lists) */
  continues?: boolean;
  /** DOM renderer, see view/render.ts NodeRenderer */
  render?: any;
  parseHTML?: ParseRule[];
  toHTML?: (node: any, ctx: any) => string;
  toMarkdown?: (node: any, ctx: any) => string;
  toText?: (node: any) => string;
  /** name of the extension that registered the spec */
  extension?: string;
}

export interface MarkSpec {
  type: string;
  attrs?: Record<string, AttrSpec>;
  /** typing at the end of the mark extends it (default true) */
  inclusive?: boolean;
  /** mark types removed when this one is applied */
  excludes?: string[];
  /** outer-to-inner render order, lower renders outermost (default 50) */
  rank?: number;
  render?: any;
  parseHTML?: ParseRule[];
  toHTML?: (value: any) => [open: string, close: string];
  toMarkdown?: (value: any) => [open: string, close: string];
  extension?: string;
}

export interface Migration {
  /** document version this migration upgrades from (to `from + 1`) */
  from: number;
  migrate: (doc: DocJSON) => DocJSON;
}

export const DOC_VERSION = 1;

const SAFE = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|[^:/?#]*(?:[/?#]|$))/i;
/** Returns the URL if it uses an allowed scheme, otherwise ''. */
export function safeUrl(url: unknown, opts: { image?: boolean } = {}): string {
  if (typeof url !== 'string') return '';
  const u = url.trim();
  if (!u) return '';
  // browsers ignore whitespace and control characters inside the scheme
  const compact = u.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, '');
  if (opts.image && (/^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i.test(compact) || /^blob:/i.test(compact))) return u;
  return SAFE.test(compact) ? u : '';
}

export function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

const BAD_KEY = (k: string) => k === '__proto__' || k === 'constructor' || k === 'prototype';

export class Schema {
  nodes = new Map<string, NodeSpec>();
  marks = new Map<string, MarkSpec>();
  migrations: Migration[] = [];
  /** extension name -> schemaVersion, written into saved documents */
  extensionVersions: Record<string, number> = {};
  extensionMigrations: Record<string, (doc: DocJSON, from: number) => DocJSON> = {};

  node(type: string): NodeSpec | undefined {
    return this.nodes.get(type);
  }
  kind(b: { type: string }): NodeKind | undefined {
    return this.nodes.get(b.type)?.kind;
  }
  isText(b: { type: string } | null | undefined): boolean {
    return !!b && this.nodes.get(b.type)?.kind === 'text';
  }
  isContainer(b: { type: string } | null | undefined): boolean {
    return !!b && (b.type === 'doc' || this.nodes.get(b.type)?.kind === 'container');
  }
  isAtom(b: { type: string } | null | undefined): boolean {
    return !!b && (b.type === 'unknown' || this.nodes.get(b.type)?.kind === 'atom');
  }
  /** Can `parent` hold a child of `type`? */
  canContain(parent: { type: string }, type: string): boolean {
    const child = this.nodes.get(type);
    if (!child || child.kind === 'inline') return false;
    if (child.parents && !child.parents.includes(parent.type)) return false;
    if (parent.type === 'doc') return true;
    const spec = this.nodes.get(parent.type);
    if (!spec) return false;
    if (spec.kind === 'container') return Array.isArray(spec.children) ? spec.children.includes(type) : true;
    if (spec.kind === 'text') return spec.children === true;
    return false;
  }

  defaults(type: string, attrs?: Attrs): Attrs {
    const spec = this.nodes.get(type);
    const out: Attrs = {};
    if (spec?.attrs) for (const k in spec.attrs) if (spec.attrs[k].default !== undefined) out[k] = clone(spec.attrs[k].default);
    if (attrs) for (const k in attrs) if (attrs[k] !== undefined) out[k] = attrs[k];
    return out;
  }

  /** Build block JSON with a fresh id and default attrs. Containers get a default child. */
  create(type: string, attrs?: Attrs, content?: Inline[] | string, children?: BlockJSON[]): BlockJSON {
    const spec = this.nodes.get(type);
    if (!spec) throw new Error(`zeditor: unknown node type "${type}"`);
    const j: BlockJSON = { id: newId(), type };
    const a = this.defaults(type, attrs);
    if (Object.keys(a).length) j.attrs = a;
    if (spec.kind === 'text') {
      j.content = typeof content === 'string' ? (content ? [{ text: content }] : []) : content ? normalizeInline(content) : [];
      if (children && children.length) j.children = children;
    } else if (spec.kind === 'container') {
      j.children = children && children.length ? children : children && spec.allowEmpty ? [] : [this.create(this.defaultChild(spec))];
    }
    return j;
  }
  defaultChild(spec: NodeSpec): string {
    return spec.defaultChild ?? (Array.isArray(spec.children) ? spec.children[0] : undefined) ?? 'paragraph';
  }

  /* ---------------------------------------------------------------- load */

  migrate(input: DocJSON): DocJSON {
    let doc = input;
    let v = typeof doc.version === 'number' ? doc.version : 1;
    const ms = [...this.migrations].sort((a, b) => a.from - b.from);
    for (const m of ms)
      if (m.from === v) {
        doc = m.migrate(doc);
        v = m.from + 1;
        doc.version = v;
      }
    const saved = doc.extensions ?? {};
    for (const name in this.extensionMigrations) {
      const cur = this.extensionVersions[name] ?? 1;
      const from = saved[name];
      if (typeof from === 'number' && from < cur) doc = this.extensionMigrations[name](doc, from);
    }
    return doc;
  }

  /**
   * Validate and sanitize untrusted JSON. Never throws for malformed blocks: bad parts are
   * repaired or dropped and reported in `issues`. Unknown block types are preserved as inert
   * `unknown` blocks which serialize back to their original JSON.
   */
  parse(input: unknown): { blocks: Block[]; issues: string[] } {
    const issues: string[] = [];
    let json: DocJSON;
    if (Array.isArray(input)) json = { format: 'zeditor', version: DOC_VERSION, blocks: input as BlockJSON[] };
    else if (input && typeof input === 'object' && Array.isArray((input as any).blocks)) json = input as DocJSON;
    else {
      if (input != null) issues.push('document is not an object with a "blocks" array');
      json = { format: 'zeditor', version: DOC_VERSION, blocks: [] };
    }
    if (typeof json.version === 'number' && json.version > DOC_VERSION)
      issues.push(`document version ${json.version} is newer than supported version ${DOC_VERSION}`);
    try {
      json = this.migrate(clone(json));
    } catch (e: any) {
      issues.push('migration failed: ' + (e?.message ?? e));
    }
    const seen = new Set<string>(['root']);
    const blocks = this.parseBlocks(json.blocks, { type: 'doc' }, seen, issues);
    if (!blocks.length) blocks.push(this.parseBlock(this.create('paragraph'), seen, issues)!);
    return { blocks, issues };
  }

  private parseBlocks(list: unknown, parent: { type: string }, seen: Set<string>, issues: string[]): Block[] {
    const out: Block[] = [];
    if (!Array.isArray(list)) return out;
    for (const raw of list) {
      const b = this.parseBlock(raw, seen, issues);
      if (!b) continue;
      if (b.type !== 'unknown' && !this.canContain(parent, b.type)) {
        issues.push(`block "${b.type}" is not allowed inside "${parent.type}"; dropped`);
        continue;
      }
      out.push(b);
    }
    return out;
  }

  parseBlock(raw: any, seen: Set<string>, issues: string[]): Block | null {
    if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') {
      issues.push('dropped a block without a type');
      return null;
    }
    // An `unknown` wrapper saved by a client lacking the extension: unwrap and retry.
    if (raw.type === 'unknown' && raw.attrs?.raw && typeof raw.attrs.raw.type === 'string' && raw.attrs.raw.type !== 'unknown')
      return this.parseBlock(raw.attrs.raw, seen, issues);
    let id = typeof raw.id === 'string' && /^[\w:.-]{1,64}$/.test(raw.id) ? raw.id : '';
    if (!id || seen.has(id)) {
      if (id) issues.push(`duplicate block id "${id}" was regenerated`);
      id = newId();
    }
    seen.add(id);
    const spec = this.nodes.get(raw.type);
    if (!spec || spec.kind === 'inline') {
      let safe: any;
      try {
        safe = clone({ ...raw, id });
      } catch {
        issues.push('dropped a non-serializable block');
        return null;
      }
      return new Block(id, 'unknown', { raw: safe }, undefined, undefined);
    }
    const attrs = this.parseAttrs(spec.attrs, raw.attrs, true);
    let content: Inline[] | undefined;
    let children: Block[] | undefined;
    if (spec.kind === 'text') {
      content = this.parseInline(raw.content, spec, issues);
      if (spec.children === true && Array.isArray(raw.children) && raw.children.length) {
        children = this.parseBlocks(raw.children, raw, seen, issues);
        if (!children.length) children = undefined;
      }
    } else if (spec.kind === 'container') {
      children = this.parseBlocks(raw.children, raw, seen, issues);
      if (!children.length && !spec.allowEmpty) children = [this.parseBlock(this.create(this.defaultChild(spec)), seen, issues)!];
    }
    return new Block(id, raw.type, attrs, content, children);
  }

  parseAttrs(specs: Record<string, AttrSpec> | undefined, raw: any, keepExtra: boolean): Attrs {
    const out: Attrs = {};
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (keepExtra)
      for (const k of Object.keys(src)) {
        if (BAD_KEY(k) || specs?.[k]) continue;
        const v = src[k];
        const t = typeof v;
        if (v === null || t === 'string' || t === 'number' || t === 'boolean') out[k] = v;
        else if (t === 'object') {
          try {
            out[k] = clone(v);
          } catch {
            /* drop */
          }
        }
      }
    if (specs)
      for (const k in specs) {
        const s = specs[k];
        let v = src[k];
        if (v !== undefined && s.validate) {
          try {
            v = s.validate(v);
          } catch {
            v = undefined;
          }
        }
        if (v === undefined && s.default !== undefined) v = s.default;
        if (v !== undefined) out[k] = typeof v === 'object' && v !== null ? clone(v) : v;
      }
    return out;
  }

  parseMarks(raw: any): MarkSet | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    let out: MarkSet | undefined;
    for (const k of Object.keys(raw)) {
      if (BAD_KEY(k)) continue;
      const spec = this.marks.get(k);
      let v = raw[k];
      if (v === false || v == null) continue;
      if (spec) {
        if (spec.attrs) {
          const a = this.parseAttrs(spec.attrs, typeof v === 'object' ? v : {}, false);
          let ok = true;
          for (const ak in spec.attrs) if (spec.attrs[ak].default === undefined && (a[ak] === undefined || a[ak] === '')) ok = false;
          if (!ok) continue;
          v = a;
        } else v = true;
      } else {
        try {
          v = clone(v);
        } catch {
          continue;
        }
      }
      (out ??= {})[k] = v;
    }
    return out;
  }

  parseInline(raw: any, spec: NodeSpec | undefined, issues: string[]): Inline[] {
    const out: Inline[] = [];
    if (typeof raw === 'string') return raw ? [{ text: raw }] : [];
    if (!Array.isArray(raw)) return out;
    const allowMarks = !spec || (spec.marks !== false && !spec.code);
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const marks = allowMarks ? this.parseMarks(r.marks) : undefined;
      if (typeof r.atom === 'string') {
        if (spec?.code) continue;
        const as = this.nodes.get(r.atom);
        let attrs: Attrs;
        if (as && as.kind === 'inline') attrs = this.parseAttrs(as.attrs, r.attrs, true);
        else {
          try {
            attrs = r.attrs && typeof r.attrs === 'object' ? clone(r.attrs) : {};
          } catch {
            continue;
          }
        }
        const a: InlineAtom = { atom: r.atom, attrs };
        if (marks) a.marks = marks;
        out.push(a);
      } else if (typeof r.text === 'string') {
        // strip characters that can never be valid document text
        const text = r.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￼]/g, '').replace(/\r\n?/g, '\n');
        if (text) out.push(marks ? { text, marks } : { text });
      } else issues.push('dropped invalid inline content');
    }
    return normalizeInline(out);
  }

  /** Serialize a block for storage; unknown blocks return their original JSON. */
  serializeBlock(b: Block): BlockJSON {
    if (b.type === 'unknown' && b.attrs.raw) return clone(b.attrs.raw);
    const j: BlockJSON = { id: b.id, type: b.type };
    for (const _ in b.attrs) {
      j.attrs = clone(b.attrs);
      break;
    }
    if (b.content) j.content = clone(b.content);
    if (b.children) j.children = b.children.map((c) => this.serializeBlock(c));
    return j;
  }
  serialize(doc: Doc): DocJSON {
    const out: DocJSON = { format: 'zeditor', version: DOC_VERSION, blocks: doc.blocks.map((b) => this.serializeBlock(b)) };
    if (Object.keys(this.extensionVersions).length) out.extensions = { ...this.extensionVersions };
    return out;
  }
  /** Validate block JSON for insertion (paste, commands). Ids colliding with `doc` are regenerated. */
  sanitizeBlocks(list: BlockJSON[], doc?: Doc): BlockJSON[] {
    const seen = new Set<string>(['root']);
    const issues: string[] = [];
    const out: BlockJSON[] = [];
    for (const raw of list) {
      const b = this.parseBlock(raw, seen, issues);
      if (b) out.push(b.toJSON());
    }
    if (doc) {
      const fix = (j: BlockJSON) => {
        if (doc.has(j.id)) j.id = newId();
        j.children?.forEach(fix);
      };
      out.forEach(fix);
    }
    return out;
  }
}
