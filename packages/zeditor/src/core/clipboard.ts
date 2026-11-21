/**
 * Clipboard logic without DOM access: building the copy payload (plain text, HTML, structured
 * JSON) and applying pasted data. The view wires these to the browser's clipboard events.
 */
import { Block, BlockJSON, Inline, contentLength, contentText, isAtom, sliceInline, newId } from './model';
import type { Editor, Transaction } from './editor';
import { PasteData } from './extension';
import { blocksToHTML, esc, extractEmbeddedJSON, htmlToBlocks, inlineToHTML } from './html';
import { Point, isCollapsed, selRange, textBlocksBetween, textSel, topMost, lastTextBlock, blockSel } from './selection';
import { deleteRange, selectedBlocks } from './commands';
import { CellMatrix, cellMatrix, tableContext } from './table';
import { URL_RE } from './builtin';
import { getText } from '../features/text';

export const MIME = 'application/x-zeditor+json';

export interface ClipboardPayload {
  text: string;
  html: string;
  json: StructuredClip;
}
export type StructuredClip =
  | { kind: 'inline'; content: Inline[]; source?: string }
  | { kind: 'blocks'; blocks: BlockJSON[]; source?: string }
  | { kind: 'cells'; matrix: CellMatrix; source?: string };

function sourceId(editor: Editor): string {
  return (editor.storage.instanceId ??= 'e' + newId());
}

/** Serialize the current selection for the clipboard. Returns null when nothing is selected. */
export function copyPayload(editor: Editor): ClipboardPayload | null {
  const sel = editor.selection;
  const { doc, schema } = editor;
  if (!sel) return null;
  let json: StructuredClip;
  let html: string;
  let text: string;
  if (sel.type === 'text') {
    if (isCollapsed(sel)) return null;
    const r = selRange(doc, sel);
    if (r.from.id === r.to.id) {
      const b = doc.get(r.from.id)!;
      const content = sliceInline(b.content, r.from.offset, r.to.offset);
      json = { kind: 'inline', content };
      html = schema.node(b.type)?.code ? `<pre><code>${esc(contentText(content, ''))}</code></pre>` : `<span>${inlineToHTML(schema, content)}</span>`;
      text = contentText(content, (a) => schema.node(a.atom)?.toText?.(a) ?? '');
    } else {
      const touched = textBlocksBetween(doc, schema, r.from.id, r.to.id);
      const tops = topMost(doc, touched.map((b) => b.id));
      const blocks = tops.map((b) => schema.serializeBlock(b));
      // trim the first and last text blocks to the selected part
      const trim = (list: BlockJSON[]): void => {
        for (const j of list) {
          if (j.id === r.from.id && j.content) j.content = sliceInline(j.content, r.from.offset);
          if (j.id === r.to.id && j.content) j.content = sliceInline(j.content, 0, r.to.offset - (j.id === r.from.id ? r.from.offset : 0));
          if (j.children) trim(j.children);
        }
      };
      trim(blocks);
      json = { kind: 'blocks', blocks };
      html = blocksToHTML(schema, blocks);
      text = textOf(editor, blocks);
    }
  } else if (sel.type === 'block') {
    const blocks = selectedBlocks(editor).map((b) => schema.serializeBlock(b));
    if (!blocks.length) return null;
    json = { kind: 'blocks', blocks };
    html = blocksToHTML(schema, blocks);
    text = textOf(editor, blocks);
  } else {
    const { matrix, spans } = cellMatrix(editor, sel);
    json = { kind: 'cells', matrix };
    const rows = matrix.map((row, r) =>
      row
        .map((cell, c) => {
          if (!cell) return '';
          const s = spans[r][c]!;
          const tag = s.header ? 'th' : 'td';
          const inner = cell.length === 1 && cell[0].type === 'paragraph' ? inlineToHTML(schema, cell[0].content) : blocksToHTML(schema, cell);
          return `<${tag}${s.colspan > 1 ? ` colspan="${s.colspan}"` : ''}${s.rowspan > 1 ? ` rowspan="${s.rowspan}"` : ''}>${inner}</${tag}>`;
        })
        .join(''),
    );
    html = `<table><tbody>${rows.map((r) => `<tr>${r}</tr>`).join('')}</tbody></table>`;
    text = matrix.map((row) => row.map((cell) => (cell ? textOf(editor, cell).replace(/[\t\n]+/g, ' ') : '')).join('\t')).join('\n');
  }
  json.source = sourceId(editor);
  // the structured payload also rides inside the HTML so it survives browsers that drop custom types
  const wrapped = `<div data-zeditor-json="${esc(encodeURIComponent(JSON.stringify(json)))}">${html}</div>`;
  return { text, html: wrapped, json };
}

function textOf(editor: Editor, blocks: BlockJSON[]): string {
  const tmp = editor.schema.parse(JSON.parse(JSON.stringify(blocks))).blocks;
  return getText(editor, tmp);
}

/** Parse tab-separated text (spreadsheets) into a cell matrix. Handles quoted cells. */
export function parseTSV(editor: Editor, text: string): CellMatrix {
  const rows: string[][] = [[]];
  let cur = '';
  let quoted = false;
  const s = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur === '') quoted = true;
    else if (ch === '\t') {
      rows[rows.length - 1].push(cur);
      cur = '';
    } else if (ch === '\n') {
      rows[rows.length - 1].push(cur);
      cur = '';
      rows.push([]);
    } else cur += ch;
  }
  rows[rows.length - 1].push(cur);
  return rows.map((r) => r.map((t) => [editor.schema.create('paragraph', undefined, t)]));
}

/** Convert an imported table block into a matrix; covered positions of merged cells become null. */
export function tableToMatrix(table: BlockJSON): CellMatrix {
  const out: CellMatrix = [];
  const rows = table.children ?? [];
  rows.forEach((row, r) => {
    out[r] ??= [];
    let c = 0;
    for (const cell of row.children ?? []) {
      while (out[r][c] !== undefined) c++;
      const cs = Math.max(1, cell.attrs?.colspan ?? 1);
      const rs = Math.max(1, cell.attrs?.rowspan ?? 1);
      for (let dr = 0; dr < rs; dr++)
        for (let dc = 0; dc < cs; dc++) {
          out[r + dr] ??= [];
          out[r + dr][c + dc] = dr === 0 && dc === 0 ? cell.children ?? [] : null;
        }
      c += cs;
    }
  });
  const width = Math.max(0, ...out.map((r) => r.length));
  return out.map((r) => Array.from({ length: Math.min(r.length, width) }, (_, i) => r[i] ?? null));
}

const REVIEW_MARKS = ['comment', 'suggestion'];
function stripReview(content: Inline[] | undefined): Inline[] | undefined {
  return content?.map((c) => {
    if (!c.marks) return c;
    const marks = { ...c.marks };
    for (const k of REVIEW_MARKS) delete marks[k];
    return { ...c, marks: Object.keys(marks).length ? marks : undefined } as Inline;
  });
}
function stripReviewBlocks(blocks: BlockJSON[]): BlockJSON[] {
  return blocks.map((b) => ({ ...b, content: stripReview(b.content), children: b.children ? stripReviewBlocks(b.children) : undefined }));
}

/** Insert inline content at the selection (replacing it). */
export function insertInlineContent(editor: Editor, content: Inline[]): boolean {
  const sel = editor.selection;
  if (!sel || sel.type !== 'text') return false;
  const { doc, schema } = editor;
  return editor.update(
    (tr) => {
      const r = selRange(doc, sel);
      const p = r.collapsed ? r.from : deleteRange(tr, r.from, r.to);
      const b = doc.get(p.id)!;
      const spec = schema.node(b.type);
      let ins = schema.parseInline(content, spec, []);
      if (spec?.code) {
        const t = contentText(content, '');
        ins = t ? [{ text: t }] : [];
      }
      tr.replaceText(p.id, p.offset, p.offset, ins);
      tr.select(textSel(p.id, p.offset + contentLength(ins))).scroll();
    },
    { origin: 'paste' },
  );
}

/**
 * Insert blocks at the selection the way a paste should behave:
 *  - a single plain paragraph is inserted inline
 *  - otherwise the current block is split at the caret, a leading paragraph joins the text
 *    before the caret, and the text after the caret follows the pasted blocks
 */
export function insertContent(editor: Editor, input: BlockJSON[]): boolean {
  const { doc, schema } = editor;
  let blocks = schema.sanitizeBlocks(input, doc);
  if (!blocks.length || editor.readOnly) return false;
  const sel = editor.selection;
  if (!sel) return false;
  if (sel.type !== 'text') return editor.exec('insertBlocks', blocks);
  const focus = doc.get(sel.focus.id)!;
  const fspec = schema.node(focus.type)!;
  if (fspec.code) return insertInlineContent(editor, [{ text: textOf(editor, blocks) }]);
  if (blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].children) return insertInlineContent(editor, blocks[0].content ?? []);
  return editor.update(
    (tr) => {
      const r = selRange(doc, sel);
      const p: Point = r.collapsed ? r.from : deleteRange(tr, r.from, r.to);
      let cur = doc.get(p.id)!;
      const tail = sliceInline(cur.content, p.offset);
      const curEmpty = cur.length === 0 && !cur.children && cur.type === 'paragraph';
      let caret: Point | null = null;
      // a leading paragraph continues the current line
      if (!curEmpty && blocks[0].type === 'paragraph' && !blocks[0].children && p.offset > 0) {
        const first = schema.parseInline(blocks[0].content, schema.node(cur.type), []);
        tr.replaceText(cur.id, p.offset, cur.length, first);
        caret = { id: cur.id, offset: p.offset + contentLength(first) };
        blocks = blocks.slice(1);
      } else if (tail.length) tr.replaceText(cur.id, p.offset, cur.length);
      cur = doc.get(p.id)!;
      // where the remaining blocks go: after the current block, at a level that accepts them
      let parent: Block = cur.parent!;
      let index = cur.index + 1;
      let anchor: Block = cur;
      while (parent !== doc.root && !blocks.every((b) => b.type === 'unknown' || schema.canContain(parent, b.type))) {
        anchor = parent;
        index = parent.index + 1;
        parent = parent.parent!;
      }
      const replaceCur = curEmpty && anchor === cur && blocks.length > 0 && !tail.length;
      if (blocks.length) {
        tr.insert(parent.id, index, blocks);
        const lastJ = blocks[blocks.length - 1];
        const last = doc.get(lastJ.id)!;
        const lt = schema.isText(last) ? last : lastTextBlock(doc, schema, last);
        if (tail.length) {
          if (lt && lt === last && !schema.node(last.type)?.code) {
            caret = { id: last.id, offset: last.length };
            tr.replaceText(last.id, last.length, last.length, schema.parseInline(tail, schema.node(last.type), []));
          } else {
            const para = schema.create('paragraph', undefined, tail);
            tr.insert(parent.id, index + blocks.length, [para]);
            caret = { id: para.id, offset: 0 };
          }
        } else if (lt) caret = { id: lt.id, offset: lt.length };
        else caret = null;
        if (replaceCur) tr.remove(cur.id);
        else if (p.offset === 0 && !tail.length && cur.length === 0 && !cur.children && doc.get(cur.id) && anchor === cur) tr.remove(cur.id);
        if (!caret) {
          // pasted content ends with an atom: continue in a paragraph after it
          const l2 = doc.get(lastJ.id)!;
          const next = l2.nextSibling;
          if (next && schema.isText(next)) caret = { id: next.id, offset: 0 };
          else if (schema.canContain(l2.parent!, 'paragraph')) {
            const para = schema.create('paragraph');
            tr.insertAfter(l2.id, [para]);
            caret = { id: para.id, offset: 0 };
          }
        }
        if (caret) tr.select(textSel(caret.id, caret.offset));
        else tr.select(blockSel([lastJ.id]));
      } else if (caret) {
        // everything merged into the current block: put the tail back after it
        tr.replaceText(caret.id, caret.offset, caret.offset, tail);
        tr.select(textSel(caret.id, caret.offset));
      }
      tr.scroll();
    },
    { origin: 'paste' },
  );
}

function runPaste(editor: Editor, fn: (tr: Transaction | null) => boolean): boolean {
  editor.cutHistory();
  const ok = fn(null);
  editor.cutHistory();
  return ok;
}

/**
 * Apply pasted data. Order: extension paste rules, structured payload, table ranges,
 * URL-on-selection, HTML, plain text. Files are left to the host (uploads).
 */
export function pasteData(editor: Editor, data: PasteData): boolean {
  if (editor.readOnly) return false;
  for (const rule of editor.pasteRules) if (rule.run(editor, data)) return true;
  const sel = editor.selection;
  if (!sel) return false;
  const { schema } = editor;
  const json: StructuredClip | null = data.json ?? (data.html ? extractEmbeddedJSON(data.html) : null);
  const inTable = !!tableContext(editor) && sel.type !== 'block';
  const sameSource = !!json && json.source === editor.storage.instanceId;

  return runPaste(editor, () => {
    if (json && typeof json === 'object') {
      if (json.kind === 'cells' && Array.isArray(json.matrix)) {
        if (inTable) return editor.exec('pasteCells', json.matrix);
        // outside a table: paste the range as a new table
        const s = schema;
        const rows = json.matrix.map((row) => s.create('table_row', undefined, undefined, row.map((cell) => s.create('table_cell', undefined, undefined, cell && cell.length ? cell : undefined))));
        return insertContent(editor, [s.create('table', undefined, undefined, rows)]);
      }
      if (json.kind === 'inline' && Array.isArray(json.content)) {
        const content = sameSource ? json.content : stripReview(json.content)!;
        if (sel.type === 'cell') return editor.exec('pasteCells', [[[schema.create('paragraph', undefined, schema.parseInline(content, undefined, []))]]]);
        if (sel.type === 'block') return editor.exec('insertBlocks', [schema.create('paragraph', undefined, schema.parseInline(content, undefined, []))]);
        return insertInlineContent(editor, content);
      }
      if (json.kind === 'blocks' && Array.isArray(json.blocks)) {
        const blocks = sameSource ? json.blocks : stripReviewBlocks(json.blocks);
        if (sel.type === 'cell') return editor.exec('pasteCells', [[schema.sanitizeBlocks(blocks)]]);
        return insertContent(editor, blocks);
      }
    }
    const text = data.text ?? '';
    if (data.html) {
      const blocks = htmlToBlocks(schema, data.html);
      if (blocks.length === 1 && blocks[0].type === 'table' && inTable) return editor.exec('pasteCells', tableToMatrix(blocks[0]));
      if (sel.type === 'cell' && blocks.length) return editor.exec('pasteCells', [[blocks]]);
      // a URL copied from the address bar arrives as an <a>: treat as plain URL when text selected
      if (blocks.length && !(isSingleUrl(text) && sel.type === 'text' && !isCollapsed(sel))) return insertContent(editor, blocks);
    }
    if (!text) return false;
    if (inTable && (text.includes('\t') || sel.type === 'cell')) return editor.exec('pasteCells', parseTSV(editor, text));
    if (sel.type === 'text' && !isCollapsed(sel) && isSingleUrl(text) && schema.marks.has('link')) {
      const b = editor.doc.get(sel.focus.id);
      if (b && !schema.node(b.type)?.code) return editor.exec('setLink', /^www\./i.test(text.trim()) ? 'https://' + text.trim() : text.trim());
    }
    const focus = sel.type === 'text' ? editor.doc.get(sel.focus.id) : null;
    if (focus && schema.node(focus.type)?.code) return insertInlineContent(editor, [{ text: text.replace(/\r\n?/g, '\n') }]);
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
    const toInline = (line: string): Inline[] => {
      // linkify bare URLs in pasted plain text
      const out: Inline[] = [];
      let rest = line;
      const re = new RegExp(URL_RE.source, 'i');
      for (let m = re.exec(rest); m && schema.marks.has('link'); m = re.exec(rest)) {
        if (m.index) out.push({ text: rest.slice(0, m.index) });
        const href = /^www\./i.test(m[0]) ? 'https://' + m[0] : m[0];
        const link = schema.parseMarks({ link: { href } })?.link;
        out.push(link ? { text: m[0], marks: { link } } : { text: m[0] });
        rest = rest.slice(m.index + m[0].length);
      }
      if (rest) out.push({ text: rest });
      return out;
    };
    if (lines.length === 1) {
      if (sel.type !== 'text') return editor.exec('insertText', lines[0], { rules: false });
      return insertInlineContent(editor, toInline(lines[0]));
    }
    return insertContent(
      editor,
      lines.map((l) => schema.create('paragraph', undefined, toInline(l))),
    );
  });
}

function isSingleUrl(text: string): boolean {
  const t = text.trim();
  return !!t && !/\s/.test(t) && new RegExp('^(?:' + URL_RE.source + ')$', 'i').test(t);
}

/** Copy, then delete the selection (cut). Returns the payload that was removed. */
export function cutPayload(editor: Editor): ClipboardPayload | null {
  const payload = copyPayload(editor);
  if (!payload || editor.readOnly) return payload;
  editor.cutHistory();
  editor.exec('deleteSelection');
  editor.cutHistory();
  return payload;
}

void isAtom;
