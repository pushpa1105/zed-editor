/**
 * HTML parsing, import and export. No DOM required: a small tolerant tokenizer builds an
 * element tree, and import converts it to blocks through an allow-list (schema parse rules).
 * Imported markup is never inserted into a live document, so scripts, event handlers and
 * unknown elements cannot survive an import.
 */
import { Attrs, Block, BlockJSON, Inline, InlineAtom, MarkSet, isAtom, normalizeInline } from './model';
import { HtmlEl, MarkSpec, NodeSpec, ParseRule, Schema, safeUrl } from './schema';

/* ------------------------------------------------------------------ tokenizer */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'template', 'xmp']);
const DROP = new Set(['script', 'style', 'head', 'meta', 'link', 'title', 'template', 'noscript', 'object', 'applet', 'frame', 'frameset', 'base', 'svg', 'math', 'select', 'button', 'textarea', 'canvas', 'audio', 'video', 'iframe', 'embed', 'form', 'xml', 'o:p', 'dialog']);
const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'center', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'html', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'caption', 'colgroup']);
const P_CLOSERS = new Set(['address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul', 'details', 'figure']);

const ENT: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', laquo: '«', raquo: '»', deg: '°', euro: '€', pound: '£', yen: '¥',
  cent: '¢', sect: '§', para: '¶', times: '×', divide: '÷', plusmn: '±', larr: '←', rarr: '→', uarr: '↑', darr: '↓', emsp: ' ', ensp: ' ', thinsp: ' ', zwnj: '‌', zwj: '‍', shy: '­',
};
export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
      return String.fromCodePoint(cp);
    }
    return ENT[e] ?? ENT[e.toLowerCase()] ?? m;
  });
}
export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

function parseStyle(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  for (const part of s.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    if (k) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

function mkEl(tag: string, attrs: Record<string, string>, parent?: HtmlEl): HtmlEl {
  return { tag, attrs, children: [], style: parseStyle(attrs.style), classes: (attrs.class ?? '').split(/\s+/).filter(Boolean), parent };
}

/** Parse an HTML string into a lightweight element tree (root tag '#root'). */
export function parseHTML(html: string): HtmlEl {
  const root = mkEl('#root', {});
  let cur = root;
  let i = 0;
  const n = html.length;
  const text = (s: string) => {
    if (s) cur.children.push(decodeEntities(s));
  };
  const closeTo = (tag: string) => {
    let p: HtmlEl | undefined = cur;
    while (p && p !== root && p.tag !== tag) p = p.parent;
    if (p && p !== root) cur = p.parent ?? root;
  };
  const has = (tag: string, stop: Set<string>) => {
    let p: HtmlEl | undefined = cur;
    while (p && p !== root) {
      if (p.tag === tag) return true;
      if (stop.has(p.tag)) return false;
      p = p.parent;
    }
    return false;
  };
  const CELL_STOP = new Set(['table']);
  const LIST_STOP = new Set(['ul', 'ol', 'table']);
  const P_STOP = new Set(['table', 'td', 'th', 'li', 'blockquote', 'div', 'section', 'article', 'body']);
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      text(html.slice(i));
      break;
    }
    if (lt > i) text(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const close = html[lt + 1] === '/';
    const m = /^<\/?([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 80));
    if (!m) {
      text('<');
      i = lt + 1;
      continue;
    }
    const tag = m[1].toLowerCase();
    let j = lt + m[0].length;
    const attrs: Record<string, string> = {};
    let selfClose = false;
    // attributes
    while (j < n) {
      while (j < n && /\s/.test(html[j])) j++;
      if (html[j] === '>') {
        j++;
        break;
      }
      if (html[j] === '/') {
        selfClose = true;
        j++;
        continue;
      }
      let k = j;
      while (k < n && !/[\s=>/]/.test(html[k])) k++;
      const name = html.slice(j, k).toLowerCase();
      j = k;
      while (j < n && /\s/.test(html[j])) j++;
      let value = '';
      if (html[j] === '=') {
        j++;
        while (j < n && /\s/.test(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, j + 1);
          value = html.slice(j + 1, end < 0 ? n : end);
          j = end < 0 ? n : end + 1;
        } else {
          k = j;
          while (k < n && !/[\s>]/.test(html[k])) k++;
          value = html.slice(j, k);
          j = k;
        }
      }
      if (name && !(name in attrs) && name !== '__proto__') attrs[name] = decodeEntities(value);
      if (k === j && j < n && html[j] !== '>' && html[j] !== '/' && !/\s/.test(html[j]) && !name) j++;
    }
    i = j;
    if (close) {
      closeTo(tag);
      continue;
    }
    // implied end tags
    if (P_CLOSERS.has(tag) && has('p', P_STOP)) closeTo('p');
    if (tag === 'li' && has('li', LIST_STOP)) closeTo('li');
    if ((tag === 'td' || tag === 'th') && (has('td', CELL_STOP) || has('th', CELL_STOP))) closeTo(has('td', CELL_STOP) ? 'td' : 'th');
    if (tag === 'tr' && has('tr', CELL_STOP)) closeTo('tr');
    if ((tag === 'dt' || tag === 'dd') && (cur.tag === 'dt' || cur.tag === 'dd')) cur = cur.parent ?? root;
    const el = mkEl(tag, attrs, cur);
    cur.children.push(el);
    if (RAW.has(tag)) {
      const re = new RegExp('</' + tag.replace(/[^a-z0-9]/g, '') + '\\s*>', 'i');
      const rest = html.slice(i);
      const mm = re.exec(rest);
      const body = mm ? rest.slice(0, mm.index) : rest;
      if (tag === 'textarea' || tag === 'title') el.children.push(decodeEntities(body));
      else el.children.push(body);
      i += mm ? mm.index + mm[0].length : rest.length;
      continue;
    }
    if (!VOID.has(tag) && !selfClose) cur = el;
  }
  return root;
}

export function textContent(el: HtmlEl | string): string {
  if (typeof el === 'string') return el;
  if (el.tag === 'br') return '\n';
  let s = '';
  for (const c of el.children) s += textContent(c);
  return s;
}
export function findAll(el: HtmlEl, pred: (e: HtmlEl) => boolean, out: HtmlEl[] = []): HtmlEl[] {
  for (const c of el.children)
    if (typeof c !== 'string') {
      if (pred(c)) out.push(c);
      findAll(c, pred, out);
    }
  return out;
}

/* ------------------------------------------------------------------ import */

interface Rules {
  blocks: { rule: ParseRule; spec: NodeSpec }[];
  inlines: { rule: ParseRule; spec: NodeSpec }[];
  marks: { rule: ParseRule; spec: MarkSpec }[];
}
const ruleCache = new WeakMap<Schema, { size: number; rules: Rules }>();
function rulesFor(schema: Schema): Rules {
  const size = schema.nodes.size * 1000 + schema.marks.size;
  const hit = ruleCache.get(schema);
  if (hit && hit.size === size) return hit.rules;
  const rules: Rules = { blocks: [], inlines: [], marks: [] };
  for (const spec of schema.nodes.values()) for (const rule of spec.parseHTML ?? []) (spec.kind === 'inline' ? rules.inlines : rules.blocks).push({ rule, spec });
  for (const spec of schema.marks.values()) for (const rule of spec.parseHTML ?? []) rules.marks.push({ rule, spec });
  const byPrio = (a: { rule: ParseRule }, b: { rule: ParseRule }) => (b.rule.priority ?? 50) - (a.rule.priority ?? 50);
  rules.blocks.sort(byPrio);
  rules.inlines.sort(byPrio);
  rules.marks.sort(byPrio);
  ruleCache.set(schema, { size, rules });
  return rules;
}
function matchRule<T extends { rule: ParseRule }>(list: T[], el: HtmlEl): { hit: T; attrs: Attrs | undefined } | null {
  for (const r of list) {
    if (r.rule.tag !== '*' && r.rule.tag !== el.tag) continue;
    if (r.rule.match && !r.rule.match(el)) continue;
    let attrs: Attrs | undefined | false;
    if (r.rule.getAttrs) {
      attrs = r.rule.getAttrs(el);
      if (attrs === false) continue;
    }
    return { hit: r, attrs: attrs || undefined };
  }
  return null;
}

function isBlockEl(el: HtmlEl, rules: Rules): boolean {
  if (BLOCK_TAGS.has(el.tag)) return true;
  if (el.tag === 'img' && rules.blocks.some((r) => r.rule.tag === 'img')) return true;
  if (el.attrs['data-z-type'] && !el.attrs['data-z-inline']) return true;
  const d = el.style.display;
  return d === 'block' || d === 'flex' || d === 'grid' || d === 'list-item' || d === 'table';
}
function hasBlockChild(el: HtmlEl, rules: Rules): boolean {
  for (const c of el.children) if (typeof c !== 'string' && !DROP.has(c.tag) && (isBlockEl(c, rules) || hasBlockChild(c, rules))) return true;
  return false;
}

export interface ImportOptions {
  /** keep whitespace as-is (used for <pre>) */
  preserveWhitespace?: boolean;
}

class Importer {
  rules: Rules;
  constructor(public schema: Schema) {
    this.rules = rulesFor(schema);
  }

  marksOf(el: HtmlEl, base: MarkSet | undefined): MarkSet | undefined {
    let out = base;
    for (const r of this.rules.marks) {
      if (r.rule.tag !== '*' && r.rule.tag !== el.tag) continue;
      if (r.rule.match && !r.rule.match(el)) continue;
      let attrs: Attrs | undefined | false;
      if (r.rule.getAttrs) {
        attrs = r.rule.getAttrs(el);
        if (attrs === false) continue;
      }
      const v = this.schema.parseMarks({ [r.spec.type]: attrs ?? true });
      if (v) out = { ...(out ?? {}), ...v };
    }
    // explicit "not bold / not italic" resets (Google Docs wraps everything in <b style="font-weight:normal">)
    if (out) {
      const fw = el.style['font-weight'];
      if (fw && (fw === 'normal' || fw === '400' || parseInt(fw) < 600) && out.bold && el.tag !== 'b' && el.tag !== 'strong') {
        out = { ...out };
        delete out.bold;
      }
      if (el.style['font-style'] === 'normal' && out.italic && el.tag !== 'i' && el.tag !== 'em') {
        out = { ...out };
        delete out.italic;
      }
    }
    return out;
  }

  /** Collect inline content of `el`'s children. Block-level descendants are flattened. */
  inline(nodes: (HtmlEl | string)[], marks: MarkSet | undefined, out: Inline[], pre: boolean): void {
    for (const n of nodes) {
      if (typeof n === 'string') {
        let t = n.replace(/\r\n?/g, '\n');
        if (!pre) t = t.replace(/[ \t\n\f]+/g, ' ');
        t = t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￼]/g, '');
        if (t) out.push(marks ? { text: t, marks } : { text: t });
        continue;
      }
      if (DROP.has(n.tag)) continue;
      if (n.tag === 'br') {
        out.push({ text: '\n' });
        continue;
      }
      if (n.attrs['data-z-inline'] && n.attrs['data-z-type']) {
        let attrs: Attrs = {};
        try {
          attrs = JSON.parse(n.attrs['data-z-attrs'] || '{}');
        } catch {
          /* ignore */
        }
        const spec = this.schema.node(n.attrs['data-z-type']);
        const a: InlineAtom = { atom: n.attrs['data-z-type'], attrs: spec?.kind === 'inline' ? this.schema.parseAttrs(spec.attrs, attrs, true) : attrs };
        if (marks) a.marks = marks;
        out.push(a);
        continue;
      }
      const atom = matchRule(this.rules.inlines, n);
      if (atom) {
        const a: InlineAtom = { atom: atom.hit.spec.type, attrs: this.schema.parseAttrs(atom.hit.spec.attrs, atom.attrs ?? {}, true) };
        if (marks) a.marks = marks;
        out.push(a);
        continue;
      }
      if (n.tag === 'img') {
        const alt = n.attrs.alt;
        if (alt) out.push(marks ? { text: alt, marks } : { text: alt });
        continue;
      }
      const m = this.marksOf(n, marks);
      const p = pre || n.tag === 'pre' || /^pre/.test(n.style['white-space'] ?? '');
      const before = out.length;
      this.inline(n.children, m, out, p);
      if (isBlockEl(n, this.rules) && out.length > before) out.push({ text: '\n' });
    }
  }

  finishInline(content: Inline[], pre: boolean): Inline[] {
    let out = normalizeInline(content);
    if (!pre) {
      // collapse whitespace across span boundaries and trim block edges
      const res: Inline[] = [];
      let prevSpace = true;
      for (const c of out) {
        if (isAtom(c)) {
          res.push(c);
          prevSpace = false;
          continue;
        }
        let t = c.text.replace(/ *\n */g, '\n');
        if (prevSpace) t = t.replace(/^ +/, '');
        if (!t) continue;
        prevSpace = / $|\n$/.test(t);
        res.push(c.marks ? { text: t, marks: c.marks } : { text: t });
      }
      out = normalizeInline(res);
      const last = out[out.length - 1];
      if (last && !isAtom(last)) {
        const t = last.text.replace(/[ \n]+$/, '');
        if (t) out[out.length - 1] = last.marks ? { text: t, marks: last.marks } : { text: t };
        else out.pop();
      }
      const first = out[0];
      if (first && !isAtom(first)) {
        const t = first.text.replace(/^[ \n]+/, '');
        if (t) out[0] = first.marks ? { text: t, marks: first.marks } : { text: t };
        else out.shift();
      }
    } else {
      const last = out[out.length - 1];
      if (last && !isAtom(last) && last.text.endsWith('\n')) {
        const t = last.text.slice(0, -1);
        if (t) out[out.length - 1] = last.marks ? { text: t, marks: last.marks } : { text: t };
        else out.pop();
      }
    }
    return out;
  }

  textBlock(type: string, attrs: Attrs | undefined, el: HtmlEl | null, nodes: (HtmlEl | string)[], marks?: MarkSet): BlockJSON {
    const spec = this.schema.node(type)!;
    const pre = !!spec.code || el?.tag === 'pre' || /^pre/.test(el?.style['white-space'] ?? '');
    const raw: Inline[] = [];
    this.inline(nodes, spec.code ? undefined : marks, raw, pre);
    let content = this.finishInline(raw, pre);
    if (spec.code) content = content.length ? [{ text: content.map((c) => (isAtom(c) ? '' : c.text)).join('') }] : [];
    const a: Attrs = { ...(attrs ?? {}) };
    if (el && spec.attrs?.align && a.align === undefined) {
      const al = (el.style['text-align'] || el.attrs.align || '').toLowerCase();
      if (al === 'center' || al === 'right' || al === 'justify') a.align = al;
    }
    return this.schema.create(type, a, content);
  }

  /** Convert a node list into blocks. Loose inline content becomes paragraphs. */
  blocks(nodes: (HtmlEl | string)[], marks?: MarkSet): BlockJSON[] {
    const out: BlockJSON[] = [];
    let run: (HtmlEl | string)[] = [];
    const flush = () => {
      if (!run.length) return;
      const b = this.textBlock('paragraph', undefined, null, run, marks);
      run = [];
      if (b.content!.length) out.push(b);
    };
    for (const n of nodes) {
      if (typeof n === 'string') {
        run.push(n);
        continue;
      }
      if (DROP.has(n.tag)) continue;
      const got = this.block(n, marks);
      if (got === null) {
        run.push(n);
        continue;
      }
      flush();
      out.push(...got);
    }
    flush();
    return out;
  }

  /** Convert one element into blocks, or return null if it is inline content. */
  block(el: HtmlEl, marks?: MarkSet): BlockJSON[] | null {
    const schema = this.schema;
    // generic round trip of custom nodes exported without a dedicated serializer
    const zt = el.attrs['data-z-type'];
    if (zt && el.attrs['data-z-raw']) {
      try {
        const raw = JSON.parse(el.attrs['data-z-raw']);
        if (raw && typeof raw === 'object' && typeof raw.type === 'string') return [raw as BlockJSON];
      } catch {
        /* fall through to the readable markup */
      }
    }
    if (zt && !el.attrs['data-z-inline']) {
      const spec = schema.node(zt);
      let attrs: Attrs = {};
      try {
        attrs = JSON.parse(el.attrs['data-z-attrs'] || '{}');
      } catch {
        /* ignore */
      }
      if (spec && spec.kind !== 'inline') {
        attrs = schema.parseAttrs(spec.attrs, attrs, true);
        if (spec.kind === 'text') return [this.withChildren(this.textBlock(zt, attrs, el, el.children.filter((c) => typeof c === 'string' || !c.attrs['data-z-children'])), el)];
        if (spec.kind === 'container') return [schema.create(zt, attrs, undefined, this.blocks(el.children))];
        return [schema.create(zt, attrs)];
      }
      // unknown custom node: keep as inert recoverable data
      let raw: any = null;
      try {
        raw = JSON.parse(el.attrs['data-z-raw'] || 'null');
      } catch {
        /* ignore */
      }
      if (raw && typeof raw === 'object' && typeof raw.type === 'string') return [raw as BlockJSON];
    }
    if (el.attrs['data-z-children'] !== undefined) return this.blocks(el.children, marks);
    const hit = matchRule(this.rules.blocks, el);
    if (hit) {
      const spec = hit.hit.spec;
      if (spec.kind === 'atom') return [schema.create(spec.type, schema.parseAttrs(spec.attrs, hit.attrs ?? {}, false))];
      if (spec.kind === 'container') {
        const kids = this.blocks(el.children, marks).filter((b) => schema.canContain({ type: spec.type }, b.type));
        return [schema.create(spec.type, schema.parseAttrs(spec.attrs, hit.attrs ?? {}, false), undefined, kids)];
      }
      const attrs = schema.parseAttrs(spec.attrs, hit.attrs ?? {}, false);
      if (hasBlockChild(el, this.rules) && !spec.code) {
        // e.g. <blockquote><p>a</p><p>b</p></blockquote>: one block per inner block
        const inner = this.blocks(el.children, marks);
        return inner.map((b) => (b.type === 'paragraph' ? { ...b, type: spec.type, attrs: { ...attrs, ...(b.attrs?.align ? { align: b.attrs.align } : {}) } } : b));
      }
      return [this.textBlock(spec.type, attrs, el, el.children, marks)];
    }
    switch (el.tag) {
      case 'ul':
      case 'ol':
        return this.list(el, marks);
      case 'li':
        return this.list({ ...el, tag: 'ul', children: [el] }, marks);
      case 'table':
        return this.table(el, marks);
      case 'details': {
        if (!schema.node('toggle')) break;
        const summary = el.children.find((c) => typeof c !== 'string' && c.tag === 'summary') as HtmlEl | undefined;
        const rest = el.children.filter((c) => c !== summary);
        const b = this.textBlock('toggle', { open: 'open' in el.attrs }, summary ?? null, summary?.children ?? [], marks);
        const kids = this.blocks(rest, marks);
        if (kids.length) b.children = kids;
        return [b];
      }
      default:
        break;
    }
    if (el.tag === 'img') return null;
    if (isBlockEl(el, this.rules) || hasBlockChild(el, this.rules)) {
      const m = this.marksOf(el, marks);
      if (!hasBlockChild(el, this.rules)) {
        // leaf block element (div, p-like): its own paragraph
        const word = this.wordList(el, m);
        if (word) return [word];
        const b = this.textBlock('paragraph', undefined, el, el.children, m);
        return b.content!.length ? [b] : [];
      }
      return this.blocks(el.children, m);
    }
    return null;
  }

  withChildren(b: BlockJSON, el: HtmlEl): BlockJSON {
    const holder = el.children.find((c) => typeof c !== 'string' && c.attrs['data-z-children'] !== undefined) as HtmlEl | undefined;
    if (holder && this.schema.node(b.type)?.children === true) {
      const kids = this.blocks(holder.children);
      if (kids.length) b.children = kids;
    }
    return b;
  }

  /** Word exports list items as paragraphs with `mso-list` styles. */
  wordList(el: HtmlEl, marks?: MarkSet): BlockJSON | null {
    const ml = el.style['mso-list'];
    if (!ml || /none/i.test(ml) || !this.schema.node('list')) return null;
    const level = Math.max(1, parseInt(/level(\d+)/i.exec(ml)?.[1] ?? '1', 10));
    const marker = el.attrs['data-z-marker'] ?? '';
    const ordered = /^\s*(\d+|[a-zA-Z]|[ivxIVX]+)[.)]/.test(marker);
    const b = this.textBlock('list', { kind: ordered ? 'ordered' : 'bullet' }, el, el.children, marks);
    (b as any).__level = level;
    return b;
  }

  list(el: HtmlEl, marks?: MarkSet): BlockJSON[] {
    const schema = this.schema;
    if (!schema.node('list')) return this.blocks(el.children, marks);
    const out: BlockJSON[] = [];
    const isCheckList = el.attrs['data-type'] === 'checklist' || el.classes.includes('z-checklist') || el.classes.includes('contains-task-list') || el.attrs.role === 'listbox';
    for (const c of el.children) {
      if (typeof c === 'string') continue;
      if (c.tag === 'ul' || c.tag === 'ol') {
        // nested list directly inside a list (Google Docs): attach to the previous item
        const nested = this.list(c, marks);
        const prev = out[out.length - 1];
        if (prev) prev.children = [...(prev.children ?? []), ...nested];
        else out.push(...nested);
        continue;
      }
      if (c.tag !== 'li') continue;
      const own: (HtmlEl | string)[] = [];
      const nestedBlocks: BlockJSON[] = [];
      let checked: boolean | undefined;
      const scan = (nodes: (HtmlEl | string)[], target: (HtmlEl | string)[]) => {
        for (const x of nodes) {
          if (typeof x === 'string') {
            target.push(x);
            continue;
          }
          if (x.tag === 'ul' || x.tag === 'ol') nestedBlocks.push(...this.list(x, marks));
          else if (x.tag === 'input' && (x.attrs.type ?? '').toLowerCase() === 'checkbox') checked = 'checked' in x.attrs;
          else if (x.tag === 'p' || x.tag === 'div' || x.tag === 'label') {
            // paragraphs inside list items: join with a line break
            if (target.some((t) => (typeof t === 'string' ? t.trim() : true))) target.push({ ...mkEl('br', {}), parent: x });
            scan(x.children, target);
          } else if (isBlockEl(x, this.rules) && x.tag !== 'li') {
            const blocks = this.block(x, marks);
            if (blocks) nestedBlocks.push(...blocks);
            else target.push(x);
          } else target.push(x);
        }
      };
      scan(c.children, own);
      if (checked === undefined) {
        const dc = c.attrs['data-checked'] ?? c.attrs['aria-checked'];
        if (dc !== undefined) checked = dc === 'true';
        else if (isCheckList) checked = false;
      }
      const kind = checked !== undefined ? 'check' : el.tag === 'ol' ? 'ordered' : 'bullet';
      const attrs: Attrs = { kind };
      if (kind === 'check') attrs.checked = !!checked;
      const item = this.textBlock('list', attrs, c, own, this.marksOf(c, marks));
      if (nestedBlocks.length) item.children = nestedBlocks;
      out.push(item);
    }
    return out;
  }

  table(el: HtmlEl, marks?: MarkSet): BlockJSON[] {
    const schema = this.schema;
    if (!schema.node('table')) return this.blocks(el.children, marks);
    const rows: HtmlEl[] = [];
    const collect = (e: HtmlEl) => {
      for (const c of e.children) {
        if (typeof c === 'string') continue;
        if (c.tag === 'tr') rows.push(c);
        else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') collect(c);
      }
    };
    collect(el);
    const rowsJ: BlockJSON[] = [];
    for (const r of rows) {
      const cells: BlockJSON[] = [];
      for (const c of r.children) {
        if (typeof c === 'string' || (c.tag !== 'td' && c.tag !== 'th')) continue;
        const attrs: Attrs = {};
        const cs = parseInt(c.attrs.colspan ?? '1', 10);
        const rs = parseInt(c.attrs.rowspan ?? '1', 10);
        if (cs > 1) attrs.colspan = Math.min(cs, 50);
        if (rs > 1) attrs.rowspan = Math.min(rs, 200);
        if (c.tag === 'th' || (r.parent?.tag === 'thead')) attrs.header = true;
        let kids = this.blocks(c.children, this.marksOf(c, marks)).filter((b) => b.type !== 'table');
        if (!kids.length) kids = [schema.create('paragraph')];
        cells.push(schema.create('table_cell', attrs, undefined, kids));
      }
      if (cells.length) rowsJ.push(schema.create('table_row', undefined, undefined, cells));
    }
    if (!rowsJ.length) return [];
    return [schema.create('table', undefined, undefined, rowsJ)];
  }
}

/** Nest Word list paragraphs (flat, with levels) under each other. */
function nestWordLists(blocks: BlockJSON[]): BlockJSON[] {
  const out: BlockJSON[] = [];
  const stack: { level: number; block: BlockJSON }[] = [];
  for (const b of blocks) {
    const level = (b as any).__level as number | undefined;
    delete (b as any).__level;
    if (b.children) b.children = nestWordLists(b.children);
    if (!level) {
      stack.length = 0;
      out.push(b);
      continue;
    }
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) (parent.block.children ??= []).push(b);
    else out.push(b);
    stack.push({ level, block: b });
  }
  return out;
}

/** Normalize markup produced by Word and Google Docs before parsing. */
function preprocess(html: string): string {
  // clipboard fragment markers
  const s = html.indexOf('<!--StartFragment-->');
  const e = html.lastIndexOf('<!--EndFragment-->');
  if (s >= 0 && e > s) html = html.slice(s + 20, e);
  // Word list markers live in conditional comments: keep the marker text as an attribute
  html = html.replace(/<(p|h[1-6])\b([^>]*)>\s*<!(?:--)?\[if !supportLists\](?:--)?>([\s\S]*?)<!(?:--)?\[endif\](?:--)?>/gi, (_m, tag, attrs, marker) => {
    const text = decodeEntities(String(marker).replace(/<[^>]*>/g, '')).trim();
    return '<' + tag + attrs + ' data-z-marker="' + esc(text) + '">';
  });
  // a copied cell range arrives without its <table> wrapper
  if (/^\s*(?:<col\b[^>]*>\s*|<colgroup[\s\S]*?<\/colgroup>\s*)*<(tr|tbody|thead)\b/i.test(html)) html = '<table>' + html + '</table>';
  else if (/^\s*<(td|th)\b/i.test(html)) html = '<table><tr>' + html + '</tr></table>';
  html = html.replace(/<!--\[if [^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '');
  return html;
}

/** Convert an HTML string into validated block JSON. */
export function htmlToBlocks(schema: Schema, html: string): BlockJSON[] {
  const root = parseHTML(preprocess(html));
  const imp = new Importer(schema);
  const body = findAll(root, (e) => e.tag === 'body')[0] ?? root;
  const blocks = nestWordLists(imp.blocks(body.children));
  return schema.sanitizeBlocks(blocks);
}

/** Extract the internal structured payload embedded by `toClipboardHTML`, if any. */
export function extractEmbeddedJSON(html: string): any | null {
  const m = /data-zeditor-json="([^"]*)"/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(decodeEntities(m[1])));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ export */

export interface HTMLContext {
  schema: Schema;
  esc: (s: string) => string;
  /** inline content of a text block as HTML */
  inline: (b: { content?: Inline[] }) => string;
  /** child blocks as HTML */
  children: (b: { children?: BlockJSON[] | Block[] }) => string;
  /** ` style="..."` for alignment / indentation, or '' */
  style: (b: { attrs?: Attrs }, extra?: string) => string;
  /** include `id` attributes for block links */
  ids: boolean;
  id: (b: { id: string }) => string;
}

export interface ExportOptions {
  /** emit `id="..."` on blocks (block links) */
  ids?: boolean;
}

function markOrder(schema: Schema, marks: MarkSet): string[] {
  return Object.keys(marks).sort((a, b) => (schema.marks.get(a)?.rank ?? 50) - (schema.marks.get(b)?.rank ?? 50) || (a < b ? -1 : 1));
}

export function inlineToHTML(schema: Schema, content: readonly Inline[] | undefined): string {
  let out = '';
  for (const c of content ?? []) {
    let inner: string;
    if (isAtom(c)) {
      const spec = schema.node(c.atom);
      inner = spec?.toHTML
        ? spec.toHTML(c, { schema, esc })
        : `<span data-z-type="${esc(c.atom)}" data-z-inline="1" data-z-attrs="${esc(JSON.stringify(c.attrs ?? {}))}">${esc(spec?.toText?.(c) ?? '')}</span>`;
    } else inner = esc(c.text).replace(/\n/g, '<br>');
    if (c.marks) {
      const order = markOrder(schema, c.marks);
      for (let i = order.length - 1; i >= 0; i--) {
        const spec = schema.marks.get(order[i]);
        if (!spec?.toHTML) continue;
        const [o, cl] = spec.toHTML(c.marks[order[i]]);
        inner = o + inner + cl;
      }
    }
    out += inner;
  }
  return out;
}

export function blocksToHTML(schema: Schema, blocks: readonly (Block | BlockJSON)[], opts: ExportOptions = {}): string {
  const ctx: HTMLContext = {
    schema,
    esc,
    ids: !!opts.ids,
    id: (b) => (opts.ids ? ` id="${esc(b.id)}"` : ''),
    inline: (b) => inlineToHTML(schema, b.content),
    children: (b) => render((b.children ?? []) as (Block | BlockJSON)[]),
    style: (b, extra = '') => {
      const a = b.attrs ?? {};
      let s = extra;
      if (a.align && /^(center|right|justify)$/.test(a.align)) s += `text-align:${a.align};`;
      if (a.indent > 0) s += `margin-left:${Math.min(8, a.indent | 0) * 2}em;`;
      return s ? ` style="${esc(s)}"` : '';
    },
  };
  function render(list: readonly (Block | BlockJSON)[]): string {
    let out = '';
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.type === 'list') {
        // group consecutive list items of the same kind
        const kind = b.attrs?.kind ?? 'bullet';
        let j = i;
        let items = '';
        while (j < list.length && list[j].type === 'list' && (list[j].attrs?.kind ?? 'bullet') === kind) {
          const it = list[j];
          const nested = it.children?.length ? render(it.children as (Block | BlockJSON)[]) : '';
          const chk = kind === 'check' ? ` data-checked="${it.attrs?.checked ? 'true' : 'false'}"` : '';
          items += `<li${ctx.id(it)}${chk}${ctx.style(it)}>${ctx.inline(it)}${nested}</li>`;
          j++;
        }
        const tag = kind === 'ordered' ? 'ol' : 'ul';
        out += `<${tag}${kind === 'check' ? ' data-type="checklist"' : ''}>${items}</${tag}>`;
        i = j - 1;
        continue;
      }
      out += one(b);
    }
    return out;
  }
  function one(b: Block | BlockJSON): string {
    if (b.type === 'unknown') {
      const raw = b.attrs?.raw;
      return `<div data-z-type="${esc(String(raw?.type ?? 'unknown'))}" data-z-raw="${esc(JSON.stringify(raw ?? null))}"></div>`;
    }
    const spec = schema.node(b.type);
    if (!spec) return '';
    let html: string;
    if (spec.toHTML) html = spec.toHTML(b, ctx);
    else {
      const meta = ` data-z-type="${esc(b.type)}" data-z-attrs="${esc(JSON.stringify(b.attrs ?? {}))}"`;
      if (spec.kind === 'text') html = `<p${ctx.id(b)}${meta}>${ctx.inline(b)}</p>`;
      else if (spec.kind === 'container') return `<div${ctx.id(b)}${meta}>${ctx.children(b)}</div>`;
      else return `<div${ctx.id(b)}${meta}></div>`;
    }
    // nested children of non-list text blocks have no HTML equivalent: keep them in a marked wrapper
    if (spec.kind === 'text' && b.children?.length && !(spec as any).htmlNestsChildren) html += `<div data-z-children="" style="margin-left:1.5em">${ctx.children(b)}</div>`;
    return html;
  }
  return render(blocks);
}
