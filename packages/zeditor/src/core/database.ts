/**
 * Databases (Notion-style): a `database` block holds typed properties and saved views; every
 * row is a `db_row` block with a cell value per property **and its own child blocks** (the
 * row's page content). Because rows are ordinary blocks, history, clipboard, comments and
 * collaboration work on them unchanged, and concurrent edits to different rows merge.
 *
 * Everything here is headless: the model, validation, querying (filter / sort / group /
 * calculate) and commands. Rendering lives in view/notion-render.ts.
 */
import { Attrs, Block, BlockJSON, newId } from './model';
import type { CommandFn, Editor } from './editor';
import type { Extension, SlashItem } from './extension';
import type { NodeSpec } from './schema';
import { esc } from './html';
import { safeUrl } from './schema';
import { firstTextBlock, textSel, blockSel } from './selection';

export type DbPropertyType = 'title' | 'text' | 'number' | 'select' | 'multi_select' | 'checkbox' | 'date' | 'url' | 'email' | 'person';
export const DB_PROPERTY_TYPES: DbPropertyType[] = ['title', 'text', 'number', 'select', 'multi_select', 'checkbox', 'date', 'url', 'email', 'person'];
export const DB_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
export type DbColor = (typeof DB_COLORS)[number];

export interface DbOption {
  id: string;
  name: string;
  color: DbColor;
}
export interface DbProperty {
  id: string;
  name: string;
  type: DbPropertyType;
  options?: DbOption[];
  width?: number;
}
export type DbFilterOp = 'contains' | 'not_contains' | 'is' | 'is_not' | 'empty' | 'not_empty' | 'gt' | 'lt' | 'checked' | 'unchecked';
export const DB_FILTER_OPS: DbFilterOp[] = ['contains', 'not_contains', 'is', 'is_not', 'empty', 'not_empty', 'gt', 'lt', 'checked', 'unchecked'];
export interface DbFilter {
  prop: string;
  op: DbFilterOp;
  value?: string;
}
export interface DbSort {
  prop: string;
  dir: 'asc' | 'desc';
}
export type DbCalc = 'count' | 'filled' | 'empty' | 'unique' | 'sum' | 'avg' | 'min' | 'max' | 'checked' | 'percent_checked';
export const DB_CALCS: DbCalc[] = ['count', 'filled', 'empty', 'unique', 'sum', 'avg', 'min', 'max', 'checked', 'percent_checked'];
export type DbViewType = 'table' | 'board' | 'list' | 'gallery';
export const DB_VIEW_TYPES: DbViewType[] = ['table', 'board', 'list', 'gallery'];
export interface DbView {
  id: string;
  name: string;
  type: DbViewType;
  filters?: DbFilter[];
  sorts?: DbSort[];
  /** select property to group by (board columns; optional sections in other views) */
  groupBy?: string;
  /** property ids hidden in this view */
  hidden?: string[];
  calc?: Record<string, DbCalc>;
}

/* ------------------------------------------------------------------ validation (documents are untrusted) */

const ID = /^[\w:.-]{1,64}$/;
const str = (x: any, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
const one = <T extends string>(x: any, list: readonly T[], def: T): T => (list.includes(x) ? x : def);

function cleanProperties(x: any): DbProperty[] {
  const out: DbProperty[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(x) ? x.slice(0, 100) : []) {
    if (!p || typeof p !== 'object' || !ID.test(p.id) || seen.has(p.id)) continue;
    seen.add(p.id);
    const prop: DbProperty = { id: p.id, name: str(p.name, 100) || 'Property', type: one(p.type, DB_PROPERTY_TYPES, 'text') };
    if (prop.type === 'select' || prop.type === 'multi_select') {
      const ids = new Set<string>();
      prop.options = (Array.isArray(p.options) ? p.options.slice(0, 200) : [])
        .filter((o: any) => o && ID.test(o.id) && !ids.has(o.id) && ids.add(o.id))
        .map((o: any) => ({ id: o.id, name: str(o.name, 100) || 'Option', color: one(o.color, DB_COLORS, 'gray') }));
    }
    const w = Math.round(Number(p.width));
    if (Number.isFinite(w) && w > 0) prop.width = Math.max(60, Math.min(800, w));
    out.push(prop);
  }
  // exactly one title property, always first
  const titles = out.filter((p) => p.type === 'title');
  for (const extra of titles.slice(1)) extra.type = 'text';
  if (!titles.length) out.unshift({ id: 'title', name: 'Name', type: 'title' });
  else out.sort((a, b) => Number(b.type === 'title') - Number(a.type === 'title'));
  return out;
}
function cleanViews(x: any): DbView[] {
  const out: DbView[] = [];
  const seen = new Set<string>();
  for (const v of Array.isArray(x) ? x.slice(0, 30) : []) {
    if (!v || typeof v !== 'object' || !ID.test(v.id) || seen.has(v.id)) continue;
    seen.add(v.id);
    const view: DbView = { id: v.id, name: str(v.name, 60) || 'View', type: one(v.type, DB_VIEW_TYPES, 'table') };
    const filters = (Array.isArray(v.filters) ? v.filters.slice(0, 20) : []).filter((f: any) => f && ID.test(f.prop)).map((f: any) => ({ prop: f.prop, op: one(f.op, DB_FILTER_OPS, 'contains'), value: str(f.value, 200) }));
    if (filters.length) view.filters = filters;
    const sorts = (Array.isArray(v.sorts) ? v.sorts.slice(0, 5) : []).filter((s: any) => s && ID.test(s.prop)).map((s: any) => ({ prop: s.prop, dir: s.dir === 'desc' ? 'desc' : 'asc' }) as DbSort);
    if (sorts.length) view.sorts = sorts;
    if (typeof v.groupBy === 'string' && ID.test(v.groupBy)) view.groupBy = v.groupBy;
    const hidden = (Array.isArray(v.hidden) ? v.hidden.slice(0, 100) : []).filter((h: any) => typeof h === 'string' && ID.test(h));
    if (hidden.length) view.hidden = hidden;
    if (v.calc && typeof v.calc === 'object') {
      const calc: Record<string, DbCalc> = {};
      for (const k of Object.keys(v.calc).slice(0, 100)) if (ID.test(k) && DB_CALCS.includes(v.calc[k])) calc[k] = v.calc[k];
      if (Object.keys(calc).length) view.calc = calc;
    }
    out.push(view);
  }
  if (!out.length) out.push({ id: 'v1', name: 'Table', type: 'table' });
  return out;
}
function cleanCells(x: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  for (const k of Object.keys(x).slice(0, 100)) {
    if (!ID.test(k)) continue;
    const v = x[k];
    if (typeof v === 'string') out[k] = v.slice(0, 5000);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((i) => typeof i === 'string' && ID.test(i)).slice(0, 50);
  }
  return out;
}

/* ------------------------------------------------------------------ querying */

export function dbProperties(db: Block): DbProperty[] {
  return (db.attrs.properties as DbProperty[]) ?? [];
}
export function dbViews(db: Block): DbView[] {
  return (db.attrs.views as DbView[]) ?? [];
}
export function dbActiveView(db: Block): DbView {
  const views = dbViews(db);
  return views.find((v) => v.id === db.attrs.view) ?? views[0];
}
export function dbRows(db: Block): Block[] {
  return (db.children ?? []).filter((r) => r.type === 'db_row');
}
export function cellValue(row: Block, prop: DbProperty): any {
  const v = (row.attrs.cells ?? {})[prop.id];
  switch (prop.type) {
    case 'number':
      return typeof v === 'number' ? v : v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v);
    case 'checkbox':
      return v === true;
    case 'multi_select':
      return Array.isArray(v) ? v.filter((id) => prop.options?.some((o) => o.id === id)) : [];
    case 'select':
      return typeof v === 'string' && prop.options?.some((o) => o.id === v) ? v : null;
    default:
      return v == null ? '' : String(v);
  }
}
/** Display text of a cell (also what filters, sorts and exports use). */
export function cellText(row: Block, prop: DbProperty): string {
  const v = cellValue(row, prop);
  if (prop.type === 'select') return prop.options?.find((o) => o.id === v)?.name ?? '';
  if (prop.type === 'multi_select') return (v as string[]).map((id) => prop.options!.find((o) => o.id === id)!.name).join(', ');
  if (prop.type === 'checkbox') return v ? '✓' : '';
  return v == null ? '' : String(v);
}
function isEmptyCell(row: Block, prop: DbProperty): boolean {
  const v = cellValue(row, prop);
  return prop.type === 'checkbox' ? !v : v == null || v === '' || (Array.isArray(v) && !v.length);
}
function matches(row: Block, prop: DbProperty, f: DbFilter): boolean {
  const text = cellText(row, prop).toLowerCase();
  const want = (f.value ?? '').toLowerCase();
  switch (f.op) {
    case 'empty':
      return isEmptyCell(row, prop);
    case 'not_empty':
      return !isEmptyCell(row, prop);
    case 'checked':
      return cellValue(row, prop) === true;
    case 'unchecked':
      return cellValue(row, prop) !== true;
    case 'is':
      return prop.type === 'multi_select' ? text.split(', ').includes(want) : text === want;
    case 'is_not':
      return prop.type === 'multi_select' ? !text.split(', ').includes(want) : text !== want;
    case 'contains':
      return !want || text.includes(want);
    case 'not_contains':
      return !want || !text.includes(want);
    case 'gt':
    case 'lt': {
      if (want === '') return true;
      const a = prop.type === 'number' ? (cellValue(row, prop) as number | null) : text;
      const b = prop.type === 'number' ? Number(f.value) : want;
      if (a == null || a === '') return false;
      return f.op === 'gt' ? a > b : a < b;
    }
  }
}
function compare(a: Block, b: Block, prop: DbProperty): number {
  if (prop.type === 'number' || prop.type === 'checkbox') {
    const x = cellValue(a, prop);
    const y = cellValue(b, prop);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // empty values last
    return Number(x) - Number(y);
  }
  if (prop.type === 'select') {
    // option order, not alphabetical
    const idx = (r: Block) => {
      const i = prop.options!.findIndex((o) => o.id === cellValue(r, prop));
      return i < 0 ? Infinity : i;
    };
    return idx(a) - idx(b) || 0;
  }
  const x = cellText(a, prop);
  const y = cellText(b, prop);
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
}

export function calculate(rows: Block[], prop: DbProperty, calc: DbCalc): string {
  const filled = rows.filter((r) => !isEmptyCell(r, prop));
  const nums = rows.map((r) => (prop.type === 'number' ? (cellValue(r, prop) as number | null) : Number(cellText(r, prop)))).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n !== null);
  const numeric = prop.type === 'number' ? nums : filled.length ? nums : [];
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  switch (calc) {
    case 'count':
      return String(rows.length);
    case 'filled':
      return String(filled.length);
    case 'empty':
      return String(rows.length - filled.length);
    case 'unique':
      return String(new Set(filled.map((r) => cellText(r, prop))).size);
    case 'sum':
      return fmt(numeric.reduce((a, b) => a + b, 0));
    case 'avg':
      return numeric.length ? fmt(numeric.reduce((a, b) => a + b, 0) / numeric.length) : '';
    case 'min':
      return numeric.length ? fmt(Math.min(...numeric)) : '';
    case 'max':
      return numeric.length ? fmt(Math.max(...numeric)) : '';
    case 'checked':
      return String(rows.filter((r) => cellValue(r, prop) === true).length);
    case 'percent_checked':
      return rows.length ? Math.round((rows.filter((r) => cellValue(r, prop) === true).length / rows.length) * 100) + '%' : '';
  }
}

export interface DbGroup {
  /** option of the group-by property; null for rows without a value */
  option: DbOption | null;
  rows: Block[];
}
export interface DbResult {
  view: DbView;
  /** all properties, title first */
  properties: DbProperty[];
  /** properties shown in this view */
  visible: DbProperty[];
  /** rows after filters and sorts */
  rows: Block[];
  /** present when the view is grouped (always for boards with a select property) */
  groups: DbGroup[] | null;
  groupBy: DbProperty | null;
  calc: Record<string, string>;
  total: number;
}

/** Evaluate a view: filter, sort, group and calculate. Pure; does not touch the document. */
export function queryDatabase(db: Block, viewId?: string): DbResult {
  const properties = dbProperties(db);
  const view = dbViews(db).find((v) => v.id === viewId) ?? dbActiveView(db);
  const byId = new Map(properties.map((p) => [p.id, p]));
  const all = dbRows(db);
  let rows = all.filter((r) => (view.filters ?? []).every((f) => !byId.has(f.prop) || matches(r, byId.get(f.prop)!, f)));
  const sorts = (view.sorts ?? []).filter((s) => byId.has(s.prop));
  if (sorts.length) {
    const order = new Map(all.map((r, i) => [r.id, i]));
    rows = [...rows].sort((a, b) => {
      for (const s of sorts) {
        const prop = byId.get(s.prop)!;
        const empty = (r: Block) => isEmptyCell(r, prop) && prop.type !== 'checkbox';
        // rows without a value stay at the end in both directions
        if (empty(a) !== empty(b)) return empty(a) ? 1 : -1;
        const c = compare(a, b, prop);
        if (c) return s.dir === 'desc' ? -c : c;
      }
      return order.get(a.id)! - order.get(b.id)!;
    });
  }
  let groupBy = view.groupBy ? (byId.get(view.groupBy) ?? null) : null;
  if (groupBy && groupBy.type !== 'select') groupBy = null;
  if (!groupBy && view.type === 'board') groupBy = properties.find((p) => p.type === 'select') ?? null;
  let groups: DbGroup[] | null = null;
  if (groupBy) {
    const g = groupBy;
    groups = [{ option: null as DbOption | null, rows: [] as Block[] }, ...(g.options ?? []).map((o) => ({ option: o as DbOption | null, rows: [] as Block[] }))];
    for (const r of rows) (groups.find((x) => x.option?.id === cellValue(r, g)) ?? groups[0]).rows.push(r);
  }
  const hidden = new Set(view.hidden ?? []);
  const calc: Record<string, string> = {};
  for (const k in view.calc ?? {}) if (byId.has(k)) calc[k] = calculate(rows, byId.get(k)!, view.calc![k]);
  return { view, properties, visible: properties.filter((p) => p.type === 'title' || !hidden.has(p.id)), rows, groups, groupBy, calc, total: all.length };
}

/* ------------------------------------------------------------------ commands */

const getDb = (editor: Editor, id: string): Block | null => {
  const b = editor.doc.get(id);
  return b && b.type === 'database' ? b : null;
};
/** Database that contains the selection (or is selected). */
export function currentDatabase(editor: Editor): Block | null {
  const sel = editor.selection;
  const id = sel?.type === 'text' ? sel.focus.id : sel?.type === 'block' ? sel.ids[0] : null;
  return editor.doc.closest(id ? editor.doc.get(id) : null, (b) => b.type === 'database');
}
const patchDb = (editor: Editor, db: Block, patch: Attrs, group?: string): boolean => !editor.readOnly && editor.update((tr) => void tr.setAttrs(db.id, patch), group ? { group } : {});
const patchView = (editor: Editor, db: Block, viewId: string | undefined, fn: (v: DbView) => DbView): boolean => {
  const id = viewId ?? dbActiveView(db).id;
  if (!dbViews(db).some((v) => v.id === id)) return false;
  return patchDb(editor, db, { views: dbViews(db).map((v) => (v.id === id ? fn({ ...v }) : v)) });
};

/** Build database JSON. `rows` are records keyed by property *name*. */
export function createDatabase(editor: Editor, opts: { title?: string; view?: DbViewType; properties?: Omit<DbProperty, 'id'>[]; rows?: Record<string, any>[] } = {}): BlockJSON {
  const s = editor.schema;
  const defs = opts.properties ?? [
    { name: 'Name', type: 'title' as const },
    { name: 'Status', type: 'select' as const, options: [{ id: 'todo', name: 'To do', color: 'gray' as const }, { id: 'doing', name: 'In progress', color: 'blue' as const }, { id: 'done', name: 'Done', color: 'green' as const }] },
    { name: 'Tags', type: 'multi_select' as const, options: [] },
  ];
  const properties = cleanProperties(defs.map((d, i) => ({ ...d, id: d.type === 'title' ? 'title' : 'p' + (i + 1) + newId().slice(1, 5) })));
  const view = opts.view ?? 'table';
  const groupBy = properties.find((p) => p.type === 'select')?.id;
  const rowsIn = opts.rows ?? [{}, {}, {}];
  const rows = rowsIn.map((r) => {
    const cells: Record<string, any> = {};
    for (const p of properties) {
      const v = r[p.name];
      if (v === undefined) continue;
      if (p.type === 'select') cells[p.id] = p.options?.find((o) => o.name === v || o.id === v)?.id ?? '';
      else if (p.type === 'multi_select') cells[p.id] = (Array.isArray(v) ? v : [v]).map((n) => p.options?.find((o) => o.name === n || o.id === n)?.id).filter(Boolean);
      else cells[p.id] = v;
    }
    return s.create('db_row', { cells });
  });
  return s.create('database', { title: opts.title ?? '', properties, views: [{ id: 'v1', name: view[0].toUpperCase() + view.slice(1), type: view, ...(view === 'board' && groupBy ? { groupBy } : {}) }], view: 'v1' }, undefined, rows);
}

export const databaseCommands: Record<string, CommandFn> = {
  insertDatabase: (editor, view: DbViewType = 'table', opts: any = {}) => {
    const json = createDatabase(editor, { ...opts, view });
    const ok = editor.exec('insertBlocks', [json], { select: false, ...(opts.at ?? {}) });
    if (ok) editor.setSelection(blockSel([json.id]));
    return ok;
  },
  dbSetTitle: (editor, dbId: string, title: string) => {
    const db = getDb(editor, dbId);
    return !!db && patchDb(editor, db, { title: String(title).slice(0, 200) });
  },
  dbAddRow: (editor, dbId: string, cells: Record<string, any> = {}, index?: number) => {
    const db = getDb(editor, dbId);
    if (!db || editor.readOnly) return false;
    const row = editor.schema.create('db_row', { cells: cleanCells(cells) });
    editor.storage.db = { ...(editor.storage.db ?? {}), lastRow: row.id };
    return editor.update((tr) => void tr.insert(db.id, Math.min(index ?? db.children!.length, db.children!.length), [row]));
  },
  dbDeleteRow: (editor, rowId: string) => {
    const row = editor.doc.get(rowId);
    if (!row || row.type !== 'db_row' || editor.readOnly) return false;
    return editor.update((tr) => void tr.remove(rowId));
  },
  dbDuplicateRow: (editor, rowId: string) => {
    const row = editor.doc.get(rowId);
    return !!row && row.type === 'db_row' && editor.exec('duplicateBlocks', [rowId]);
  },
  /** Reorder a row. Has a visible effect only in views without a sort. */
  dbMoveRow: (editor, rowId: string, targetRowId: string, place: 'before' | 'after' = 'before') => {
    const row = editor.doc.get(rowId);
    const target = editor.doc.get(targetRowId);
    if (!row || !target || row.type !== 'db_row' || target.type !== 'db_row' || row.parent !== target.parent) return false;
    return editor.exec('moveBlocksTo', [rowId], targetRowId, place);
  },
  dbSetCell: (editor, rowId: string, propId: string, value: any) => {
    const row = editor.doc.get(rowId);
    if (!row || row.type !== 'db_row' || editor.readOnly) return false;
    const prop = dbProperties(row.parent!).find((p) => p.id === propId);
    if (!prop) return false;
    let v = value;
    if (prop.type === 'number') v = value === '' || value == null || !Number.isFinite(Number(value)) ? undefined : Number(value);
    else if (prop.type === 'checkbox') v = value === true ? true : undefined;
    else if (prop.type === 'select') v = prop.options?.some((o) => o.id === value) ? value : undefined;
    else if (prop.type === 'multi_select') v = Array.isArray(value) ? value.filter((id) => prop.options?.some((o) => o.id === id)) : undefined;
    else if (prop.type === 'date') v = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : undefined;
    else v = value == null || value === '' ? undefined : String(value).slice(0, 5000);
    if (Array.isArray(v) && !v.length) v = undefined;
    const cells = { ...(row.attrs.cells ?? {}) };
    if (v === undefined) delete cells[propId];
    else cells[propId] = v;
    return editor.update((tr) => void tr.setAttrs(rowId, { cells }));
  },
  dbAddProperty: (editor, dbId: string, def: Partial<DbProperty> = {}) => {
    const db = getDb(editor, dbId);
    if (!db) return false;
    const type = one(def.type, DB_PROPERTY_TYPES, 'text');
    const prop: DbProperty = { id: 'p' + newId().slice(1, 8), name: str(def.name, 100) || 'Property ' + dbProperties(db).length, type: type === 'title' ? 'text' : type };
    if (prop.type === 'select' || prop.type === 'multi_select') prop.options = def.options ?? [];
    return patchDb(editor, db, { properties: cleanProperties([...dbProperties(db), prop]) });
  },
  dbUpdateProperty: (editor, dbId: string, propId: string, patch: Partial<DbProperty>) => {
    const db = getDb(editor, dbId);
    const cur = db && dbProperties(db).find((p) => p.id === propId);
    if (!db || !cur) return false;
    const next: any = { ...cur, ...patch, id: cur.id };
    if (cur.type === 'title') next.type = 'title'; // the title property keeps its type
    else if (next.type === 'title') next.type = cur.type;
    if ((next.type === 'select' || next.type === 'multi_select') && !next.options) {
      // converting text to a select: existing values become options
      const names = [...new Set(dbRows(db).flatMap((r) => String((r.attrs.cells ?? {})[propId] ?? '').split(',').map((s) => s.trim()).filter(Boolean)))].slice(0, 50);
      next.options = names.map((name, i) => ({ id: 'o' + newId().slice(1, 7), name, color: DB_COLORS[(i + 1) % DB_COLORS.length] }));
      if (!editor.readOnly && next.options.length)
        return editor.update((tr) => {
          for (const r of dbRows(db)) {
            const raw = String((r.attrs.cells ?? {})[propId] ?? '');
            const ids = raw.split(',').map((s) => next.options.find((o: DbOption) => o.name === s.trim())?.id).filter(Boolean);
            const cells = { ...(r.attrs.cells ?? {}) };
            if (!ids.length) delete cells[propId];
            else cells[propId] = next.type === 'select' ? ids[0] : ids;
            tr.setAttrs(r.id, { cells });
          }
          tr.setAttrs(db.id, { properties: cleanProperties(dbProperties(db).map((p) => (p.id === propId ? next : p))) });
        });
    }
    return patchDb(editor, db, { properties: cleanProperties(dbProperties(db).map((p) => (p.id === propId ? next : p))) }, patch.width ? 'db-width:' + propId : undefined);
  },
  dbDeleteProperty: (editor, dbId: string, propId: string) => {
    const db = getDb(editor, dbId);
    const cur = db && dbProperties(db).find((p) => p.id === propId);
    if (!db || !cur || cur.type === 'title' || editor.readOnly) return false;
    return editor.update((tr) => {
      for (const r of dbRows(db))
        if (propId in (r.attrs.cells ?? {})) {
          const cells = { ...r.attrs.cells };
          delete cells[propId];
          tr.setAttrs(r.id, { cells });
        }
      const strip = (v: DbView): DbView => ({ ...v, filters: v.filters?.filter((f) => f.prop !== propId), sorts: v.sorts?.filter((s) => s.prop !== propId), groupBy: v.groupBy === propId ? undefined : v.groupBy, hidden: v.hidden?.filter((h) => h !== propId) });
      tr.setAttrs(db.id, { properties: dbProperties(db).filter((p) => p.id !== propId), views: cleanViews(dbViews(db).map(strip)) });
    });
  },
  /** Add a select option; returns true and stores its id in `editor.storage.db.lastOption`. */
  dbAddOption: (editor, dbId: string, propId: string, name: string, color?: DbColor) => {
    const db = getDb(editor, dbId);
    const prop = db && dbProperties(db).find((p) => p.id === propId);
    if (!db || !prop || !prop.options || !String(name).trim()) return false;
    const existing = prop.options.find((o) => o.name.toLowerCase() === String(name).trim().toLowerCase());
    const opt: DbOption = existing ?? { id: 'o' + newId().slice(1, 7), name: String(name).trim().slice(0, 100), color: one(color, DB_COLORS, DB_COLORS[(prop.options.length + 1) % DB_COLORS.length]) };
    editor.storage.db = { ...(editor.storage.db ?? {}), lastOption: opt.id };
    if (existing) return true;
    return patchDb(editor, db, { properties: dbProperties(db).map((p) => (p.id === propId ? { ...p, options: [...p.options!, opt] } : p)) });
  },
  dbAddView: (editor, dbId: string, type: DbViewType = 'table', name?: string) => {
    const db = getDb(editor, dbId);
    if (!db) return false;
    const t = one(type, DB_VIEW_TYPES, 'table');
    const view: DbView = { id: 'v' + newId().slice(1, 7), name: str(name, 60) || t[0].toUpperCase() + t.slice(1), type: t };
    const sel = dbProperties(db).find((p) => p.type === 'select');
    if (t === 'board' && sel) view.groupBy = sel.id;
    return patchDb(editor, db, { views: [...dbViews(db), view], view: view.id });
  },
  dbUpdateView: (editor, dbId: string, viewId: string | undefined, patch: Partial<DbView>) => {
    const db = getDb(editor, dbId);
    if (!db) return false;
    const id = viewId ?? dbActiveView(db).id;
    if (!dbViews(db).some((v) => v.id === id)) return false;
    return patchDb(editor, db, { views: cleanViews(dbViews(db).map((v) => (v.id === id ? { ...v, ...patch, id: v.id } : v))) });
  },
  dbDeleteView: (editor, dbId: string, viewId: string) => {
    const db = getDb(editor, dbId);
    if (!db || dbViews(db).length < 2) return false;
    const views = dbViews(db).filter((v) => v.id !== viewId);
    return patchDb(editor, db, { views, view: db.attrs.view === viewId ? views[0].id : db.attrs.view });
  },
  dbSetView: (editor, dbId: string, viewId: string) => {
    const db = getDb(editor, dbId);
    return !!db && dbViews(db).some((v) => v.id === viewId) && patchDb(editor, db, { view: viewId });
  },
  dbSort: (editor, dbId: string, propId: string | null, dir: 'asc' | 'desc' = 'asc', viewId?: string) => {
    const db = getDb(editor, dbId);
    return !!db && patchView(editor, db, viewId, (v) => ({ ...v, sorts: propId ? [{ prop: propId, dir }] : undefined }));
  },
  dbFilter: (editor, dbId: string, filters: DbFilter[] | null, viewId?: string) => {
    const db = getDb(editor, dbId);
    return !!db && patchView(editor, db, viewId, (v) => cleanViews([{ ...v, filters: filters ?? undefined }])[0]);
  },
  dbGroupBy: (editor, dbId: string, propId: string | null, viewId?: string) => {
    const db = getDb(editor, dbId);
    return !!db && patchView(editor, db, viewId, (v) => ({ ...v, groupBy: propId ?? undefined }));
  },
  dbToggleProperty: (editor, dbId: string, propId: string, viewId?: string) => {
    const db = getDb(editor, dbId);
    return (
      !!db &&
      patchView(editor, db, viewId, (v) => {
        const hidden = new Set(v.hidden ?? []);
        if (hidden.has(propId)) hidden.delete(propId);
        else hidden.add(propId);
        return { ...v, hidden: hidden.size ? [...hidden] : undefined };
      })
    );
  },
  dbCalculate: (editor, dbId: string, propId: string, calc: DbCalc | null, viewId?: string) => {
    const db = getDb(editor, dbId);
    return (
      !!db &&
      patchView(editor, db, viewId, (v) => {
        const c = { ...(v.calc ?? {}) };
        if (calc && DB_CALCS.includes(calc)) c[propId] = calc;
        else delete c[propId];
        return { ...v, calc: Object.keys(c).length ? c : undefined };
      })
    );
  },
  /** Put the caret into a row's page content (the view expands the row). */
  dbOpenRow: (editor, rowId: string, open = true) => {
    const row = editor.doc.get(rowId);
    if (!row || row.type !== 'db_row') return false;
    const st = (editor.storage.db ??= {});
    const set: Set<string> = (st.open ??= new Set<string>());
    if (open) set.add(rowId);
    else set.delete(rowId);
    editor.emit('db:open', { id: rowId, open });
    if (open) {
      const t = firstTextBlock(editor.doc, editor.schema, row);
      if (t) editor.setSelection(textSel(t.id, 0));
    } else editor.setSelection(blockSel([row.parent!.id]));
    return true;
  },
};

/* ------------------------------------------------------------------ serialization */

function tableHTML(db: any, c: any): string {
  const props: DbProperty[] = db.attrs?.properties ?? [];
  const rows = ((db.children ?? []) as any[]).filter((r) => r.type === 'db_row');
  const cell = (r: any, p: DbProperty): string => {
    const text = cellText(r, p);
    if ((p.type === 'url' || p.type === 'email') && text) {
      const href = safeUrl(p.type === 'email' ? 'mailto:' + text : text);
      if (href) return `<a href="${esc(href)}" rel="noopener noreferrer nofollow">${esc(text)}</a>`;
    }
    if (p.type === 'date' && text) return `<time datetime="${esc(text)}">${esc(text)}</time>`;
    return esc(text);
  };
  const head = `<thead><tr>${props.map((p) => `<th scope="col">${esc(p.name)}</th>`).join('')}</tr></thead>`;
  const body = rows
    .map((r) => {
      const content = (r.children ?? []).some((b: any) => b.content?.length || b.children?.length || (b.type !== 'paragraph' && b.type)) ? `<tr><td colspan="${props.length}">${c.children(r)}</td></tr>` : '';
      return `<tr>${props.map((p, i) => (i === 0 ? `<th scope="row">${cell(r, p)}</th>` : `<td>${cell(r, p)}</td>`)).join('')}</tr>${content}`;
    })
    .join('');
  return `<table>${db.attrs?.title ? `<caption>${esc(db.attrs.title)}</caption>` : ''}${head}<tbody>${body}</tbody></table>`;
}

const databaseNodes: NodeSpec[] = [
  {
    type: 'database',
    kind: 'container',
    children: ['db_row'],
    allowEmpty: true,
    isolating: true,
    attrs: {
      title: { default: '', validate: (x) => str(x, 200) },
      properties: { default: [{ id: 'title', name: 'Name', type: 'title' }], validate: cleanProperties },
      views: { default: [{ id: 'v1', name: 'Table', type: 'table' }], validate: cleanViews },
      view: { default: 'v1', validate: (x) => (typeof x === 'string' && ID.test(x) ? x : undefined) },
    },
    // A readable, crawlable table plus the full block JSON for a lossless re-import.
    toHTML: (b, c) => `<div${c.id(b)} data-z-type="database" data-z-raw="${esc(JSON.stringify(c.schema.serializeBlock ? rawOf(b, c) : b))}">${tableHTML(b, c)}</div>`,
    toMarkdown: (b) => {
      const props: DbProperty[] = b.attrs?.properties ?? [];
      const rows = ((b.children ?? []) as any[]).filter((r) => r.type === 'db_row');
      const line = (cells: string[]) => '| ' + cells.map((s) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |';
      return [b.attrs?.title ? `**${b.attrs.title}**\n` : '', line(props.map((p) => p.name)), line(props.map(() => '---')), ...rows.map((r) => line(props.map((p) => cellText(r, p))))].filter(Boolean).join('\n');
    },
    toText: (b) => b.attrs?.title ?? '',
  },
  {
    type: 'db_row',
    kind: 'container',
    parents: ['database'],
    isolating: true,
    attrs: { cells: { default: {}, validate: cleanCells } },
    toHTML: () => '',
  },
];
function rawOf(b: any, c: any): BlockJSON {
  return b instanceof Block ? c.schema.serializeBlock(b) : b;
}

const dbSlash = (id: string, title: string, description: string, view: DbViewType, order: number): SlashItem => ({
  id,
  title,
  description,
  keywords: ['database', 'notion', view, 'kanban', 'collection', 'records'],
  icon: view === 'board' ? 'columns' : 'table',
  group: 'database',
  order,
  run: (editor, { blockId }) => {
    const b = editor.doc.get(blockId);
    const at = b && b.type === 'paragraph' && b.length === 0 && !b.children ? { replace: blockId } : { after: blockId };
    editor.exec('insertDatabase', view, { at });
  },
});

export const databaseExtension: Extension = {
  name: 'database',
  requires: ['base'],
  schemaVersion: 1,
  nodes: databaseNodes,
  commands: databaseCommands,
  slashItems: [
    dbSlash('db-table', 'Database – table', 'Typed columns, filters, sorts', 'table', 50),
    dbSlash('db-board', 'Database – board', 'Kanban grouped by a select', 'board', 51),
    dbSlash('db-list', 'Database – list', 'Compact list of pages', 'list', 52),
    dbSlash('db-gallery', 'Database – gallery', 'Cards with a preview', 'gallery', 53),
  ],
  labels: {
    'db.untitled': 'Untitled database',
    'db.newRow': 'New',
    'db.addProperty': 'Add property',
    'db.addView': 'Add view',
    'db.views': 'Database views',
    'db.filter': 'Filter',
    'db.sort': 'Sort',
    'db.group': 'Group',
    'db.properties': 'Properties',
    'db.none': 'None',
    'db.noValue': 'No value',
    'db.open': 'Open',
    'db.close': 'Close page',
    'db.deleteRow': 'Delete row',
    'db.duplicateRow': 'Duplicate row',
    'db.rename': 'Rename',
    'db.type': 'Type',
    'db.deleteProperty': 'Delete property',
    'db.hideProperty': 'Hide in this view',
    'db.sortAsc': 'Sort ascending',
    'db.sortDesc': 'Sort descending',
    'db.calculate': 'Calculate',
    'db.deleteView': 'Delete view',
    'db.empty': 'No rows',
    'db.search': 'Search or create…',
    'db.create': 'Create',
    'db.count': '{n} of {total}',
    'db.clear': 'Clear',
  },
  setup: (editor) =>
    // a caret that lands inside a collapsed row's page (find, undo, remote edit) opens the row
    editor.on('selection', ({ selection }) => {
      if (!selection || selection.type !== 'text') return;
      const row = editor.doc.closest(editor.doc.get(selection.focus.id), (b) => b.type === 'db_row');
      if (!row) return;
      const st = (editor.storage.db ??= {});
      const open: Set<string> = (st.open ??= new Set<string>());
      if (!open.has(row.id)) {
        open.add(row.id);
        editor.emit('db:open', { id: row.id, open: true });
      }
    }),
};

declare module './editor' {
  interface Commands {
    insertDatabase(view?: DbViewType, opts?: { title?: string; properties?: Omit<DbProperty, 'id'>[]; rows?: Record<string, any>[]; at?: { replace?: string; after?: string } }): boolean;
    dbSetTitle(dbId: string, title: string): boolean;
    dbAddRow(dbId: string, cells?: Record<string, any>, index?: number): boolean;
    dbDeleteRow(rowId: string): boolean;
    dbDuplicateRow(rowId: string): boolean;
    dbMoveRow(rowId: string, targetRowId: string, place?: 'before' | 'after'): boolean;
    dbSetCell(rowId: string, propId: string, value: any): boolean;
    dbAddProperty(dbId: string, def?: Partial<DbProperty>): boolean;
    dbUpdateProperty(dbId: string, propId: string, patch: Partial<DbProperty>): boolean;
    dbDeleteProperty(dbId: string, propId: string): boolean;
    dbAddOption(dbId: string, propId: string, name: string, color?: DbColor): boolean;
    dbAddView(dbId: string, type?: DbViewType, name?: string): boolean;
    dbUpdateView(dbId: string, viewId: string | undefined, patch: Partial<DbView>): boolean;
    dbDeleteView(dbId: string, viewId: string): boolean;
    dbSetView(dbId: string, viewId: string): boolean;
    dbSort(dbId: string, propId: string | null, dir?: 'asc' | 'desc', viewId?: string): boolean;
    dbFilter(dbId: string, filters: DbFilter[] | null, viewId?: string): boolean;
    dbGroupBy(dbId: string, propId: string | null, viewId?: string): boolean;
    dbToggleProperty(dbId: string, propId: string, viewId?: string): boolean;
    dbCalculate(dbId: string, propId: string, calc: DbCalc | null, viewId?: string): boolean;
    dbOpenRow(rowId: string, open?: boolean): boolean;
  }
}
