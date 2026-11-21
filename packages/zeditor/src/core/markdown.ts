/**
 * Markdown import / export (CommonMark subset + GFM tables, task lists, strikethrough).
 *
 * What Markdown cannot represent is documented in docs/serialization.md. Custom blocks
 * without a `toMarkdown` serializer are written as `<!-- zeditor:block {...} -->` comments,
 * which this importer restores, so their data survives a Markdown round trip.
 */
import { Attrs, Block, BlockJSON, Inline, MarkSet, isAtom, normalizeInline } from './model';
import { Schema, safeUrl } from './schema';
import { htmlToBlocks } from './html';

/* ------------------------------------------------------------------ export */

const MD_ORDER = ['link', 'bold', 'italic', 'strike', 'underline', 'sub', 'sup', 'highlight', 'code'];

function escText(s: string): string {
  return s.replace(/([\\`*_[\]<>~$])/g, '\\$1');
}

export function inlineToMarkdown(schema: Schema, content: readonly Inline[] | undefined): string {
  let out = '';
  for (const c of content ?? []) {
    if (isAtom(c)) {
      const spec = schema.node(c.atom);
      out += spec?.toMarkdown ? spec.toMarkdown(c, { schema }) : spec?.toText?.(c) ?? '';
      continue;
    }
    const marks = c.marks ?? {};
    const isCode = !!marks.code;
    // whitespace must stay outside emphasis markers
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(c.text)!;
    let inner = m[2];
    if (!inner) {
      out += c.text.replace(/\n/g, '\\\n');
      continue;
    }
    if (isCode) {
      const ticks = '`'.repeat(Math.max(1, ...(inner.match(/`+/g) ?? []).map((t) => t.length + 1)));
      inner = ticks + (ticks.length > 1 ? ' ' : '') + inner + (ticks.length > 1 ? ' ' : '') + ticks;
    } else inner = escText(inner).replace(/\n/g, '\\\n');
    const keys = Object.keys(marks)
      .filter((k) => k !== 'code')
      .sort((a, b) => MD_ORDER.indexOf(a) - MD_ORDER.indexOf(b));
    for (let i = keys.length - 1; i >= 0; i--) {
      const spec = schema.marks.get(keys[i]);
      if (!spec?.toMarkdown) continue;
      const [o, cl] = spec.toMarkdown(marks[keys[i]]);
      inner = o + inner + cl;
    }
    out += m[1].replace(/\n/g, '\\\n') + inner + m[3].replace(/\n/g, '\\\n');
  }
  return out;
}

export function blocksToMarkdown(schema: Schema, blocks: readonly (Block | BlockJSON)[]): string {
  const ctx = {
    schema,
    inline: (b: { content?: Inline[] }) => inlineToMarkdown(schema, b.content),
    children: (b: { children?: (Block | BlockJSON)[] }) => render((b.children ?? []) as (Block | BlockJSON)[]),
    number: (_b: any) => 1,
  };
  function cellText(cell: Block | BlockJSON): string {
    return ((cell.children ?? []) as (Block | BlockJSON)[])
      .map((b) => (schema.isText(b) ? inlineToMarkdown(schema, b.content).replace(/\\\n/g, '<br>') : schema.node(b.type)?.toText?.(b) ?? ''))
      .join('<br>')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ');
  }
  function table(b: Block | BlockJSON): string {
    const rows = ((b.children ?? []) as (Block | BlockJSON)[]).map((r) => {
      const out: string[] = [];
      for (const c of (r.children ?? []) as (Block | BlockJSON)[]) {
        out.push(cellText(c));
        for (let i = 1; i < (c.attrs?.colspan ?? 1); i++) out.push('');
      }
      return out;
    });
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const line = (r: string[]) => '| ' + Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ') + ' |';
    const lines = [line(rows[0] ?? []), '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |', ...rows.slice(1).map(line)];
    return lines.join('\n');
  }
  function render(list: readonly (Block | BlockJSON)[]): string {
    const parts: string[] = [];
    let ordinal = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const prev = list[i - 1];
      let text: string;
      const spec = schema.node(b.type);
      if (b.type === 'list') {
        ordinal = prev?.type === 'list' && prev.attrs?.kind === 'ordered' && b.attrs?.kind === 'ordered' ? ordinal + 1 : b.attrs?.start ?? 1;
        ctx.number = () => ordinal;
      }
      if (b.type === 'unknown') text = `<!-- zeditor:block ${JSON.stringify(b.attrs?.raw ?? null).replace(/--/g, '-\\u002d')} -->`;
      else if (b.type === 'table') text = table(b);
      else if (spec?.toMarkdown) text = spec.toMarkdown(b, ctx);
      else if (spec) text = `<!-- zeditor:block ${JSON.stringify(serialize(b)).replace(/--/g, '-\\u002d')} -->`;
      else continue;
      if (spec?.kind === 'text' && b.children?.length && b.type !== 'toggle' && spec.toMarkdown) {
        const pad = b.type === 'list' ? ' '.repeat(b.attrs?.kind === 'ordered' ? String(ordinal).length + 2 : 2) : '  ';
        const kids = render(b.children as (Block | BlockJSON)[]);
        text += (b.type === 'list' && (b.children as any[]).every((k) => k.type === 'list') ? '\n' : '\n\n') + kids.split('\n').map((l) => (l ? pad + l : l)).join('\n');
      }
      // tight lists: consecutive items separated by a single newline
      const tight = b.type === 'list' && prev?.type === 'list';
      parts.push((parts.length ? (tight ? '\n' : '\n\n') : '') + text);
    }
    return parts.join('');
  }
  function serialize(b: Block | BlockJSON): BlockJSON {
    return b instanceof Block ? schema.serializeBlock(b) : b;
  }
  return render(blocks) + '\n';
}

/* ------------------------------------------------------------------ import: inline */

function unescape(s: string): string {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!<>~|$])/g, '$1');
}

export function parseInlineMarkdown(schema: Schema, src: string, marks?: MarkSet): Inline[] {
  const out: Inline[] = [];
  const push = (text: string, m?: MarkSet) => {
    if (text) out.push(m && Object.keys(m).length ? { text, marks: m } : { text });
  };
  const withMark = (k: string, val: any = true): MarkSet => ({ ...(marks ?? {}), [k]: val });
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf) push(unescape(buf), marks);
    buf = '';
  };
  const has = (k: string) => schema.marks.has(k);
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      if (src[i + 1] === '\n') {
        flush();
        push('\n', marks);
        i += 2;
        continue;
      }
      buf += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    let m: RegExpExecArray | null;
    if (ch === '`' && (m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest))) {
      flush();
      let code = m[2];
      if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
      push(code, has('code') ? withMark('code') : marks);
      i += m[0].length;
      continue;
    }
    if (ch === '!' && (m = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"((?:[^"\\]|\\.)*)")?\s*\)/.exec(rest))) {
      // inline image: images are blocks; keep the alt text (block-level images are handled by the block parser)
      flush();
      push(m[1], marks);
      i += m[0].length;
      continue;
    }
    if (ch === '[' && (m = /^\[((?:[^\]\\]|\\.)*)\]\(\s*<?([^)\s>]*)>?(?:\s+"((?:[^"\\]|\\.)*)")?\s*\)/.exec(rest))) {
      flush();
      let href = m[2];
      try {
        href = decodeURIComponent(href);
      } catch {
        /* keep */
      }
      const link = schema.parseMarks({ link: { href, title: m[3] ? unescape(m[3]) : '' } })?.link;
      out.push(...parseInlineMarkdown(schema, m[1], link ? withMark('link', link) : marks));
      i += m[0].length;
      continue;
    }
    if (ch === '<') {
      if ((m = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/.exec(rest))) {
        flush();
        const link = schema.parseMarks({ link: { href: m[1] } })?.link;
        push(m[1].replace(/^mailto:/, ''), link ? withMark('link', link) : marks);
        i += m[0].length;
        continue;
      }
      if ((m = /^<br\s*\/?>/i.exec(rest))) {
        flush();
        push('\n', marks);
        i += m[0].length;
        continue;
      }
      const tagMark: Record<string, string> = { u: 'underline', ins: 'underline', sub: 'sub', sup: 'sup', mark: 'highlight', s: 'strike', del: 'strike', b: 'bold', strong: 'bold', i: 'italic', em: 'italic', code: 'code', kbd: 'code' };
      if ((m = /^<(u|ins|sub|sup|mark|s|del|b|strong|i|em|code|kbd)>([\s\S]*?)<\/\1>/i.exec(rest))) {
        flush();
        const k = tagMark[m[1].toLowerCase()];
        out.push(...parseInlineMarkdown(schema, m[2], has(k) ? withMark(k, k === 'highlight' ? { color: '' } : true) : marks));
        i += m[0].length;
        continue;
      }
      if ((m = /^<\/?[a-zA-Z][^>]*>/.exec(rest))) {
        // other inline HTML: import through the HTML importer (sanitizing), keep its text and marks
        const close = new RegExp('^<([a-zA-Z][\\w-]*)[^>]*>[\\s\\S]*?</\\1>').exec(rest);
        const html = close ? close[0] : m[0];
        flush();
        for (const b of htmlToBlocks(schema, html)) for (const c of b.content ?? []) out.push(marks ? { ...c, marks: { ...marks, ...(c.marks ?? {}) } } : c);
        i += html.length;
        continue;
      }
    }
    if (ch === '$' && schema.node('math') && (m = /^\$([^\s$](?:[^$\n]*[^\s$])?)\$(?!\d)/.exec(rest))) {
      flush();
      out.push(marks ? { atom: 'math', attrs: { tex: m[1] }, marks } : { atom: 'math', attrs: { tex: m[1] } });
      i += m[0].length;
      continue;
    }
    if (ch === '*' || ch === '_') {
      const prevCh = i > 0 ? src[i - 1] : ' ';
      const wordBefore = /[\p{L}\p{N}]/u.test(prevCh);
      if ((m = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest)) && !(ch === '_' && (wordBefore || /^[\p{L}\p{N}]/u.test(rest.slice(m[0].length))))) {
        flush();
        out.push(...parseInlineMarkdown(schema, m[2], withMark('bold')));
        i += m[0].length;
        continue;
      }
      if ((m = /^(\*|_)(?=\S)((?:[^\\]|\\.)*?\S)\1(?!\1)/.exec(rest)) && !(ch === '_' && (wordBefore || /^[\p{L}\p{N}]/u.test(rest.slice(m[0].length))))) {
        flush();
        out.push(...parseInlineMarkdown(schema, m[2], withMark('italic')));
        i += m[0].length;
        continue;
      }
    }
    if (ch === '~' && has('strike') && (m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest))) {
      flush();
      out.push(...parseInlineMarkdown(schema, m[1], withMark('strike')));
      i += m[0].length;
      continue;
    }
    if ((ch === 'h' || ch === 'w') && (i === 0 || /[\s(]/.test(src[i - 1])) && (m = /^(?:https?:\/\/|www\.)[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}*_]/i.exec(rest))) {
      flush();
      const href = /^www\./i.test(m[0]) ? 'https://' + m[0] : m[0];
      const link = schema.parseMarks({ link: { href } })?.link;
      push(m[0], link && !marks?.link ? withMark('link', link) : marks);
      i += m[0].length;
      continue;
    }
    if (ch === ' ' && /^ {2,}\n/.test(rest)) {
      flush();
      push('\n', marks);
      i += /^ +\n/.exec(rest)![0].length;
      continue;
    }
    if (ch === '\n') {
      buf += ' ';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return normalizeInline(out);
}

/* ------------------------------------------------------------------ import: blocks */

const BULLET = /^([-*+])(\s+|$)/;
const ORDERED = /^(\d{1,9})([.)])(\s+|$)/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;

function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += 4 - (n % 4);
    else break;
  }
  return n;
}
function dedent(line: string, n: number): string {
  let i = 0;
  let col = 0;
  while (i < line.length && col < n) {
    if (line[i] === ' ') col++;
    else if (line[i] === '\t') col += 4 - (col % 4);
    else break;
    i++;
  }
  return line.slice(i);
}
function splitRow(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

export function markdownToBlocks(schema: Schema, md: string): BlockJSON[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks = parseLines(schema, lines);
  // `<!-- page: Title -->` markers split the document into pages
  if (schema.node('page') && blocks.some((b) => (b as any).__page !== undefined)) {
    const pages: BlockJSON[] = [];
    let cur: BlockJSON | null = null;
    for (const b of blocks) {
      const title = (b as any).__page;
      if (title !== undefined) {
        cur = schema.create('page', { title }, undefined, []);
        cur.children = [];
        pages.push(cur);
        continue;
      }
      if (!cur) {
        cur = schema.create('page', { title: 'Page 1' }, undefined, []);
        cur.children = [];
        pages.push(cur);
      }
      cur.children!.push(b);
    }
    for (const p of pages) if (!p.children!.length) p.children = [schema.create('paragraph')];
    return schema.sanitizeBlocks(pages);
  }
  return schema.sanitizeBlocks(blocks.filter((b) => (b as any).__page === undefined));
}

function parseLines(schema: Schema, lines: string[]): BlockJSON[] {
  const out: BlockJSON[] = [];
  const has = (t: string) => !!schema.node(t);
  const inline = (s: string) => parseInlineMarkdown(schema, s);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    // our own markers
    if ((m = /^\s*<!--\s*zeditor:block\s+([\s\S]*?)\s*-->\s*$/.exec(line))) {
      try {
        const raw = JSON.parse(m[1]);
        if (raw && typeof raw === 'object') out.push(raw);
      } catch {
        /* ignore */
      }
      i++;
      continue;
    }
    if ((m = /^\s*<!--\s*page:\s*([\s\S]*?)\s*-->\s*$/.exec(line))) {
      const marker: any = { id: '', type: 'paragraph', __page: m[1] };
      out.push(marker);
      i++;
      continue;
    }
    if (/^\s*<!--\s*pagebreak\s*-->\s*$/.test(line) && has('page_break')) {
      out.push(schema.create('page_break'));
      i++;
      continue;
    }
    if ((m = FENCE.exec(line))) {
      const fence = m[1];
      const lang = m[2];
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$').test(lines[i])) body.push(lines[i++]);
      i++;
      if (has('code')) out.push(schema.create('code', { language: lang || 'plain' }, body.join('\n')));
      else out.push(schema.create('paragraph', undefined, body.join('\n')));
      continue;
    }
    if (/^\s*\$\$\s*$/.test(line) && has('equation')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(schema.create('equation', { tex: body.join('\n') }));
      continue;
    }
    if ((m = /^\s*\$\$(.+)\$\$\s*$/.exec(line)) && has('equation')) {
      out.push(schema.create('equation', { tex: m[1].trim() }));
      i++;
      continue;
    }
    if ((m = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/.exec(line))) {
      out.push(schema.create('heading', { level: m[1].length }, inline(m[2] ?? '')));
      i++;
      continue;
    }
    if (HR.test(line)) {
      out.push(schema.create('divider'));
      i++;
      continue;
    }
    if (/^\s*<details/i.test(line) && has('toggle')) {
      const body: string[] = [];
      let depth = 0;
      while (i < lines.length) {
        const l = lines[i++];
        depth += (l.match(/<details/gi) ?? []).length - (l.match(/<\/details>/gi) ?? []).length;
        body.push(l);
        if (depth <= 0) break;
      }
      const src = body.join('\n');
      const sm = /<summary>([\s\S]*?)<\/summary>/i.exec(src);
      const inner = src.replace(/^\s*<details[^>]*>/i, '').replace(/<\/details>\s*$/i, '').replace(/<summary>[\s\S]*?<\/summary>/i, '');
      const t = schema.create('toggle', { open: /<details[^>]*\sopen/i.test(src) }, inline(sm?.[1] ?? ''));
      const kids = parseLines(schema, inner.split('\n'));
      if (kids.length) t.children = kids;
      out.push(t);
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (/^ {0,3}>/.test(lines[i]) || (lines[i].trim() && body.length && !/^\s*([-*+]|\d+[.)])\s/.test(lines[i]) && !FENCE.test(lines[i])))) {
        body.push(lines[i].replace(/^ {0,3}> ?/, ''));
        i++;
      }
      const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(body[0] ?? '');
      if (alert && has('callout')) {
        const tone = { NOTE: 'note', TIP: 'info', IMPORTANT: 'info', WARNING: 'warning', CAUTION: 'danger' }[alert[1].toUpperCase()]!;
        const kids = parseLines(schema, body.slice(1));
        out.push(schema.create('callout', { tone }, undefined, kids.length ? kids : undefined));
        continue;
      }
      // one quote block per paragraph inside the quote
      const inner = parseLines(schema, body);
      for (const b of inner) out.push(b.type === 'paragraph' ? { ...b, type: 'quote', attrs: undefined } : b);
      continue;
    }
    // GFM table
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-') && has('table')) {
      const header = splitRow(line);
      const sep = splitRow(lines[i + 1]);
      if (sep.length >= header.length || header.length === sep.length) {
        i += 2;
        const rows: string[][] = [header];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
        const cols = header.length;
        const cell = (s: string, hdr: boolean) =>
          schema.create('table_cell', hdr ? { header: true } : undefined, undefined, [schema.create('paragraph', undefined, inline(s.replace(/<br\s*\/?>/gi, '\\\n')))]);
        out.push(
          schema.create(
            'table',
            undefined,
            undefined,
            rows.map((r, ri) => schema.create('table_row', undefined, undefined, Array.from({ length: cols }, (_, c) => cell(r[c] ?? '', ri === 0)))),
          ),
        );
        continue;
      }
    }
    // lists
    const ind = indentOf(line);
    const body0 = line.slice(line.length - line.trimStart().length);
    if (ind < 4 && (BULLET.test(body0) || ORDERED.test(body0)) && has('list')) {
      const items = parseList(schema, lines, i);
      out.push(...items.blocks);
      i = items.next;
      continue;
    }
    // block image
    if ((m = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"((?:[^"\\]|\\.)*)")?\s*\)\s*$/.exec(line)) && has('image')) {
      let src = m[2];
      try {
        src = decodeURIComponent(src);
      } catch {
        /* keep */
      }
      if (safeUrl(src, { image: true })) {
        out.push(schema.create('image', { src, alt: m[1], caption: m[3] ? unescape(m[3]) : '' }));
        i++;
        continue;
      }
    }
    // block HTML
    if (/^\s*<(div|table|figure|section|aside|p|ul|ol|pre|blockquote|h[1-6]|hr)\b/i.test(line)) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim()) body.push(lines[i++]);
      out.push(...htmlToBlocks(schema, body.join('\n')));
      continue;
    }
    // paragraph
    const para: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      const l = lines[i];
      if (para.length) {
        const t = l.trimStart();
        // setext headings
        if (/^ {0,3}=+\s*$/.test(l) || /^ {0,3}-{2,}\s*$/.test(l)) {
          out.push(schema.create('heading', { level: l.trim()[0] === '=' ? 1 : 2 }, inline(para.join('\n'))));
          para.length = 0;
          i++;
          break;
        }

        if (/^ {0,3}#{1,6}(\s|$)/.test(l) || FENCE.test(l) || /^ {0,3}>/.test(l) || HR.test(l) || (indentOf(l) < 4 && (BULLET.test(t) || /^1[.)]\s/.test(t))) || /^\s*<!--/.test(l)) break;
      }
      para.push(l.trimStart());
      i++;
    }
    if (para.length) out.push(schema.create('paragraph', undefined, inline(para.join('\n'))));
  }
  return out;
}

function parseList(schema: Schema, lines: string[], start: number): { blocks: BlockJSON[]; next: number } {
  const blocks: BlockJSON[] = [];
  let i = start;
  const base = indentOf(lines[start]);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // blank line: the list continues if the next non-blank line is an item or indented content
      let j = i;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length) break;
      const nind = indentOf(lines[j]);
      const nb = lines[j].trimStart();
      if (nind >= base && nind < base + 4 && (BULLET.test(nb) || ORDERED.test(nb)) && nind === base) {
        i = j;
        continue;
      }
      break;
    }
    const ind = indentOf(line);
    const body = line.trimStart();
    const bm = BULLET.exec(body);
    const om = ORDERED.exec(body);
    if (ind !== base || (!bm && !om)) break;
    const markerLen = (bm ? bm[1].length : om![1].length + 1) + 1;
    let text = body.slice((bm ?? om)![0].length);
    const attrs: Attrs = { kind: om ? 'ordered' : 'bullet' };
    if (om && !blocks.length && +om[1] !== 1) attrs.start = +om[1];
    const task = /^\[( |x|X)\]\s+/.exec(text);
    if (task) {
      attrs.kind = 'check';
      attrs.checked = task[1] !== ' ';
      text = text.slice(task[0].length);
    }
    i++;
    // continuation and nested content: lines indented beyond the marker
    const contentIndent = base + markerLen;
    const own: string[] = [text];
    const nested: string[] = [];
    let inNested = false;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && indentOf(lines[j]) >= contentIndent) {
          nested.push('');
          inNested = true;
          i = j;
          continue;
        }
        break;
      }
      const li = indentOf(l);
      if (li < contentIndent) {
        const t = l.trimStart();
        if (li <= base && (BULLET.test(t) || ORDERED.test(t) || li < base)) break;
        if (inNested || /^(#{1,6}\s|>|```|~~~)/.test(t) || li < base) break;
        if (BULLET.test(t) || ORDERED.test(t)) {
          // under-indented nested list (1 space): treat as nested
          nested.push(dedent(l, Math.min(li, contentIndent)));
          inNested = true;
          i++;
          continue;
        }
        own.push(t); // lazy continuation
        i++;
        continue;
      }
      const d = dedent(l, contentIndent);
      const t = d.trimStart();
      if (!inNested && !(BULLET.test(t) || ORDERED.test(t) || FENCE.test(d) || /^(#{1,6}\s|>)/.test(t))) own.push(t);
      else {
        nested.push(d);
        inNested = true;
      }
      i++;
    }
    const item = schema.create('list', attrs, parseInlineMarkdown(schema, own.join('\n')));
    if (nested.length) {
      const kids = parseLines(schema, nested);
      if (kids.length) item.children = kids;
    }
    blocks.push(item);
  }
  return { blocks, next: i };
}
