import { Block, contentText, isAtom, sliceInline } from '../core/model';
import type { Editor } from '../core/editor';
import type { Extension } from '../core/extension';
import { textSel } from '../core/selection';

/** Plain text of a block's inline content; atoms use their `toText`. */
export function blockText(editor: Editor, b: Block): string {
  return contentText(b.content, (a) => editor.schema.node(a.atom)?.toText?.(a) ?? '');
}

/** Plain text of the document: one line per text block, tables as tab-separated rows. */
export function getText(editor: Editor, blocks: readonly Block[] = editor.doc.blocks): string {
  const lines: string[] = [];
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      const spec = editor.schema.node(b.type);
      if (b.type === 'table') {
        for (const row of b.children ?? []) lines.push((row.children ?? []).map((c) => getText(editor, c.children ?? []).replace(/\n/g, ' ')).join('\t'));
        continue;
      }
      if (spec?.kind === 'text') lines.push(blockText(editor, b));
      else if (spec?.kind === 'atom') {
        const t = spec.toText?.(b);
        if (t) lines.push(t);
      }
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return lines.join('\n');
}

const SEG: any = typeof Intl !== 'undefined' && (Intl as any).Segmenter ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' }) : null;
/** Number of user-perceived characters (grapheme clusters). */
export function graphemeCount(s: string): number {
  if (!s) return 0;
  // fast path: no surrogates, joiners or combining marks
  if (!/[̀-ͯऀ-෿‍️\ud800-\udfffᄀ-ᇿ฀-໿]/.test(s)) return s.length;
  if (SEG) {
    let n = 0;
    for (const _ of SEG.segment(s)) n++;
    return n;
  }
  return [...s].length;
}

export interface HeadingEntry {
  id: string;
  level: number;
  text: string;
}
/** Headings in document order: the data for a table of contents (link to `#id` / `revealBlock`). */
export function getHeadings(editor: Editor): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  for (const b of editor.doc.descendants()) if (b.type === 'heading') out.push({ id: b.id, level: b.attrs.level ?? 1, text: blockText(editor, b) });
  return out;
}

export interface Counts {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  blocks: number;
}
export function getCounts(editor: Editor): Counts {
  let characters = 0;
  let noSpaces = 0;
  let words = 0;
  for (const b of editor.doc.descendants()) {
    if (!b.content) continue;
    const t = blockText(editor, b);
    characters += graphemeCount(t);
    noSpaces += graphemeCount(t.replace(/\s+/g, ''));
    const m = t.match(/[\p{L}\p{N}\p{M}'’_-]+/gu);
    if (m) words += m.length;
  }
  return { characters, charactersNoSpaces: noSpaces, words, blocks: editor.doc.size };
}

/**
 * Reject local edits that would push the document past `limit` characters.
 * Edits that shrink an over-long document are always allowed.
 */
export function characterLimitExtension(limit: number): Extension {
  return {
    name: 'characterLimit',
    setup: (editor) => {
      editor.storage.characterLimit = limit;
      let last = getCounts(editor).characters;
      const filter = () => {
        const now = getCounts(editor).characters;
        if (now > limit && now > last) {
          editor.emit('limit', { limit, characters: now });
          return false;
        }
        return true;
      };
      editor.filters.push(filter);
      const off = editor.on('change', () => {
        last = getCounts(editor).characters;
      });
      return () => {
        off();
        const i = editor.filters.indexOf(filter);
        if (i >= 0) editor.filters.splice(i, 1);
      };
    },
  };
}

/* ------------------------------------------------------------------ find & replace */

export interface FindOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}
export interface Match {
  id: string;
  from: number;
  to: number;
}

function buildRegex(query: string, o: FindOptions): RegExp | null {
  if (!query) return null;
  let src = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(src, 'gu' + (o.caseSensitive ? '' : 'i'));
  } catch {
    return null;
  }
}

/** All matches in document order. Matches never span blocks. */
export function findAll(editor: Editor, query: string, opts: FindOptions = {}): Match[] {
  const re = buildRegex(query, opts);
  const out: Match[] = [];
  if (!re) return out;
  for (const b of editor.doc.descendants()) {
    if (!b.content || !b.length) continue;
    const text = b.text; // atoms are U+FFFC so offsets line up with the model
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      out.push({ id: b.id, from: m.index, to: m.index + m[0].length });
      if (out.length >= 10000) return out;
    }
  }
  return out;
}

function replacement(editor: Editor, m: Match, query: string, replaceWith: string, opts: FindOptions): string {
  if (!opts.regex) return replaceWith;
  const b = editor.doc.get(m.id)!;
  const re = buildRegex(query, opts)!;
  return b.text.slice(m.from, m.to).replace(new RegExp(re.source, re.flags.replace('g', '')), replaceWith);
}

export function replaceMatch(editor: Editor, m: Match, query: string, replaceWith: string, opts: FindOptions = {}): boolean {
  const b = editor.doc.get(m.id);
  if (!b || editor.readOnly || m.to > b.length) return false;
  const text = replacement(editor, m, query, replaceWith, opts);
  return editor.update((tr) => {
    const marks = sliceInline(b.content, m.from, m.from + 1)[0]?.marks;
    tr.replaceText(m.id, m.from, m.to, text, marks);
    tr.select(textSel(m.id, m.from, m.id, m.from + text.length));
  });
}

/** Replace every match in a single undoable transaction. Returns the number of replacements. */
export function replaceAll(editor: Editor, query: string, replaceWith: string, opts: FindOptions = {}): number {
  if (editor.readOnly) return 0;
  const matches = findAll(editor, query, opts);
  if (!matches.length) return 0;
  editor.update((tr) => {
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const b = editor.doc.get(m.id)!;
      const first = sliceInline(b.content, m.from, m.from + 1)[0];
      const marks = first && !isAtom(first) ? first.marks : undefined;
      tr.replaceText(m.id, m.from, m.to, replacement(editor, m, query, replaceWith, opts), marks);
    }
  });
  return matches.length;
}
