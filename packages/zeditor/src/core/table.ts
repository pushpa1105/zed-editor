/**
 * Table model utilities and commands.
 *
 * table > table_row > table_cell > blocks. Cells carry `colspan`, `rowspan` and `header`.
 * A grid map resolves spans; ragged rows (possible after concurrent edits) are tolerated and
 * repaired by `repairTable` before any local structural edit.
 */
import { Block, BlockJSON } from './model';
import type { CommandFn, Editor, Transaction } from './editor';
import { CellSelection, Selection, blockSel, firstTextBlock, lastTextBlock, textSel } from './selection';

export interface CellPos {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}
export interface TableMap {
  rows: number;
  cols: number;
  /** cell id at each grid position, or null where no cell exists */
  grid: (string | null)[][];
  pos: Map<string, CellPos>;
}

export function tableMap(table: Block): TableMap {
  const rows = table.children ?? [];
  const grid: (string | null)[][] = rows.map(() => []);
  const pos = new Map<string, CellPos>();
  let cols = 0;
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of row.children ?? []) {
      while (grid[r][c] != null) c++;
      const colspan = Math.max(1, cell.attrs.colspan | 0 || 1);
      const rowspan = Math.max(1, Math.min(cell.attrs.rowspan | 0 || 1, rows.length - r));
      pos.set(cell.id, { row: r, col: c, rowspan, colspan });
      for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) grid[r + dr][c + dc] = cell.id;
      c += colspan;
    }
  });
  for (const g of grid) cols = Math.max(cols, g.length);
  for (const g of grid) for (let c = 0; c < cols; c++) if (g[c] === undefined) g[c] = null;
  return { rows: rows.length, cols, grid, pos };
}

export function findTable(editor: Editor, b: Block | null | undefined): Block | null {
  return editor.doc.closest(b, (x) => x.type === 'table');
}
export function findCell(editor: Editor, b: Block | null | undefined): Block | null {
  return editor.doc.closest(b, (x) => x.type === 'table_cell');
}

/** canonical span attribute: 1 is stored as "absent" */
const span = (n: number): number | undefined => (n > 1 ? n : undefined);

function newCell(editor: Editor, attrs?: Record<string, any>, children?: BlockJSON[]): BlockJSON {
  return editor.schema.create('table_cell', attrs, undefined, children);
}

/** Pad short rows so the table is rectangular. Returns true if steps were added. */
export function repairTable(tr: Transaction, table: Block): boolean {
  const editor = tr.editor;
  const map = tableMap(table);
  let changed = false;
  for (let r = 0; r < map.rows; r++) {
    let missing = 0;
    for (let c = 0; c < map.cols; c++) if (map.grid[r][c] == null) missing++;
    if (missing) {
      const row = table.children![r];
      const cells: BlockJSON[] = [];
      for (let i = 0; i < missing; i++) cells.push(newCell(editor));
      tr.insert(row.id, row.children?.length ?? 0, cells);
      changed = true;
    }
  }
  return changed;
}

/** Rectangle covered by a cell selection, expanded to include merged cells completely. */
export function selectionRect(map: TableMap, a: string, b: string): { r0: number; r1: number; c0: number; c1: number } | null {
  const pa = map.pos.get(a);
  const pb = map.pos.get(b);
  if (!pa || !pb) return null;
  let r0 = Math.min(pa.row, pb.row);
  let r1 = Math.max(pa.row + pa.rowspan - 1, pb.row + pb.rowspan - 1);
  let c0 = Math.min(pa.col, pb.col);
  let c1 = Math.max(pa.col + pa.colspan - 1, pb.col + pb.colspan - 1);
  for (let again = true; again; ) {
    again = false;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const id = map.grid[r]?.[c];
        if (!id) continue;
        const p = map.pos.get(id)!;
        if (p.row < r0) (r0 = p.row), (again = true);
        if (p.col < c0) (c0 = p.col), (again = true);
        if (p.row + p.rowspan - 1 > r1) (r1 = p.row + p.rowspan - 1), (again = true);
        if (p.col + p.colspan - 1 > c1) (c1 = p.col + p.colspan - 1), (again = true);
      }
  }
  return { r0, r1, c0, c1 };
}

export function cellsInSelection(editor: Editor, sel: CellSelection): Block[] {
  const table = editor.doc.get(sel.table);
  if (!table) return [];
  const map = tableMap(table);
  const rect = selectionRect(map, sel.anchor, sel.focus);
  if (!rect) return [];
  const seen = new Set<string>();
  const out: Block[] = [];
  for (let r = rect.r0; r <= rect.r1; r++)
    for (let c = rect.c0; c <= rect.c1; c++) {
      const id = map.grid[r][c];
      if (id && !seen.has(id)) {
        seen.add(id);
        const b = editor.doc.get(id);
        if (b) out.push(b);
      }
    }
  return out;
}

interface Ctx {
  table: Block;
  map: TableMap;
  rect: { r0: number; r1: number; c0: number; c1: number };
  cell: Block;
}
/** Table context of the current selection. */
export function tableContext(editor: Editor, sel: Selection | null = editor.selection): Ctx | null {
  if (!sel) return null;
  const { doc } = editor;
  let a: Block | null = null;
  let b: Block | null = null;
  if (sel.type === 'cell') {
    a = doc.get(sel.anchor) ?? null;
    b = doc.get(sel.focus) ?? null;
  } else if (sel.type === 'text') {
    a = findCell(editor, doc.get(sel.anchor.id));
    b = findCell(editor, doc.get(sel.focus.id));
  } else if (sel.ids.length === 1) {
    const t = doc.get(sel.ids[0]);
    if (t?.type === 'table') {
      const cells = [...doc.descendants(t)].filter((x) => x.type === 'table_cell' && findTable(editor, x) === t);
      a = cells[0] ?? null;
      b = cells[cells.length - 1] ?? null;
    } else a = b = findCell(editor, t);
  }
  if (!a || !b) return null;
  const table = findTable(editor, a);
  if (!table || findTable(editor, b) !== table) return null;
  const map = tableMap(table);
  const rect = selectionRect(map, a.id, b.id);
  if (!rect) return null;
  return { table, map, rect, cell: b };
}

function focusCell(tr: Transaction, cell: Block | undefined | null, end = false): void {
  if (!cell) return;
  const t = end ? lastTextBlock(tr.doc, tr.schema, cell) : firstTextBlock(tr.doc, tr.schema, cell);
  if (t) tr.select(textSel(t.id, end ? t.length : 0));
}

/** Insert an empty row before grid row `at` (0..rows). */
export function insertRowAt(tr: Transaction, table: Block, at: number, header = false): void {
  const editor = tr.editor;
  repairTable(tr, table);
  const map = tableMap(table);
  const cells: BlockJSON[] = [];
  const grown = new Set<string>();
  for (let c = 0; c < map.cols; c++) {
    const above = at > 0 ? map.grid[at - 1][c] : null;
    const below = at < map.rows ? map.grid[at][c] : null;
    if (above && above === below) {
      if (!grown.has(above)) {
        grown.add(above);
        const cell = tr.doc.get(above)!;
        tr.setAttrs(above, { rowspan: (cell.attrs.rowspan || 1) + 1 });
      }
    } else cells.push(newCell(editor, header ? { header: true } : undefined));
  }
  const row = editor.schema.create('table_row', undefined, undefined, cells);
  tr.insert(table.id, at, [row]);
}

/** Insert an empty column before grid column `at` (0..cols). */
export function insertColumnAt(tr: Transaction, table: Block, at: number): void {
  const editor = tr.editor;
  repairTable(tr, table);
  const map = tableMap(table);
  const grown = new Set<string>();
  for (let r = 0; r < map.rows; r++) {
    const left = at > 0 ? map.grid[r][at - 1] : null;
    const right = at < map.cols ? map.grid[r][at] : null;
    if (left && left === right) {
      if (!grown.has(left)) {
        grown.add(left);
        const cell = tr.doc.get(left)!;
        tr.setAttrs(left, { colspan: (cell.attrs.colspan || 1) + 1 });
      }
      continue;
    }
    const row = table.children![r];
    let index = 0;
    for (const cell of row.children ?? []) if (map.pos.get(cell.id)!.col < at) index++;
    const neighbour = tr.doc.get(right ?? left ?? '');
    tr.insert(row.id, index, [newCell(editor, neighbour?.attrs.header && (map.pos.get(neighbour.id)!.row === r) ? { header: true } : undefined)]);
  }
  const widths: number[] | undefined = table.attrs.colWidths;
  if (Array.isArray(widths) && widths.length) {
    const w = [...widths];
    while (w.length < map.cols) w.push(0);
    w.splice(at, 0, 0);
    tr.setAttrs(table.id, { colWidths: w });
  }
}

function deleteRowAt(tr: Transaction, table: Block, r: number): void {
  const map = tableMap(table);
  const done = new Set<string>();
  const row = table.children![r];
  for (let c = 0; c < map.cols; c++) {
    const id = map.grid[r][c];
    if (!id || done.has(id)) continue;
    done.add(id);
    const p = map.pos.get(id)!;
    const cell = tr.doc.get(id)!;
    if (p.rowspan > 1) {
      if (p.row === r) {
        // move the merged cell down one row
        const next = table.children![r + 1];
        let index = 0;
        for (const x of next.children ?? []) if (map.pos.get(x.id)!.col < p.col) index++;
        const json = cell.toJSON();
        json.attrs = { ...json.attrs };
        if (p.rowspan - 1 > 1) json.attrs.rowspan = p.rowspan - 1;
        else delete json.attrs.rowspan;
        tr.remove(id);
        tr.insert(next.id, index, [json]);
      } else tr.setAttrs(id, { rowspan: span(p.rowspan - 1) });
    }
  }
  tr.remove(row.id);
}

function deleteColumnAt(tr: Transaction, table: Block, c: number): void {
  const map = tableMap(table);
  const done = new Set<string>();
  for (let r = 0; r < map.rows; r++) {
    const id = map.grid[r][c];
    if (!id || done.has(id)) continue;
    done.add(id);
    const p = map.pos.get(id)!;
    if (p.colspan > 1) tr.setAttrs(id, { colspan: span(p.colspan - 1) });
    else tr.remove(id);
  }
  const widths: number[] | undefined = table.attrs.colWidths;
  if (Array.isArray(widths) && widths.length > c) {
    const w = [...widths];
    w.splice(c, 1);
    tr.setAttrs(table.id, { colWidths: w });
  }
}

/* ------------------------------------------------------------------ commands */

export const insertTable: CommandFn = (editor, rows = 3, cols = 3, opts: { header?: boolean } = {}) => {
  rows = Math.max(1, Math.min(100, rows | 0));
  cols = Math.max(1, Math.min(50, cols | 0));
  const json = createTable(editor, rows, cols, opts.header !== false);
  const ok = editor.exec('insertBlocks', [json], { select: false });
  if (ok) {
    const t = editor.doc.get(json.id);
    const first = t && firstTextBlock(editor.doc, editor.schema, t);
    if (first) editor.setSelection(textSel(first.id, 0));
  }
  return ok;
};

export function createTable(editor: Editor, rows: number, cols: number, header = true, fill?: (r: number, c: number) => string): BlockJSON {
  const s = editor.schema;
  const rowsJ: BlockJSON[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: BlockJSON[] = [];
    for (let c = 0; c < cols; c++)
      cells.push(s.create('table_cell', header && r === 0 ? { header: true } : undefined, undefined, [s.create('paragraph', undefined, fill?.(r, c) ?? '')]));
    rowsJ.push(s.create('table_row', undefined, undefined, cells));
  }
  return s.create('table', undefined, undefined, rowsJ);
}

const withTable =
  (fn: (tr: Transaction, ctx: Ctx, editor: Editor, ...args: any[]) => void | false): CommandFn =>
  (editor, ...args) => {
    if (editor.readOnly) return false;
    const ctx = tableContext(editor);
    if (!ctx) return false;
    let result: unknown = undefined;
    const ok = editor.update((tr) => {
      result = fn(tr, ctx, editor, ...args);
    });
    return ok && result !== false;
  };

export const addRow = withTable((tr, { table, map, rect }, _e, where: 'before' | 'after' = 'after') => {
  const at = where === 'before' ? rect.r0 : rect.r1 + 1;
  insertRowAt(tr, table, at);
  const row = table.children![at];
  focusCell(tr, row.children?.[0] ?? null);
  void map;
});
export const addColumn = withTable((tr, { table, rect }, _e, where: 'before' | 'after' = 'after') => {
  const at = where === 'before' ? rect.c0 : rect.c1 + 1;
  insertColumnAt(tr, table, at);
  const m2 = tableMap(table);
  const id = m2.grid[rect.r0]?.[at];
  focusCell(tr, id ? tr.doc.get(id) : null);
});
export const deleteRow = withTable((tr, { table, map, rect }) => {
  if (rect.r1 - rect.r0 + 1 >= map.rows) {
    removeTable(tr, table);
    return;
  }
  repairTable(tr, table);
  for (let r = rect.r1; r >= rect.r0; r--) deleteRowAt(tr, table, r);
  const m2 = tableMap(table);
  const id = m2.grid[Math.min(rect.r0, m2.rows - 1)]?.[Math.min(rect.c0, m2.cols - 1)];
  focusCell(tr, id ? tr.doc.get(id) : null);
});
export const deleteColumn = withTable((tr, { table, map, rect }) => {
  if (rect.c1 - rect.c0 + 1 >= map.cols) {
    removeTable(tr, table);
    return;
  }
  repairTable(tr, table);
  for (let c = rect.c1; c >= rect.c0; c--) deleteColumnAt(tr, table, c);
  const m2 = tableMap(table);
  const id = m2.grid[Math.min(rect.r0, m2.rows - 1)]?.[Math.min(rect.c0, m2.cols - 1)];
  focusCell(tr, id ? tr.doc.get(id) : null);
});

function removeTable(tr: Transaction, table: Block): void {
  const parent = table.parent!;
  const index = table.index;
  const para = tr.schema.create('paragraph');
  tr.removeAt(parent.id, index, 1);
  tr.insert(parent.id, index, [para]);
  tr.select(textSel(para.id, 0));
}
export const deleteTable = withTable((tr, { table }) => removeTable(tr, table));

export const mergeCells = withTable((tr, { table, map, rect }, editor) => {
  const sel = editor.selection;
  if (!sel || sel.type !== 'cell') return false;
  const cells = cellsInSelection(editor, sel);
  if (cells.length < 2) return false;
  // every position of the rectangle must hold a cell
  for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) if (!map.grid[r][c]) return false;
  const keep = tr.doc.get(map.grid[rect.r0][rect.c0]!)!;
  const isEmpty = (b: Block) => tr.schema.isText(b) && b.length === 0 && !b.children;
  const moved: BlockJSON[] = [];
  for (const cell of cells) {
    if (cell === keep) continue;
    for (const child of cell.children ?? []) if (!isEmpty(child)) moved.push(child.toJSON());
  }
  for (let i = cells.length - 1; i >= 0; i--) if (cells[i] !== keep) tr.remove(cells[i].id);
  if (moved.length) {
    const only = keep.children!.length === 1 && isEmpty(keep.children![0]);
    if (only) tr.removeAt(keep.id, 0, 1);
    tr.insert(keep.id, keep.children?.length ?? 0, moved);
  }
  tr.setAttrs(keep.id, { colspan: span(rect.c1 - rect.c0 + 1), rowspan: span(rect.r1 - rect.r0 + 1) });
  // drop rows that no longer start any cell and are fully covered by the merged cell
  tr.select({ type: 'cell', table: table.id, anchor: keep.id, focus: keep.id });
});

export const splitCell = withTable((tr, { table, map, cell }, editor) => {
  const targets = editor.selection?.type === 'cell' ? cellsInSelection(editor, editor.selection) : [cell];
  let did = false;
  for (const t of targets) {
    const p = map.pos.get(t.id);
    if (!p || (p.colspan === 1 && p.rowspan === 1)) continue;
    did = true;
    tr.setAttrs(t.id, { colspan: undefined, rowspan: undefined });
    for (let r = p.row; r < p.row + p.rowspan; r++) {
      const row = table.children![r];
      // index among the row's cells: count cells of this row that start left of the first new column
      const startCol = r === p.row ? p.col + 1 : p.col;
      const count = r === p.row ? p.colspan - 1 : p.colspan;
      if (count <= 0) continue;
      let index = 0;
      for (const x of row.children ?? []) {
        const xp = map.pos.get(x.id);
        if (xp && (xp.col < startCol || x.id === t.id)) index++;
      }
      const cells: BlockJSON[] = [];
      for (let i = 0; i < count; i++) cells.push(newCell(editor, t.attrs.header ? { header: true } : undefined));
      tr.insert(row.id, index, cells);
    }
  }
  if (!did) return false;
  focusCell(tr, tr.doc.get(targets[0].id));
});

export const toggleHeaderRow = withTable((tr, { table, map }) => {
  const ids = [...new Set(map.grid[0].filter(Boolean) as string[])];
  const on = !ids.every((id) => tr.doc.get(id)!.attrs.header);
  for (const id of ids) tr.setAttrs(id, { header: on || undefined });
  void table;
});
export const toggleHeaderColumn = withTable((tr, { map }) => {
  const ids = [...new Set(map.grid.map((g) => g[0]).filter(Boolean) as string[])];
  const on = !ids.every((id) => tr.doc.get(id)!.attrs.header);
  for (const id of ids) tr.setAttrs(id, { header: on || undefined });
});

export const setColumnWidth: CommandFn = (editor, tableId: string, col: number, width: number) => {
  const table = editor.doc.get(tableId);
  if (!table || table.type !== 'table' || editor.readOnly) return false;
  const map = tableMap(table);
  const w: number[] = Array.isArray(table.attrs.colWidths) ? [...table.attrs.colWidths] : [];
  while (w.length < map.cols) w.push(0);
  w[col] = Math.max(40, Math.round(width));
  return editor.update((tr) => void tr.setAttrs(tableId, { colWidths: w }), { group: 'col-resize:' + tableId + ':' + col });
};

/** Move to the next / previous cell; Tab in the last cell appends a row. */
export const nextCell: CommandFn = (editor, dir: 1 | -1 = 1) => {
  const ctx = tableContext(editor);
  if (!ctx || editor.selection?.type === 'block') return false;
  const { table } = ctx;
  const cells = (table.children ?? []).flatMap((r) => r.children ?? []);
  const i = cells.indexOf(ctx.cell);
  const target = cells[i + dir];
  if (target) {
    const t = lastTextBlock(editor.doc, editor.schema, target);
    const f = firstTextBlock(editor.doc, editor.schema, target);
    if (t && f) editor.setSelection(textSel(f.id, 0, t.id, t.length), { scroll: true });
    return true;
  }
  if (dir < 0 || editor.readOnly) return true;
  return editor.update((tr) => {
    insertRowAt(tr, table, table.children!.length);
    const row = table.children![table.children!.length - 1];
    focusCell(tr, row.children?.[0]);
    tr.scroll();
  });
};

/** Move the caret to the cell above/below when it sits on the first/last line of a cell. */
export function cellInDirection(editor: Editor, cell: Block, dr: number, dc: number): Block | null {
  const table = findTable(editor, cell);
  if (!table) return null;
  const map = tableMap(table);
  const p = map.pos.get(cell.id);
  if (!p) return null;
  const r = dr > 0 ? p.row + p.rowspan : dr < 0 ? p.row - 1 : p.row;
  const c = dc > 0 ? p.col + p.colspan : dc < 0 ? p.col - 1 : p.col;
  const id = map.grid[r]?.[c];
  return id ? editor.doc.get(id) ?? null : null;
}

export type CellMatrix = (BlockJSON[] | null)[][];

/** Contents of the selected rectangle. Positions covered by a merged cell (not its origin) are null. */
export function cellMatrix(editor: Editor, sel: CellSelection): { matrix: CellMatrix; spans: ({ colspan: number; rowspan: number; header: boolean } | null)[][] } {
  const table = editor.doc.get(sel.table)!;
  const map = tableMap(table);
  const rect = selectionRect(map, sel.anchor, sel.focus)!;
  const matrix: CellMatrix = [];
  const spans: ({ colspan: number; rowspan: number; header: boolean } | null)[][] = [];
  for (let r = rect.r0; r <= rect.r1; r++) {
    const row: (BlockJSON[] | null)[] = [];
    const srow: ({ colspan: number; rowspan: number; header: boolean } | null)[] = [];
    for (let c = rect.c0; c <= rect.c1; c++) {
      const id = map.grid[r][c];
      const p = id ? map.pos.get(id)! : null;
      if (id && p && p.row === r && p.col === c) {
        const cell = editor.doc.get(id)!;
        row.push((cell.children ?? []).map((b) => editor.schema.serializeBlock(b)));
        srow.push({ colspan: p.colspan, rowspan: p.rowspan, header: !!cell.attrs.header });
      } else {
        row.push(null);
        srow.push(null);
      }
    }
    matrix.push(row);
    spans.push(srow);
  }
  return { matrix, spans };
}

/**
 * Paste a matrix of cell contents into a table starting at the top-left of the selection.
 *  - the table grows (rows, then columns) when the matrix extends beyond it
 *  - uneven rows are allowed: missing cells leave the destination untouched
 *  - a destination position covered by a merged cell receives data only at the merged cell's
 *    origin; data for its other positions is dropped
 *  - `null` entries (covered positions of merged source cells) are skipped
 *  - a 1x1 matrix pasted onto a multi-cell selection fills every selected cell
 */
export const pasteCells: CommandFn = (editor, matrix: CellMatrix) => {
  if (editor.readOnly || !matrix?.length) return false;
  const ctx = tableContext(editor);
  if (!ctx) return false;
  const { table, rect } = ctx;
  const { doc, schema } = editor;
  return editor.update((tr) => {
    repairTable(tr, table);
    const single = matrix.length === 1 && matrix[0].length === 1 && matrix[0][0];
    if (single && editor.selection?.type === 'cell') {
      for (const cell of cellsInSelection(editor, editor.selection)) {
        tr.removeAt(cell.id, 0, cell.children!.length);
        tr.insert(cell.id, 0, schema.sanitizeBlocks(matrix[0][0]!, undefined).map((b) => reId(b, doc)));
      }
      return;
    }
    const height = matrix.length;
    const width = Math.max(...matrix.map((r) => r.length));
    let map = tableMap(table);
    for (let r = map.rows; r < rect.r0 + height; r++) insertRowAt(tr, table, r);
    map = tableMap(table);
    for (let c = map.cols; c < rect.c0 + width; c++) insertColumnAt(tr, table, c);
    map = tableMap(table);
    let lastId: string | null = null;
    for (let r = 0; r < height; r++)
      for (let c = 0; c < matrix[r].length; c++) {
        const data = matrix[r][c];
        if (!data) continue;
        const id = map.grid[rect.r0 + r]?.[rect.c0 + c];
        const p = id ? map.pos.get(id) : null;
        if (!id || !p || p.row !== rect.r0 + r || p.col !== rect.c0 + c) continue;
        const cell = doc.get(id)!;
        const blocks = schema.sanitizeBlocks(data.length ? data : [schema.create('paragraph')]).map((b) => reId(b, doc));
        tr.removeAt(id, 0, cell.children!.length);
        tr.insert(id, 0, blocks.length ? blocks : [schema.create('paragraph')]);
        lastId = id;
      }
    const firstId = map.grid[rect.r0][rect.c0];
    const endId = map.grid[Math.min(rect.r0 + height, map.rows) - 1]?.[Math.min(rect.c0 + width, map.cols) - 1] ?? lastId;
    if (firstId && endId) tr.select({ type: 'cell', table: table.id, anchor: firstId, focus: endId });
  });
};

function reId(b: BlockJSON, doc: { has(id: string): boolean }): BlockJSON {
  // pasted content may be inserted several times: always assign fresh ids
  const walk = (j: BlockJSON): BlockJSON => ({ ...j, id: freshId(doc), children: j.children?.map(walk) });
  return walk(b);
}
let seq = 0;
function freshId(doc: { has(id: string): boolean }): string {
  let id: string;
  do id = 'c' + Date.now().toString(36) + (seq++).toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  while (doc.has(id));
  return id;
}

export const selectTable: CommandFn = (editor) => {
  const ctx = tableContext(editor);
  if (!ctx) return false;
  editor.setSelection(blockSel([ctx.table.id]));
  return true;
};

export const tableCommands: Record<string, CommandFn> = {
  insertTable,
  addRow,
  addColumn,
  deleteRow,
  deleteColumn,
  deleteTable,
  mergeCells,
  splitCell,
  toggleHeaderRow,
  toggleHeaderColumn,
  setColumnWidth,
  nextCell,
  pasteCells,
  selectTable,
};

declare module './editor' {
  interface Commands {
    insertTable(rows?: number, cols?: number, opts?: { header?: boolean }): boolean;
    addRow(where?: 'before' | 'after'): boolean;
    addColumn(where?: 'before' | 'after'): boolean;
    deleteRow(): boolean;
    deleteColumn(): boolean;
    deleteTable(): boolean;
    mergeCells(): boolean;
    splitCell(): boolean;
    toggleHeaderRow(): boolean;
    toggleHeaderColumn(): boolean;
    setColumnWidth(tableId: string, col: number, width: number): boolean;
    nextCell(dir?: 1 | -1): boolean;
    pasteCells(matrix: CellMatrix): boolean;
    selectTable(): boolean;
  }
}
