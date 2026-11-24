import { describe, it, expect, beforeEach } from 'vitest';
import { make, p, resetIds, checkInvariants, mulberry } from './helpers';
import { Editor, textSel, blockSel, createTable, toHTML, toMarkdown, fromHTML, fromMarkdown } from '../../src/core';

beforeEach(resetIds);

const WORDS = ['alpha', 'β', ' ', '\n', 'नमस्ते', 'שלום', '👨‍👩‍👧‍👦', 'é', '#tag ', '**x** ', '- ', '1. ', '> ', 'https://a.example ', '`c` '];

function randomOp(e: Editor, r: () => number): string {
  const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)];
  const textBlocks = [...e.doc.descendants()].filter((b) => b.content);
  const all = [...e.doc.descendants()];
  const randPoint = () => {
    const b = pick(textBlocks);
    return { id: b.id, offset: Math.floor(r() * (b.length + 1)) };
  };
  const ops: [string, () => void][] = [
    ['select', () => {
      if (!textBlocks.length) return;
      const a = randPoint();
      const f = r() < 0.5 ? a : randPoint();
      e.setSelection(textSel(a.id, a.offset, f.id, f.offset));
    }],
    ['blockSelect', () => {
      const b = pick(all);
      const sibs = b.parent!.children!;
      const n = 1 + Math.floor(r() * 2);
      e.setSelection(blockSel(sibs.slice(b.index, b.index + n).map((x) => x.id)));
    }],
    ['type', () => void e.commands.insertText(pick(WORDS))],
    ['type', () => void e.commands.insertText(pick(WORDS))],
    ['enter', () => void e.commands.splitBlock()],
    ['backspace', () => void e.commands.deleteBackward(pick(['char', 'char', 'word', 'line'] as const))],
    ['delete', () => void e.commands.deleteForward(pick(['char', 'word'] as const))],
    ['mark', () => void e.commands.toggleMark(pick(['bold', 'italic', 'code', 'underline', 'sub', 'sup']))],
    ['link', () => void e.commands.setLink('https://example.com/' + Math.floor(r() * 3))],
    ['type', () => void e.commands.setBlockType(pick(['paragraph', 'heading', 'quote', 'list', 'code', 'toggle']), pick([undefined, { level: 2 }, { kind: 'check' }]) as any)],
    ['indent', () => void e.commands.indent()],
    ['outdent', () => void e.commands.outdent()],
    ['align', () => void e.commands.setAlign(pick(['left', 'center', 'right'] as const))],
    ['moveUp', () => void e.commands.moveBlocksUp()],
    ['moveDown', () => void e.commands.moveBlocksDown()],
    ['moveTo', () => void e.commands.moveBlocksTo([pick(all).id], pick(all).id, pick(['before', 'after', 'inside'] as const))],
    ['dup', () => void e.commands.duplicateBlocks()],
    ['del', () => void e.commands.deleteBlocks()],
    ['wrap', () => void e.commands.wrapIn('callout')],
    ['unwrap', () => void e.commands.unwrap()],
    ['divider', () => void e.commands.insertBlock('divider')],
    ['table', () => void e.commands.insertBlocks([createTable(e, 2, 2)])],
    ['row', () => void e.commands.addRow(pick(['before', 'after'] as const))],
    ['col', () => void e.commands.addColumn(pick(['before', 'after'] as const))],
    ['delRow', () => void e.commands.deleteRow()],
    ['delCol', () => void e.commands.deleteColumn()],
    ['cells', () => {
      const cells = all.filter((b) => b.type === 'table_cell');
      if (cells.length < 2) return;
      const a = pick(cells);
      const table = e.doc.closest(a, (x) => x.type === 'table')!;
      const same = cells.filter((c) => e.doc.closest(c, (x) => x.type === 'table') === table);
      e.setSelection({ type: 'cell', table: table.id, anchor: a.id, focus: pick(same).id });
    }],
    ['merge', () => void e.commands.mergeCells()],
    ['split', () => void e.commands.splitCell()],
    ['columns', () => void e.commands.insertColumns(2)],
    ['page', () => void e.commands.insertPageBreak()],
    ['addPage', () => void (r() < 0.3 && e.commands.addPage())],
    ['selectAll', () => void e.commands.selectAll()],
    ['database', () => void (r() < 0.4 && e.commands.insertDatabase(pick(['table', 'board', 'list', 'gallery'] as const)))],
    ['dbRow', () => {
      const d = all.find((b) => b.type === 'database');
      if (d) e.commands.dbAddRow(d.id, { title: 'row ' + Math.floor(r() * 9) });
    }],
    ['dbCell', () => {
      const row = pick(all.filter((b) => b.type === 'db_row'));
      if (!row) return;
      const prop = pick(row.parent!.attrs.properties as any[]);
      e.commands.dbSetCell(row.id, prop.id, pick(['x', 3, true, 'todo', ['a'], null] as any[]));
    }],
    ['dbSchema', () => {
      const d = all.find((b) => b.type === 'database');
      if (!d) return;
      pick([
        () => e.commands.dbAddProperty(d.id, { type: pick(['text', 'number', 'select', 'checkbox'] as const) }),
        () => e.commands.dbAddView(d.id, pick(['table', 'board'] as const)),
        () => e.commands.dbSort(d.id, pick(d.attrs.properties as any[]).id, 'desc'),
        () => e.commands.dbDeleteProperty(d.id, pick(d.attrs.properties as any[]).id),
        () => e.commands.dbDeleteRow(pick(d.children ?? [{ id: 'none' }] as any[])?.id ?? 'none'),
      ])();
    }],
    ['template', () => void (r() < 0.3 && e.commands.saveAsTemplate())],
    ['toc', () => void (r() < 0.2 && e.commands.insertToc())],
    ['undo', () => void e.undo()],
    ['undo', () => void e.undo()],
    ['redo', () => void e.redo()],
    ['mode', () => e.setMode(e.mode === 'block' ? 'classic' : 'block')],
  ];
  const [name, fn] = pick(ops);
  fn();
  return name;
}

describe('randomized operations', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`keeps invariants and undoes back to the start (seed ${seed})`, () => {
      const r = mulberry(seed * 7919);
      const e = make([p('first paragraph', 'a'), p('second', 'b'), { id: 'l', type: 'list', attrs: { kind: 'bullet' }, content: [{ text: 'item' }], children: [p('child', 'lc')] }]);
      const initial = JSON.stringify(e.getJSON());
      const log: string[] = [];
      for (let i = 0; i < 400; i++) {
        let name = '?';
        try {
          name = randomOp(e, r);
          log.push(name);
          checkInvariants(e);
        } catch (err: any) {
          throw new Error(`seed ${seed} step ${i} (${log.slice(-6).join(', ')} -> ${name}): ${err.stack ?? err}`);
        }
      }
      // serializers never throw on arbitrary valid documents, and their output re-imports
      const html = toHTML(e);
      const md = toMarkdown(e);
      checkInvariants(make(fromHTML(e, html)));
      checkInvariants(make(fromMarkdown(e, md)));
      const reloaded = make(JSON.parse(JSON.stringify(e.getJSON())).blocks);
      expect(reloaded.getJSON()).toEqual(e.getJSON());
      // the whole session can be undone step by step
      let guard = 0;
      while (e.canUndo() && guard++ < 5000) {
        e.undo();
        checkInvariants(e);
      }
      // (history depth is 500 entries; 400 ops never exceed it)
      expect(JSON.stringify(e.getJSON())).toBe(initial);
    });
  }
});
