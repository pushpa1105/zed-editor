import { describe, it, expect, beforeEach } from 'vitest';
import { make, p, resetIds, checkInvariants, caret } from './helpers';
import { Editor, tableMap, createTable, firstTextBlock, textSel, getText, BlockJSON, cellMatrix } from '../../src/core';

beforeEach(resetIds);

function withTable(rows = 3, cols = 3): { e: Editor; table: string; cell: (r: number, c: number) => string; grid: () => string } {
  const e = make([p('before', 'a')]);
  const t = createTable(e, rows, cols, true, (r, c) => `${r}${c}`);
  e.commands.insertBlocks([t], { after: 'a' });
  const cell = (r: number, c: number) => tableMap(e.doc.get(t.id)!).grid[r][c]!;
  const grid = () => {
    const table = e.doc.get(t.id)!;
    return table.children!.map((row) => row.children!.map((c) => getText(e, c.children!) + (c.attrs.colspan > 1 || c.attrs.rowspan > 1 ? `[${c.attrs.colspan ?? 1}x${c.attrs.rowspan ?? 1}]` : '')).join(',')).join(' / ');
  };
  return { e, table: t.id, cell, grid };
}
const inCell = (e: Editor, cellId: string) => {
  const t = firstTextBlock(e.doc, e.schema, e.doc.get(cellId)!)!;
  e.setSelection(textSel(t.id, 0));
};
const cells = (rows: string[][]): BlockJSON[][][] => rows.map((r) => r.map((t) => [{ id: 'x' + Math.random().toString(36).slice(2), type: 'paragraph', content: t ? [{ text: t }] : [] }]));

describe('tables', () => {
  it('inserts and removes rows and columns, undoably', () => {
    const { e, cell, grid } = withTable(2, 2);
    const before = e.getJSON();
    inCell(e, cell(0, 1));
    e.commands.addColumn('after');
    e.commands.addRow('before');
    expect(grid()).toBe(',, / 00,01, / 10,11,');
    inCell(e, cell(1, 0));
    e.commands.deleteColumn();
    expect(grid()).toBe(', / 01, / 11,');
    e.commands.deleteRow();
    expect(grid()).toBe(', / 11,');
    checkInvariants(e);
    while (e.canUndo()) e.undo();
    expect(e.getJSON().blocks.length).toBe(1);
    void before;
  });

  it('merges and splits cells; row/column edits respect spans', () => {
    const { e, table, cell, grid } = withTable(3, 3);
    e.setSelection({ type: 'cell', table, anchor: cell(0, 0), focus: cell(1, 1) });
    expect(e.commands.mergeCells()).toBe(true);
    expect(grid()).toBe('00\n01\n10\n11[2x2],02 / 12 / 20,21,22');
    let map = tableMap(e.doc.get(table)!);
    expect(map.cols).toBe(3);
    expect(map.grid[1][1]).toBe(map.grid[0][0]);
    // inserting a column through the merged cell widens it
    inCell(e, cell(2, 0));
    e.commands.addColumn('after');
    map = tableMap(e.doc.get(table)!);
    expect(map.cols).toBe(4);
    expect(e.doc.get(map.grid[0][0]!)!.attrs.colspan).toBe(3);
    // deleting a row through the merged cell shrinks it
    inCell(e, map.grid[1][3]!);
    e.commands.deleteRow();
    map = tableMap(e.doc.get(table)!);
    expect(map.rows).toBe(2);
    expect(e.doc.get(map.grid[0][0]!)!.attrs.rowspan ?? 1).toBe(1);
    inCell(e, map.grid[0][0]!);
    expect(e.commands.splitCell()).toBe(true);
    map = tableMap(e.doc.get(table)!);
    expect(map.grid.every((r) => r.every(Boolean))).toBe(true);
    expect(new Set(map.grid.flat()).size).toBe(8);
    checkInvariants(e);
    while (e.canUndo()) e.undo();
    expect(getText(e)).toBe('before');
  });

  it('tab moves between cells and appends a row at the end', () => {
    const { e, table, cell } = withTable(1, 2);
    inCell(e, cell(0, 0));
    e.commands.nextCell(1);
    expect(e.doc.closest(e.doc.get((e.selection as any).focus.id), (b) => b.type === 'table_cell')!.id).toBe(cell(0, 1));
    e.commands.nextCell(1);
    expect(tableMap(e.doc.get(table)!).rows).toBe(2);
  });

  it('pastes a spreadsheet range: grows the table, handles uneven rows, undo restores, reload matches', () => {
    const { e, table, cell, grid } = withTable(2, 2);
    const before = JSON.stringify(e.getJSON());
    inCell(e, cell(1, 1));
    // 3 rows x up to 3 columns, second row is short
    e.commands.pasteCells(cells([['A', 'B', 'C'], ['D'], ['E', 'F', 'G']]));
    expect(grid()).toBe('00,01,, / 10,A,B,C / ,D,, / ,E,F,G');
    const map = tableMap(e.doc.get(table)!);
    expect([map.rows, map.cols]).toEqual([4, 4]);
    checkInvariants(e);
    const saved = JSON.stringify(e.getJSON());
    const reloaded = make(JSON.parse(saved).blocks);
    expect(JSON.stringify(reloaded.getJSON())).toBe(saved);
    e.undo();
    expect(JSON.stringify(e.getJSON())).toBe(before);
    e.redo();
    expect(JSON.stringify(e.getJSON())).toBe(saved);
  });

  it('paste onto merged destination cells writes only at the merged origin', () => {
    const { e, table, cell, grid } = withTable(2, 3);
    e.setSelection({ type: 'cell', table, anchor: cell(0, 1), focus: cell(0, 2) });
    e.commands.mergeCells();
    inCell(e, cell(0, 0));
    e.commands.pasteCells(cells([['a', 'b', 'c'], ['d', 'e', 'f']]));
    expect(grid()).toBe('a,b[2x1] / d,e,f');
  });

  it('a single copied cell fills the whole cell selection', () => {
    const { e, table, cell, grid } = withTable(2, 2);
    e.setSelection({ type: 'cell', table, anchor: cell(0, 0), focus: cell(1, 1) });
    e.commands.pasteCells(cells([['z']]));
    expect(grid()).toBe('z,z / z,z');
    checkInvariants(e);
  });

  it('copies a rectangular selection as a matrix with merged cells marked', () => {
    const { e, table, cell } = withTable(2, 2);
    e.setSelection({ type: 'cell', table, anchor: cell(0, 0), focus: cell(0, 1) });
    e.commands.mergeCells();
    const sel = { type: 'cell' as const, table, anchor: cell(0, 0), focus: cell(1, 1) };
    const { matrix, spans } = cellMatrix(e, sel);
    expect(matrix[0][1]).toBeNull();
    expect(spans[0][0]).toMatchObject({ colspan: 2 });
    expect(matrix[1].length).toBe(2);
  });

  it('repairs ragged tables (concurrent shape edits) before structural edits', () => {
    const { e, table, cell } = withTable(2, 2);
    // simulate a remote edit that removed one cell
    const row = e.doc.get(table)!.children![1];
    e.update((tr) => void tr.removeAt(row.id, 1, 1), { origin: 'remote', history: false });
    expect(tableMap(e.doc.get(table)!).grid[1][1]).toBeNull();
    inCell(e, cell(0, 0));
    e.commands.addRow('after');
    const map = tableMap(e.doc.get(table)!);
    expect(map.grid.every((r) => r.every(Boolean))).toBe(true);
    checkInvariants(e);
  });

  it('delete across a table boundary keeps the table structure', () => {
    const { e, table, cell } = withTable(2, 2);
    const t = firstTextBlock(e.doc, e.schema, e.doc.get(cell(0, 1))!)!;
    caret(e, 'a', 2, t.id, 1);
    e.commands.deleteSelection();
    expect(e.doc.get('a')!.text).toBe('be');
    const map = tableMap(e.doc.get(table)!);
    expect([map.rows, map.cols]).toEqual([2, 2]);
    checkInvariants(e);
  });
});
