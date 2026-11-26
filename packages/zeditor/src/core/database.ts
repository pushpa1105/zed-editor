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
import { FormulaError, runFormula } from './formula';

export type DbPropertyType = 'title' | 'text' | 'number' | 'select' | 'multi_select' | 'checkbox' | 'date' | 'url' | 'email' | 'person' | 'formula' | 'relation' | 'rollup' | (string & {});
/** Built-in types plus any registered with `registerDbPropertyType`. */
export const DB_PROPERTY_TYPES: DbPropertyType[] = ['title', 'text', 'number', 'select', 'multi_select', 'checkbox', 'date', 'url', 'email', 'person', 'formula', 'relation', 'rollup'];

/**
 * A custom property type. Values are stored in the row's cells as JSON; the type decides how
 * they are validated, shown as text, ordered and (optionally) rendered.
 */
export interface DbTypeSpec {
  type: string;
  label: string;
  /** icon name or SVG markup shown in headers and menus */
  icon?: string;
  /** sanitize a value coming from the UI or from a stored document; return undefined to clear */
  coerce: (value: any) => string | number | boolean | string[] | undefined;
  text: (value: any) => string;
  compare?: (a: any, b: any) => number;
  /** optional DOM cell renderer: (ctx: { value, set, readOnly, label }) => HTMLElement */
  render?: (ctx: { value: any; set: (v: any) => void; readOnly: boolean; label: string }) => any;
}
const customTypes = new Map<string, DbTypeSpec>();
/** Register a custom database property type (global: available to every editor). */
export function registerDbPropertyType(spec: DbTypeSpec): void {
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(spec.type) || ['title', 'formula', 'relation', 'rollup'].includes(spec.type)) throw new Error('zeditor: invalid database property type name "' + spec.type + '"');
  customTypes.set(spec.type, spec);
  if (!DB_PROPERTY_TYPES.includes(spec.type)) DB_PROPERTY_TYPES.push(spec.type);
}
export const dbTypeSpec = (type: string): DbTypeSpec | undefined => customTypes.get(type);
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
  /** formula source, see core/formula.ts */
  formula?: string;
  /** relation: id of the database whose rows this property links to */
  relation?: { database: string };
  /** rollup: follow `relation` (a relation property of this database) and summarize `target` there */
  rollup?: { relation: string; target: string; calc: DbCalc | 'show' };
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
export type DbViewType = 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline';
export const DB_VIEW_TYPES: DbViewType[] = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline'];
export interface DbView {
  id: string;
  name: string;
  type: DbViewType;
  filters?: DbFilter[];
  /** 'and' (default): every filter must match; 'or': any filter */
  filterMode?: 'and' | 'or';
  /** calendar / timeline: the date property rows are placed by (default: the first date property) */
  dateProp?: string;
  /** timeline: optional end date property */
  endProp?: string;
  sorts?: DbSort[];
  /** select property to group by (board columns; optional sections in other views) */
  groupBy?: string;
  /** property ids hidden in this view */
  hidden?: string[];
  calc?: Record<string, DbCalc>;
  /** board / grouped views: hide groups without rows */
  hideEmptyGroups?: boolean;
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
    if (prop.type === 'formula') prop.formula = str(p.formula, 500);
    if (prop.type === 'relation') prop.relation = { database: p.relation && ID.test(p.relation.database) ? p.relation.database : '' };
    if (prop.type === 'rollup') prop.rollup = { relation: p.rollup && ID.test(p.rollup.relation) ? p.rollup.relation : '', target: p.rollup && ID.test(p.rollup.target) ? p.rollup.target : '', calc: p.rollup && (p.rollup.calc === 'show' || DB_CALCS.includes(p.rollup.calc)) ? p.rollup.calc : 'show' };
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
    if (v.filterMode === 'or') view.filterMode = 'or';
    if (v.hideEmptyGroups === true) view.hideEmptyGroups = true;
    if (typeof v.dateProp === 'string' && ID.test(v.dateProp)) view.dateProp = v.dateProp;
    if (typeof v.endProp === 'string' && ID.test(v.endProp)) view.endProp = v.endProp;
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
/** Evaluation context: lets computed cells (formula, relation, rollup) see the rest of the document. */
export interface DbContext {
  db: any;
  props: DbProperty[];
  /** look up any block of the document by id (index built lazily, once per context) */
  find: (id: string) => any | undefined;
  depth: number;
}
export function dbContext(db: any, parent?: DbContext): DbContext {
  let index: Map<string, any> | null = null;
  const find =
    parent?.find ??
    ((id: string) => {
      if (!index) {
        index = new Map();
        let root = db;
        while (root && root.parent) root = root.parent;
        const walk = (x: any) => {
          index!.set(x.id, x);
          x.children?.forEach(walk);
        };
        if (root) walk(root);
      }
      return index.get(id);
    });
  return { db, props: db?.attrs?.properties ?? [], find, depth: (parent?.depth ?? -1) + 1 };
}
const MAX_DEPTH = 6;
/** Rows a relation cell points at (only rows that still exist in the target database). */
export function relatedRows(row: any, prop: DbProperty, ctx: DbContext = dbContext(row.parent)): any[] {
  const ids = (row.attrs?.cells ?? {})[prop.id];
  if (!Array.isArray(ids) || !prop.relation?.database) return [];
  const target = ctx.find(prop.relation.database);
  if (!target || target.type !== 'database') return [];
  const byId = new Map<string, any>((target.children ?? []).map((r: any) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}
const titleOf = (row: any): string => String((row.attrs?.cells ?? {}).title ?? ((row.parent?.attrs?.properties ?? []).find((p: DbProperty) => p.type === 'title') ? (row.attrs?.cells ?? {})[(row.parent.attrs.properties as DbProperty[]).find((p) => p.type === 'title')!.id] ?? '' : ''));

export function cellValue(row: any, prop: DbProperty, ctx: DbContext = dbContext(row.parent ?? { attrs: { properties: [prop] } })): any {
  const v = (row.attrs?.cells ?? {})[prop.id];
  switch (prop.type) {
    case 'number':
      return typeof v === 'number' ? v : v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v);
    case 'checkbox':
      return v === true;
    case 'multi_select':
      return Array.isArray(v) ? v.filter((id) => prop.options?.some((o) => o.id === id)) : [];
    case 'select':
      return typeof v === 'string' && prop.options?.some((o) => o.id === v) ? v : null;
    case 'relation':
      return relatedRows(row, prop, ctx).map((r) => r.id);
    case 'formula': {
      if (ctx.depth > MAX_DEPTH) return '#ERR: circular reference';
      const inner = { ...ctx, depth: ctx.depth + 1 };
      return runFormula(prop.formula ?? '', (name) => {
        const p = ctx.props.find((x) => x.name === name);
        if (!p) throw new FormulaError('No property "' + name + '"');
        if (p.id === prop.id) throw new FormulaError('A formula cannot use itself');
        const val = cellValue(row, p, inner);
        if (typeof val === 'number' || typeof val === 'boolean' || val == null) return val;
        return p.type === 'date' || typeof val === 'string' ? (p.type === 'select' || p.type === 'multi_select' || p.type === 'relation' ? cellText(row, p, inner) : String(val)) : cellText(row, p, inner);
      });
    }
    case 'rollup': {
      if (ctx.depth > MAX_DEPTH) return '#ERR: circular reference';
      const rel = ctx.props.find((p) => p.id === prop.rollup?.relation && p.type === 'relation');
      if (!rel) return null;
      const rows = relatedRows(row, rel, ctx);
      const target = ctx.find(rel.relation!.database);
      const tctx = dbContext(target, ctx);
      const tp = tctx.props.find((p) => p.id === prop.rollup!.target) ?? tctx.props.find((p) => p.type === 'title');
      if (!tp) return null;
      if (prop.rollup!.calc === 'show') return rows.map((r) => cellText(r, tp, tctx)).filter(Boolean).join(', ');
      const out = calculate(rows, tp, prop.rollup!.calc as DbCalc, tctx);
      return out !== '' && Number.isFinite(Number(out)) ? Number(out) : out;
    }
    default: {
      const spec = customTypes.get(prop.type);
      if (spec) {
        try {
          const c = spec.coerce(v);
          return c === undefined ? null : c;
        } catch {
          return null;
        }
      }
      return v == null ? '' : String(v);
    }
  }
}
/** Display text of a cell (also what filters, sorts and exports use). */
export function cellText(row: any, prop: DbProperty, ctx: DbContext = dbContext(row.parent ?? { attrs: { properties: [prop] } })): string {
  const v = cellValue(row, prop, ctx);
  if (prop.type === 'select') return prop.options?.find((o) => o.id === v)?.name ?? '';
  if (prop.type === 'multi_select') return (v as string[]).map((id) => prop.options!.find((o) => o.id === id)!.name).join(', ');
  if (prop.type === 'checkbox') return v ? '✓' : '';
  if (prop.type === 'relation') return relatedRows(row, prop, ctx).map(titleOf).filter(Boolean).join(', ');
  const spec = customTypes.get(prop.type);
  if (spec && v != null) {
    try {
      return String(spec.text(v) ?? '');
    } catch {
      return '';
    }
  }
  if (typeof v === 'boolean') return v ? '✓' : '';
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  return v == null ? '' : String(v);
}
function isEmptyCell(row: any, prop: DbProperty, ctx?: DbContext): boolean {
  const v = cellValue(row, prop, ctx);
  return prop.type === 'checkbox' ? !v : v == null || v === '' || v === false || (Array.isArray(v) && !v.length);
}
function matches(row: any, prop: DbProperty, f: DbFilter, ctx?: DbContext): boolean {
  const text = cellText(row, prop, ctx).toLowerCase();
  const want = (f.value ?? '').toLowerCase();
  switch (f.op) {
    case 'empty':
      return isEmptyCell(row, prop, ctx);
    case 'not_empty':
      return !isEmptyCell(row, prop, ctx);
    case 'checked':
      return cellValue(row, prop, ctx) === true;
    case 'unchecked':
      return cellValue(row, prop, ctx) !== true;
    case 'is':
      return prop.type === 'multi_select' || prop.type === 'relation' ? text.split(', ').includes(want) : text === want;
    case 'is_not':
      return prop.type === 'multi_select' || prop.type === 'relation' ? !text.split(', ').includes(want) : text !== want;
    case 'contains':
      return !want || text.includes(want);
    case 'not_contains':
      return !want || !text.includes(want);
    case 'gt':
    case 'lt': {
      if (want === '') return true;
      const raw = cellValue(row, prop, ctx);
      const numeric = typeof raw === 'number' && Number.isFinite(Number(f.value));
      const a = numeric ? raw : text;
      const b = numeric ? Number(f.value) : want;
      if (a == null || a === '') return false;
      return f.op === 'gt' ? a > b : a < b;
    }
  }
}
function compare(a: any, b: any, prop: DbProperty, ctx?: DbContext): number {
  const x0 = cellValue(a, prop, ctx);
  const y0 = cellValue(b, prop, ctx);
  const spec = customTypes.get(prop.type);
  if (spec?.compare && x0 != null && y0 != null) return spec.compare(x0, y0);
  if ((typeof x0 === 'number' || typeof x0 === 'boolean' || x0 == null) && (typeof y0 === 'number' || typeof y0 === 'boolean' || y0 == null) && prop.type !== 'select') {
    if (x0 == null || y0 == null) return x0 == null ? (y0 == null ? 0 : 1) : -1; // empty values last
    return Number(x0) - Number(y0);
  }
  if (prop.type === 'select') {
    // option order, not alphabetical
    const idx = (v: any) => {
      const i = prop.options!.findIndex((o) => o.id === v);
      return i < 0 ? Infinity : i;
    };
    return idx(x0) - idx(y0) || 0;
  }
  const x = cellText(a, prop, ctx);
  const y = cellText(b, prop, ctx);
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
}

export function calculate(rows: any[], prop: DbProperty, calc: DbCalc, ctx?: DbContext): string {
  const filled = rows.filter((r) => !isEmptyCell(r, prop, ctx));
  const nums = filled
    .map((r) => {
      const v = cellValue(r, prop, ctx);
      return typeof v === 'number' ? v : Number(cellText(r, prop, ctx));
    })
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const numeric = nums;
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  switch (calc) {
    case 'count':
      return String(rows.length);
    case 'filled':
      return String(filled.length);
    case 'empty':
      return String(rows.length - filled.length);
    case 'unique':
      return String(new Set(filled.map((r) => cellText(r, prop, ctx))).size);
    case 'sum':
      return fmt(numeric.reduce((a, b) => a + b, 0));
    case 'avg':
      return numeric.length ? fmt(numeric.reduce((a, b) => a + b, 0) / numeric.length) : '';
    case 'min':
      return numeric.length ? fmt(Math.min(...numeric)) : '';
    case 'max':
      return numeric.length ? fmt(Math.max(...numeric)) : '';
    case 'checked':
      return String(rows.filter((r) => cellValue(r, prop, ctx) === true).length);
    case 'percent_checked':
      return rows.length ? Math.round((rows.filter((r) => cellValue(r, prop, ctx) === true).length / rows.length) * 100) + '%' : '';
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
  /** date property used by calendar / timeline views, if any */
  dateProp: DbProperty | null;
  endProp: DbProperty | null;
  /** evaluation context, reusable for `cellValue` / `cellText` on these rows */
  ctx: DbContext;
}

/** Evaluate a view: filter, sort, group and calculate. Pure; does not touch the document. */
export function queryDatabase(db: Block, viewId?: string, opts: { search?: string } = {}): DbResult {
  const properties = dbProperties(db);
  const view = dbViews(db).find((v) => v.id === viewId) ?? dbActiveView(db);
  const byId = new Map(properties.map((p) => [p.id, p]));
  const all = dbRows(db);
  const ctx = dbContext(db);
  const filters = (view.filters ?? []).filter((f) => byId.has(f.prop));
  const test = (r: Block, f: DbFilter) => matches(r, byId.get(f.prop)!, f, ctx);
  let rows = !filters.length ? all : all.filter((r) => (view.filterMode === 'or' ? filters.some((f) => test(r, f)) : filters.every((f) => test(r, f))));
  // quick search: every word must appear in some property of the row (case-insensitive)
  const words = (opts.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    rows = rows.filter((r) => {
      const hay = properties.map((p) => cellText(r, p, ctx)).join('\n').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  const sorts = (view.sorts ?? []).filter((s) => byId.has(s.prop));
  if (sorts.length) {
    const order = new Map(all.map((r, i) => [r.id, i]));
    rows = [...rows].sort((a, b) => {
      for (const s of sorts) {
        const prop = byId.get(s.prop)!;
        const empty = (r: Block) => isEmptyCell(r, prop, ctx) && prop.type !== 'checkbox';
        // rows without a value stay at the end in both directions
        if (empty(a) !== empty(b)) return empty(a) ? 1 : -1;
        const c = compare(a, b, prop, ctx);
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
    for (const r of rows) (groups.find((x) => x.option?.id === cellValue(r, g, ctx)) ?? groups[0]).rows.push(r);
    if (view.hideEmptyGroups) groups = groups.filter((x) => x.rows.length);
  }
  const hidden = new Set(view.hidden ?? []);
  const calc: Record<string, string> = {};
  for (const k in view.calc ?? {}) if (byId.has(k)) calc[k] = calculate(rows, byId.get(k)!, view.calc![k], ctx);
  const dates = properties.filter((p) => p.type === 'date');
  const dateProp = dates.find((p) => p.id === view.dateProp) ?? dates[0] ?? null;
  const endProp = dates.find((p) => p.id === view.endProp && p.id !== dateProp?.id) ?? null;
  return { view, properties, visible: properties.filter((p) => p.type === 'title' || !hidden.has(p.id)), rows, groups, groupBy, calc, total: all.length, dateProp, endProp, ctx };
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
    if (!row || !target || row === target || row.type !== 'db_row' || target.type !== 'db_row' || row.parent !== target.parent || editor.readOnly) return false;
    const sel = editor.selection;
    let moved = false;
    // keeps the selection where it was: a moved row is not "selected" as a block
    const ok = editor.update((tr) => {
      moved = tr.move([rowId], target.parent!.id, target.index + (place === 'after' ? 1 : 0));
      tr.select(sel?.type === 'block' && sel.ids.includes(rowId) ? blockSel([target.parent!.id]) : sel);
    });
    return ok && moved;
  },
  dbSetCell: (editor, rowId: string, propId: string, value: any) => {
    const row = editor.doc.get(rowId);
    if (!row || row.type !== 'db_row' || editor.readOnly) return false;
    const prop = dbProperties(row.parent!).find((p) => p.id === propId);
    if (!prop) return false;
    let v = value;
    if (prop.type === 'formula' || prop.type === 'rollup') return false; // computed
    if (prop.type === 'relation') v = Array.isArray(value) ? [...new Set(value.filter((x) => typeof x === 'string' && ID.test(x)))].slice(0, 50) : undefined;
    else if (customTypes.has(prop.type)) {
      try {
        v = value == null ? undefined : customTypes.get(prop.type)!.coerce(value);
      } catch {
        v = undefined;
      }
    } else if (prop.type === 'number') v = value === '' || value == null || !Number.isFinite(Number(value)) ? undefined : Number(value);
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
    const prop: DbProperty = { ...def, id: 'p' + newId().slice(1, 8), name: str(def.name, 100) || (customTypes.get(type)?.label ?? type[0].toUpperCase() + type.slice(1).replace('_', ' ')) + (dbProperties(db).some((p) => p.type === type) ? ' ' + dbProperties(db).length : ''), type: type === 'title' ? 'text' : type };
    if (prop.type === 'select' || prop.type === 'multi_select') prop.options = def.options ?? [];
    editor.storage.db = { ...(editor.storage.db ?? {}), lastProperty: prop.id };
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
  /** Move a property to another position (the title property always stays first). */
  dbMoveProperty: (editor, dbId: string, propId: string, toIndex: number) => {
    const db = getDb(editor, dbId);
    if (!db) return false;
    const props = [...dbProperties(db)];
    const from = props.findIndex((p) => p.id === propId);
    if (from < 1) return false;
    const [p] = props.splice(from, 1);
    props.splice(Math.max(1, Math.min(toIndex, props.length)), 0, p);
    if (props.every((x, i) => x === dbProperties(db)[i])) return false;
    return patchDb(editor, db, { properties: props });
  },
  /** Match every filter ('and') or any filter ('or'). */
  dbFilterMode: (editor, dbId: string, mode: 'and' | 'or', viewId?: string) => {
    const db = getDb(editor, dbId);
    return !!db && patchView(editor, db, viewId, (v) => ({ ...v, filterMode: mode === 'or' ? 'or' : undefined }));
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
    if (t === 'calendar' || t === 'timeline') {
      // these views need a date: create one if the database has none
      let date = dbProperties(db).find((p) => p.type === 'date');
      if (!date) {
        date = { id: 'p' + newId().slice(1, 8), name: 'Date', type: 'date' };
        const props = cleanProperties([...dbProperties(db), date]);
        view.dateProp = date.id;
        return patchDb(editor, db, { properties: props, views: [...dbViews(db), view], view: view.id });
      }
      view.dateProp = date.id;
    }
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
  const ctx = dbContext(db);
  const cell = (r: any, p: DbProperty): string => {
    const text = cellText(r, p, ctx);
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
      return [b.attrs?.title ? `**${b.attrs.title}**\n` : '', line(props.map((p) => p.name)), line(props.map(() => '---')), ...rows.map((r) => line(props.map((p) => cellText(r, p, dbContext(b)))))].filter(Boolean).join('\n');
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
    dbSlash('db-calendar', 'Database – calendar', 'Month view by a date', 'calendar', 54),
    dbSlash('db-timeline', 'Database – timeline', 'Bars across days', 'timeline', 55),
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
    editor.on('transaction', ({ tr, selectionChanged }) => {
      const selection = editor.selection;
      // a selection read from the DOM cannot really be inside hidden content: it is the
      // browser normalising a placeholder caret, and must not open anything
      if (!selectionChanged || tr.meta.fromDOM || !selection || selection.type !== 'text') return;
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
    dbMoveProperty(dbId: string, propId: string, toIndex: number): boolean;
    dbFilterMode(dbId: string, mode: 'and' | 'or', viewId?: string): boolean;
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
