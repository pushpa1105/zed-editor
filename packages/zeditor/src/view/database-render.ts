/**
 * Database UI: table, board, list, gallery, calendar and timeline views over the same rows.
 *
 * Row elements stay in document order (the reconciler owns child order). Each view is a CSS
 * layout over those elements: `order` for sorting, `hidden` for filtering, `grid-column` /
 * `grid-row` for board columns, calendar days and timeline bars. Headers, day cells and
 * "add" buttons are decoration elements without a `data-zid`, which the reconciler skips.
 */
import { Block } from '../core/model';
import { safeUrl } from '../core/schema';
import type { Editor } from '../core/editor';
import {
  DB_CALCS,
  DB_FILTER_OPS,
  DB_PROPERTY_TYPES,
  DB_VIEW_TYPES,
  DbContext,
  DbFilter,
  DbOption,
  DbProperty,
  DbResult,
  DbViewType,
  cellText,
  cellValue,
  dbActiveView,
  dbContext,
  dbProperties,
  dbRows,
  dbTypeSpec,
  dbViews,
  queryDatabase,
  relatedRows,
} from '../core/database';
import { checkFormula, FORMULA_FUNCTIONS } from '../core/formula';
import { NodeRenderer } from './render';
import { h, place } from './dom';
import { icon } from '../ui/icons';
import { getText } from '../features/text';

/* ------------------------------------------------------------------ helpers */

export function popup(anchor: HTMLElement, content: HTMLElement, label: string, role = 'dialog'): { el: HTMLElement; close: () => void } {
  const el = h('div', { class: 'z-popover z-db-pop', role, 'aria-label': label, 'data-z-ignore': '' }, content);
  (anchor.closest('.zeditor') ?? document.body).append(el);
  place(el, anchor.getBoundingClientRect());
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', down, true);
    el.remove();
  };
  const down = (e: Event) => {
    if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      anchor.focus();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (e.target as HTMLElement).tagName !== 'SELECT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
      // arrow keys walk the menu items
      const items = Array.from(el.querySelectorAll<HTMLElement>('.z-menu-item:not(:disabled)'));
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1) + (i < 0 && e.key === 'ArrowUp' ? 1 : 0)) % items.length].focus();
    }
  });
  setTimeout(() => {
    document.addEventListener('pointerdown', down, true);
    (el.querySelector('input, textarea, select, button') as HTMLElement | null)?.focus();
  });
  return { el, close };
}
export const btn = (label: string, onclick: (e: MouseEvent) => void, cls = 'z-btn', iconName?: string, text?: string): HTMLButtonElement => {
  const b = h('button', { type: 'button', class: cls, 'aria-label': label, title: label });
  if (iconName) b.append(h('span', { class: 'z-db-ic', html: icon(iconName) }));
  if (text !== undefined ? text : !iconName) b.append(h('span', null, text ?? label));
  b.addEventListener('click', onclick);
  return b;
};
export const select = (label: string, options: [string, string][], value: string, onchange: (v: string) => void): HTMLSelectElement => {
  const s = h('select', { class: 'z-input z-db-select', 'aria-label': label }, ...options.map(([v, t]) => h('option', { value: v }, t)));
  s.value = value;
  s.addEventListener('change', () => onchange(s.value));
  return s;
};
const chip = (o: DbOption) => h('span', { class: 'z-db-chip', 'data-color': o.color }, o.name);
const field = (label: string, control: HTMLElement) => h('label', { class: 'z-db-field' }, h('span', null, label), control);
const menuItem = (label: string, iconName: string | undefined, run: () => void, description?: string, disabled = false) => {
  const b = h('button', { type: 'button', class: 'z-menu-item', role: 'menuitem', disabled }, iconName ? h('span', { class: 'z-menu-icon', html: icon(iconName) }) : null, h('span', { class: 'z-menu-text' }, h('span', { class: 'z-menu-title' }, label), description ? h('span', { class: 'z-menu-desc' }, description) : null));
  b.addEventListener('click', run);
  return b;
};

const TYPE_META: Record<string, { label: string; icon: string; hint: string }> = {
  title: { label: 'Title', icon: 'db-title', hint: 'Name of the row' },
  text: { label: 'Text', icon: 'db-text', hint: 'Plain text' },
  number: { label: 'Number', icon: 'db-number', hint: 'Numbers you can sum and average' },
  select: { label: 'Select', icon: 'db-select', hint: 'One option from a list' },
  multi_select: { label: 'Multi-select', icon: 'db-multi', hint: 'Several tags' },
  checkbox: { label: 'Checkbox', icon: 'list-check', hint: 'Done / not done' },
  date: { label: 'Date', icon: 'db-calendar', hint: 'A day' },
  url: { label: 'URL', icon: 'link', hint: 'A web link' },
  email: { label: 'Email', icon: 'db-mail', hint: 'An e-mail address' },
  person: { label: 'Person', icon: 'db-person', hint: 'A name' },
  formula: { label: 'Formula', icon: 'db-formula', hint: 'Computed from other properties' },
  relation: { label: 'Relation', icon: 'db-relation', hint: 'Link rows of another database' },
  rollup: { label: 'Rollup', icon: 'db-rollup', hint: 'Summarize related rows' },
};
const typeMeta = (type: string) => TYPE_META[type] ?? { label: dbTypeSpec(type)?.label ?? type, icon: dbTypeSpec(type)?.icon ?? 'db-text', hint: 'Custom property' };
const VIEW_META: Record<DbViewType, { label: string; icon: string; hint: string }> = {
  table: { label: 'Table', icon: 'table', hint: 'Rows and typed columns' },
  board: { label: 'Board', icon: 'db-board', hint: 'Kanban columns by a select' },
  list: { label: 'List', icon: 'list-bullet', hint: 'Compact list of pages' },
  gallery: { label: 'Gallery', icon: 'db-gallery', hint: 'Cards with a preview' },
  calendar: { label: 'Calendar', icon: 'db-calendar', hint: 'Month grid by a date' },
  timeline: { label: 'Timeline', icon: 'db-timeline', hint: 'Bars across days' },
};

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayDiff = (a: Date, b: Date) => Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);

interface RowApi {
  refresh(props: DbProperty[], db: Block, ctx: DbContext, view: DbViewType): void;
  /** open the row's action menu next to an element or at a point */
  menu(at: HTMLElement | { x: number; y: number }): void;
}
/** rows of a database body in the order the view shows them (CSS `order`), visible only */
const visualRows = (body: Element | null): HTMLElement[] =>
  (Array.from(body?.children ?? []) as HTMLElement[]).filter((el) => el.dataset.zid && !el.hidden).sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0));
const rowApi = new WeakMap<HTMLElement, RowApi>();
const requestLayout = (el: HTMLElement | null) => el?.closest('.z-database')?.dispatchEvent(new CustomEvent('z-db-layout'));

/* ------------------------------------------------------------------ database */

export const database: NodeRenderer = (block, ctx) => {
  const { editor } = ctx;
  const L = (k: string, f?: string) => ctx.label(k, f);
  let id = block.id;
  const get = () => editor.doc.get(id);
  const ro = () => editor.readOnly;
  const st = () => (editor.storage.db ??= {});
  /** month / window shown by calendar and timeline views: view state, not saved in the document */
  const cursor = (viewId: string): Date => parseISO((st().cursor ??= {})[id + ':' + viewId]) ?? new Date();
  const setCursor = (viewId: string, d: Date) => {
    (st().cursor ??= {})[id + ':' + viewId] = isoOf(d);
    schedule();
  };

  const title = h('input', { class: 'z-db-title', type: 'text', 'aria-label': L('db.untitled'), placeholder: L('db.untitled') });
  const count = h('span', { class: 'z-db-count', role: 'status' });
  const tabs = h('div', { class: 'z-db-tabs', role: 'tablist', 'aria-label': L('db.views') });
  const tools = h('div', { class: 'z-db-tools', role: 'toolbar', 'aria-label': L('db.tools', 'Database tools') });
  const head = h('div', { class: 'z-db-head', contenteditable: 'false', 'data-z-ignore': '' }, h('div', { class: 'z-db-headrow' }, h('span', { class: 'z-db-ic z-db-titleicon', html: icon('db-database') }), title, count), h('div', { class: 'z-db-headrow z-db-bar' }, tabs, tools));
  const cols = h('div', { class: 'z-db-cols', contenteditable: 'false', 'data-z-ignore': '' });
  const body = h('div', { class: 'z-db-body' });
  const foot = h('div', { class: 'z-db-foot', contenteditable: 'false', 'data-z-ignore': '' });
  const scroll = h('div', { class: 'z-db-scroll' }, cols, body, foot);
  const dom = h('div', { class: 'z-block z-database' }, head, scroll);

  /* ---- quick search: view state, not saved in the document */
  const query = (): string => (st().search ??= {})[id] ?? '';
  const searchInput = h('input', { class: 'z-db-searchinput', type: 'text', 'aria-label': L('db.quickSearch', 'Search'), placeholder: L('db.searchPlaceholder', 'Type to search…') });
  const searchBtn = btn(L('db.quickSearch', 'Search'), () => {
    searchBox.classList.add('z-open');
    searchInput.focus();
  }, 'z-db-tool z-db-searchbtn', 'search');
  const searchBox = h('div', { class: 'z-db-search', role: 'search' }, searchBtn, searchInput);
  const setQuery = (q: string) => {
    (st().search ??= {})[id] = q;
    schedule();
  };
  searchInput.addEventListener('input', () => setQuery(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      searchInput.value = '';
      setQuery('');
      searchInput.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // jump to the first match
      (visualRows(body)[0]?.querySelector('.z-db-cell[data-type="title"] input') as HTMLElement | null)?.focus();
    }
  });
  searchInput.addEventListener('blur', () => {
    if (!searchInput.value) searchBox.classList.remove('z-open');
  });
  const edges = () => {
    tabs.classList.toggle('z-more-left', tabs.scrollLeft > 2);
    tabs.classList.toggle('z-more-right', tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 2);
  };
  tabs.addEventListener('scroll', edges, { passive: true });
  /* sticky title column: a shadow once the table is scrolled sideways */
  scroll.addEventListener('scroll', () => dom.classList.toggle('z-db-scrolled', scroll.scrollLeft > 2), { passive: true });

  title.addEventListener('change', () => editor.exec('dbSetTitle', id, title.value));
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') title.blur();
  });

  /* ---- adding things */
  const addRow = (cells: Record<string, any> = {}, focus = true) => {
    const db = get();
    if (!db) return;
    const view = dbActiveView(db);
    const props = dbProperties(db);
    // a new row satisfies simple "is" filters so it does not vanish immediately
    for (const f of view.filterMode === 'or' ? [] : (view.filters ?? [])) {
      const p = props.find((x) => x.id === f.prop);
      if (p && f.op === 'is' && p.type === 'select' && cells[p.id] === undefined) cells[p.id] = p.options?.find((o) => o.name.toLowerCase() === (f.value ?? '').toLowerCase())?.id;
    }
    // the new row must land somewhere this view shows it, or "New" looks like it did nothing
    const res = queryDatabase(db);
    if (view.type === 'board' && res.groupBy && cells[res.groupBy.id] === undefined) {
      // first lane with an option (not "no value")
      const first = res.groupBy.options?.[0];
      if (first) cells[res.groupBy.id] = first.id;
    }
    if ((view.type === 'calendar' || view.type === 'timeline') && res.dateProp) {
      const dp = res.dateProp;
      if (!cells[dp.id]) cells[dp.id] = isoOf(new Date());
      // bring the row's date into view: calendar shows its month, timeline starts its week
      const d = parseISO(String(cells[dp.id]))!;
      const cur = cursor(view.id);
      const shownAlready = view.type === 'calendar' ? cur.getFullYear() === d.getFullYear() && cur.getMonth() === d.getMonth() : dayDiff(d, addDays(cur, -cur.getDay())) >= 0 && dayDiff(d, addDays(cur, -cur.getDay())) < 28;
      if (!shownAlready) (st().cursor ??= {})[id + ':' + view.id] = isoOf(d);
    }
    if (query()) {
      // a search would hide the empty new row
      (st().search ??= {})[id] = '';
      searchInput.value = '';
    }
    if (editor.exec('dbAddRow', id, cells) && focus) {
      const rid = editor.storage.db?.lastRow;
      requestAnimationFrame(() => {
        const el = body.querySelector(`[data-zid="${rid}"]`) as HTMLElement | null;
        if (!el) return;
        el.classList.add('z-db-fresh');
        setTimeout(() => el.classList.remove('z-db-fresh'), 1400);
        const input = el.querySelector('.z-db-cell[data-type="title"] input') as HTMLElement | null;
        input?.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    }
  };
  const addPropertyMenu = (anchor: HTMLElement) => {
    const box = h('div', { class: 'z-db-menu', role: 'menu' }, h('div', { class: 'z-menu-group' }, L('db.propertyType', 'Property type')));
    for (const t of DB_PROPERTY_TYPES.filter((x) => x !== 'title')) {
      const m = typeMeta(t);
      box.append(
        menuItem(
          m.label,
          m.icon,
          () => {
            pop.close();
            if (!editor.exec('dbAddProperty', id, { type: t })) return;
            // open the new property's settings right away: name it, configure it
            const pid = editor.storage.db?.lastProperty;
            setTimeout(() => (cols.querySelector(`.z-db-colhead[data-prop="${pid}"]`) as HTMLElement | null)?.click(), 30);
          },
          m.hint,
        ),
      );
    }
    const pop = popup(anchor, box, L('db.addProperty'), 'menu');
  };
  const addViewMenu = (anchor: HTMLElement) => {
    const box = h('div', { class: 'z-db-menu', role: 'menu' }, h('div', { class: 'z-menu-group' }, L('db.addView')));
    for (const t of DB_VIEW_TYPES) box.append(menuItem(VIEW_META[t].label, VIEW_META[t].icon, () => (pop.close(), void editor.exec('dbAddView', id, t)), VIEW_META[t].hint));
    const pop = popup(anchor, box, L('db.addView'), 'menu');
  };

  /* ---- property settings */
  const propMenu = (anchor: HTMLElement, p: DbProperty, res: DbResult) => {
    const db = get()!;
    const name = h('input', { class: 'z-input', type: 'text', value: p.name, 'aria-label': L('db.rename') });
    name.addEventListener('change', () => name.value.trim() && name.value !== p.name && editor.exec('dbUpdateProperty', id, p.id, { name: name.value.trim() }));
    const box = h('div', { class: 'z-db-menu' }, name);
    const update = (patch: Partial<DbProperty>) => void editor.exec('dbUpdateProperty', id, p.id, patch);
    if (p.type !== 'title')
      box.append(
        field(L('db.type'), select(L('db.type'), DB_PROPERTY_TYPES.filter((t) => t !== 'title').map((t) => [t, typeMeta(t).label]), p.type, (t) => {
          pop.close();
          update({ type: t as any, options: undefined });
        })),
      );
    if (p.type === 'formula') {
      const src = h('textarea', { class: 'z-input z-db-formula', rows: '3', spellcheck: 'false', 'aria-label': L('db.formula', 'Formula'), placeholder: 'prop("Points") * 2' });
      src.value = p.formula ?? '';
      const msg = h('div', { class: 'z-db-hint', role: 'status' });
      const check = () => {
        const err = src.value.trim() ? checkFormula(src.value) : null;
        msg.textContent = err ?? `prop("Name") · ${FORMULA_FUNCTIONS.slice(0, 9).join(', ')}…`;
        msg.classList.toggle('z-db-error', !!err);
      };
      src.addEventListener('input', check);
      src.addEventListener('change', () => update({ formula: src.value }));
      check();
      box.append(src, msg);
    }
    if (p.type === 'relation') {
      const others = [...editor.doc.descendants()].filter((b) => b.type === 'database');
      box.append(field(L('db.relatedTo', 'Related to'), select(L('db.relatedTo', 'Related to'), [['', L('db.none')], ...others.map((d) => [d.id, (d.attrs.title || L('db.untitled')) + (d.id === id ? ' (this)' : '')] as [string, string])], p.relation?.database ?? '', (v) => update({ relation: { database: v } }))));
    }
    if (p.type === 'rollup') {
      const rels = dbProperties(db).filter((x) => x.type === 'relation');
      const rel = rels.find((x) => x.id === p.rollup?.relation);
      const target = rel?.relation?.database ? editor.doc.get(rel.relation.database) : null;
      const set = (patch: Partial<NonNullable<DbProperty['rollup']>>) => {
        update({ rollup: { relation: p.rollup?.relation ?? '', target: p.rollup?.target ?? '', calc: p.rollup?.calc ?? 'show', ...patch } });
        pop.close();
      };
      box.append(
        field(L('db.relation', 'Relation'), select(L('db.relation', 'Relation'), [['', L('db.none')], ...rels.map((x) => [x.id, x.name] as [string, string])], p.rollup?.relation ?? '', (v) => set({ relation: v, target: '' }))),
        field(L('db.rollupProperty', 'Property'), select(L('db.rollupProperty', 'Property'), [['', L('db.none')], ...(target ? dbProperties(target) : []).map((x) => [x.id, x.name] as [string, string])], p.rollup?.target ?? '', (v) => set({ target: v }))),
        field(L('db.calculate'), select(L('db.rollupCalc', 'Rollup calculation'), [['show', 'show values'], ...DB_CALCS.map((c) => [c, c.replace('_', ' ')] as [string, string])], p.rollup?.calc ?? 'show', (v) => set({ calc: v as any }))),
      );
      if (!rels.length) box.append(h('div', { class: 'z-db-hint' }, L('db.needRelation', 'Add a relation property first.')));
    }
    box.append(field(L('db.calculate'), select(L('db.calculate'), [['', L('db.none')], ...DB_CALCS.map((c) => [c, c.replace('_', ' ')] as [string, string])], res.view.calc?.[p.id] ?? '', (c) => void editor.exec('dbCalculate', id, p.id, c || null))));
    box.append(h('div', { class: 'z-db-sep' }), menuItem(L('db.sortAsc'), 'up', () => (pop.close(), void editor.exec('dbSort', id, p.id, 'asc'))), menuItem(L('db.sortDesc'), 'down', () => (pop.close(), void editor.exec('dbSort', id, p.id, 'desc'))));
    if (p.type !== 'title') {
      const idx = dbProperties(db).findIndex((x) => x.id === p.id);
      box.append(
        menuItem(L('db.moveLeft', 'Move left'), 'db-left', () => (pop.close(), void editor.exec('dbMoveProperty', id, p.id, idx - 1)), undefined, idx <= 1),
        menuItem(L('db.moveRight', 'Move right'), 'db-right', () => (pop.close(), void editor.exec('dbMoveProperty', id, p.id, idx + 1)), undefined, idx >= dbProperties(db).length - 1),
        menuItem(L('db.hideProperty'), 'db-hide', () => (pop.close(), void editor.exec('dbToggleProperty', id, p.id))),
        menuItem(L('db.deleteProperty'), 'trash', () => (pop.close(), void editor.exec('dbDeleteProperty', id, p.id))),
      );
    }
    const pop = popup(anchor, box, p.name);
  };

  /* ---- view tools */
  const filterPopup = (anchor: HTMLElement) => {
    const box = h('div', { class: 'z-db-menu' });
    const render = () => {
      const db = get()!;
      const props = dbProperties(db);
      const view = dbActiveView(db);
      const filters = view.filters ?? [];
      box.textContent = '';
      const save = (next: DbFilter[]) => {
        editor.exec('dbFilter', id, next.length ? next : null);
        render();
      };
      if (filters.length > 1)
        box.append(
          field(
            L('db.match', 'Match'),
            select(L('db.match', 'Match'), [['and', L('db.matchAll', 'all filters')], ['or', L('db.matchAny', 'any filter')]], view.filterMode ?? 'and', (v) => {
              editor.exec('dbFilterMode', id, v as any);
              render();
            }),
          ),
        );
      filters.forEach((f, i) => {
        const value = h('input', { class: 'z-input', type: 'text', value: f.value ?? '', 'aria-label': 'Filter value', placeholder: 'value' });
        value.addEventListener('change', () => save(filters.map((x, j) => (j === i ? { ...x, value: value.value } : x))));
        box.append(
          h(
            'div',
            { class: 'z-db-filter' },
            select('Property', props.map((p) => [p.id, p.name]), f.prop, (v) => save(filters.map((x, j) => (j === i ? { ...x, prop: v } : x)))),
            select('Condition', DB_FILTER_OPS.map((o) => [o, o.replace('_', ' ')]), f.op, (v) => save(filters.map((x, j) => (j === i ? { ...x, op: v as any } : x)))),
            /empty|checked/.test(f.op) ? null : value,
            btn('Remove filter', () => save(filters.filter((_, j) => j !== i)), 'z-btn z-db-iconbtn', 'close'),
          ),
        );
      });
      box.append(btn('+ ' + L('db.filter'), () => save([...filters, { prop: props[0].id, op: 'contains', value: '' }]), 'z-menu-item'));
    };
    render();
    popup(anchor, box, L('db.filter'));
  };
  const sortPopup = (anchor: HTMLElement) => {
    const db = get()!;
    const s = dbActiveView(db).sorts?.[0];
    let prop = s?.prop ?? '';
    let dir = s?.dir ?? 'asc';
    const apply = () => void editor.exec('dbSort', id, prop || null, dir as any);
    popup(
      anchor,
      h(
        'div',
        { class: 'z-db-menu' },
        field(L('db.sort'), select(L('db.sort'), [['', L('db.none')], ...dbProperties(db).map((p) => [p.id, p.name] as [string, string])], prop, (v) => ((prop = v), apply()))),
        field(L('db.direction', 'Direction'), select('Direction', [['asc', L('db.sortAsc')], ['desc', L('db.sortDesc')]], dir, (v) => ((dir = v as any), apply()))),
      ),
      L('db.sort'),
    );
  };
  const groupPopup = (anchor: HTMLElement) => {
    const db = get()!;
    const view = dbActiveView(db);
    const hide = h('input', { type: 'checkbox', checked: !!view.hideEmptyGroups });
    hide.addEventListener('change', () => void editor.exec('dbUpdateView', id, view.id, { hideEmptyGroups: hide.checked || undefined }));
    popup(anchor, h('div', { class: 'z-db-menu' }, field(L('db.group'), select(L('db.group'), [...(view.type === 'board' ? [] : [['', L('db.none')] as [string, string]]), ...dbProperties(db).filter((p) => p.type === 'select').map((p) => [p.id, p.name] as [string, string])], view.groupBy ?? (view.type === 'board' ? (queryDatabase(db).groupBy?.id ?? '') : ''), (v) => void editor.exec('dbGroupBy', id, v || null))), h('label', { class: 'z-db-field z-db-check' }, hide, L('db.hideEmptyGroups', 'Hide empty groups'))), L('db.group'));
  };
  const propsPopup = (anchor: HTMLElement) => {
    const box = h('div', { class: 'z-db-menu' });
    const render = () => {
      const db = get()!;
      const hidden = new Set(dbActiveView(db).hidden ?? []);
      box.textContent = '';
      for (const p of dbProperties(db)) {
        const cb = h('input', { type: 'checkbox', checked: !hidden.has(p.id), disabled: p.type === 'title' });
        cb.addEventListener('change', () => {
          editor.exec('dbToggleProperty', id, p.id);
          render();
        });
        box.append(h('label', { class: 'z-db-field z-db-check' }, cb, h('span', { class: 'z-db-ic', html: icon(typeMeta(p.type).icon) }), p.name));
      }
      box.append(h('div', { class: 'z-db-sep' }), btn(L('db.addProperty'), (e) => addPropertyMenu(e.currentTarget as HTMLElement), 'z-menu-item', 'plus', L('db.addProperty')));
    };
    render();
    popup(anchor, box, L('db.properties'));
  };
  const viewMenu = (anchor: HTMLElement, viewId: string) => {
    const db = get()!;
    const v = dbViews(db).find((x) => x.id === viewId)!;
    const name = h('input', { class: 'z-input', type: 'text', value: v.name, 'aria-label': L('db.rename') });
    name.addEventListener('change', () => name.value.trim() && editor.exec('dbUpdateView', id, viewId, { name: name.value.trim() }));
    const box = h('div', { class: 'z-db-menu' }, name, field(L('db.type'), select(L('db.type'), DB_VIEW_TYPES.map((t) => [t, VIEW_META[t].label]), v.type, (t) => void editor.exec('dbUpdateView', id, viewId, { type: t as any }))));
    const dates = dbProperties(db).filter((p) => p.type === 'date');
    if (v.type === 'calendar' || v.type === 'timeline') {
      box.append(field(L('db.dateProperty', 'Date'), select(L('db.dateProperty', 'Date'), dates.map((p) => [p.id, p.name]), v.dateProp ?? dates[0]?.id ?? '', (x) => void editor.exec('dbUpdateView', id, viewId, { dateProp: x }))));
      if (v.type === 'timeline') box.append(field(L('db.endProperty', 'End date'), select(L('db.endProperty', 'End date'), [['', L('db.none')], ...dates.map((p) => [p.id, p.name] as [string, string])], v.endProp ?? '', (x) => void editor.exec('dbUpdateView', id, viewId, { endProp: x || undefined }))));
    }
    box.append(h('div', { class: 'z-db-sep' }), menuItem(L('db.deleteView'), 'trash', () => (pop.close(), void editor.exec('dbDeleteView', id, viewId)), undefined, dbViews(db).length < 2));
    const pop = popup(anchor, box, v.name);
  };

  /* ---- column resize and reorder (table header) */
  const headerPointer = (hd: HTMLElement, p: DbProperty, res: DbResult, e: PointerEvent, widths: number[], index: number) => {
    if (ro() || e.button !== 0) return;
    const resizing = (e.target as HTMLElement).classList.contains('z-db-resize');
    const startX = e.clientX;
    let moved = false;
    let width = widths[index];
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 5) return;
      moved = true;
      if (resizing) {
        width = Math.max(60, Math.min(800, Math.round(widths[index] + dx)));
        const next = [...widths];
        next[index] = width;
        dom.style.setProperty('--z-db-template', next.map((w) => w + 'px').join(' ') + ' 40px');
      } else if (p.type !== 'title') {
        hd.classList.add('z-dragging');
        hd.style.transform = `translateX(${dx}px)`;
      }
    };
    const up = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      hd.classList.remove('z-dragging');
      hd.style.transform = '';
      if (!moved) {
        if (!resizing) propMenu(hd, p, res);
        return;
      }
      if (resizing) return void editor.exec('dbUpdateProperty', id, p.id, { width });
      if (p.type === 'title') return;
      // drop position: the header whose middle the pointer passed
      const heads = Array.from(cols.querySelectorAll<HTMLElement>('.z-db-colhead[data-prop]'));
      let to = heads.findIndex((x) => ev.clientX < x.getBoundingClientRect().left + x.getBoundingClientRect().width / 2);
      if (to < 0) to = heads.length;
      const all = dbProperties(get()!);
      const targetId = heads[Math.min(to, heads.length - 1)]?.dataset.prop;
      let dest = all.findIndex((x) => x.id === targetId);
      if (to >= heads.length) dest = all.length;
      const from = all.findIndex((x) => x.id === p.id);
      if (dest > from) dest--;
      editor.exec('dbMoveProperty', id, p.id, Math.max(1, dest));
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  /* ---- row menu on right click (not inside an opened row's page, which has its own menus) */
  body.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest('.z-db-row') as HTMLElement | null;
    // selected text in a field keeps the browser's own menu (copy, paste)
    const field = t.tagName === 'INPUT' ? (t as HTMLInputElement) : null;
    if (!row || ro() || t.closest('.z-db-page') || (field && field.selectionStart !== field.selectionEnd)) return;
    e.preventDefault();
    rowApi.get(row)?.menu({ x: e.clientX, y: e.clientY });
  });

  /* calendar entries and timeline bars are mostly their title field: a press there starts a
     drag; a click without movement still edits the title */
  const datedView = () => dom.dataset.view === 'calendar' || dom.dataset.view === 'timeline';
  body.addEventListener('mousedown', (e) => {
    const t = e.target as HTMLElement;
    if (datedView() && !ro() && e.button === 0 && t.matches('.z-db-row:not(.z-db-open) .z-db-cell[data-type="title"] input') && document.activeElement !== t) e.preventDefault();
  });

  /* ---- cards: drag between board columns and reorder; calendar / timeline: change dates */
  body.addEventListener('pointerdown', (e) => {
    const card = (e.target as HTMLElement).closest('.z-db-row') as HTMLElement | null;
    const kind = dom.dataset.view;
    if (!card || card.classList.contains('z-db-open') || (kind !== 'board' && !datedView()) || ro() || e.button !== 0) return;
    const titleInput = (e.target as HTMLElement).matches('.z-db-cell[data-type="title"] input') && document.activeElement !== e.target ? (e.target as HTMLInputElement) : null;
    if (!(datedView() && titleInput) && (e.target as HTMLElement).closest('input, button, select, a, .z-db-page')) return;
    const rowId = card.dataset.zid!;
    const startX = e.clientX;
    const startY = e.clientY;
    const cr = card.getBoundingClientRect();
    // timeline: grabbing a bar's right end changes its end date instead of moving it
    const resizing = kind === 'timeline' && startX > cr.right - 10 && dom.classList.contains('z-db-hasend');
    let moved = false;
    const dayAt = (x: number, y: number, sel: string): HTMLElement | undefined =>
      Array.from(body.querySelectorAll<HTMLElement>(sel)).find((d) => {
        const r = d.getBoundingClientRect();
        return x >= r.left && x < r.right && (sel === '.z-db-tlday' || (y >= r.top && y < r.bottom));
      });
    let hover: HTMLElement | undefined;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
      moved = true;
      card.classList.add('z-dragging');
      if (resizing) card.style.width = Math.max(24, cr.width + ev.clientX - startX) + 'px';
      else card.style.transform = kind === 'timeline' ? `translateX(${ev.clientX - startX}px)` : `translate(${ev.clientX - startX}px, ${ev.clientY - startY}px)${kind === 'board' ? ' rotate(1.5deg)' : ''}`;
      if (kind === 'calendar') {
        const d = dayAt(ev.clientX, ev.clientY, '.z-db-day');
        if (d !== hover) {
          hover?.classList.remove('z-drop');
          d?.classList.add('z-drop');
          hover = d;
        }
      }
    };
    const up = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      card.classList.remove('z-dragging');
      card.style.transform = '';
      card.style.width = '';
      hover?.classList.remove('z-drop');
      if (!moved) {
        if (titleInput) titleInput.focus();
        return;
      }
      const db = get();
      if (!db) return;
      const res = queryDatabase(db, undefined, { search: query() });
      if (kind !== 'board') {
        const dp = res.dateProp;
        const row = editor.doc.get(rowId);
        if (!dp || !row) return;
        if (kind === 'calendar') {
          const day = dayAt(ev.clientX, ev.clientY, '.z-db-day')?.dataset.date;
          if (day && day !== cellValue(row, dp, res.ctx)) editor.exec('dbSetCell', rowId, dp.id, day);
          return;
        }
        // timeline: shift by whole days (the bar's start moves with the pointer)
        const from = dayAt(startX, startY, '.z-db-tlday')?.dataset.date;
        const to = dayAt(ev.clientX, ev.clientY, '.z-db-tlday')?.dataset.date;
        const a = parseISO(from ?? '');
        const b = parseISO(to ?? '');
        if (!a || !b) return;
        const delta = dayDiff(b, a);
        if (!delta) return;
        const start = parseISO(String(cellValue(row, dp, res.ctx) ?? ''));
        const endP = res.endProp;
        const end = endP ? parseISO(String(cellValue(row, endP, res.ctx) ?? '')) : null;
        if (!start) return;
        editor.update(() => {
          if (resizing) {
            if (!endP) return;
            const next = addDays(end ?? start, delta);
            editor.exec('dbSetCell', rowId, endP.id, isoOf(dayDiff(next, start) < 0 ? start : next));
            return;
          }
          editor.exec('dbSetCell', rowId, dp.id, isoOf(addDays(start, delta)));
          if (endP && end) editor.exec('dbSetCell', rowId, endP.id, isoOf(addDays(end, delta)));
        });
        return;
      }
      const hit = Array.from(cols.querySelectorAll<HTMLElement>('.z-db-colhead')).find((hd) => {
        const r = hd.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right;
      });
      if (!hit || !res.groupBy) return;
      const option = hit.dataset.option || null;
      // the card under the pointer in that column decides the position (when the view is unsorted)
      const over = Array.from(body.querySelectorAll<HTMLElement>('.z-db-row')).find((el) => {
        if (el === card || el.hidden) return false;
        const r = el.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      });
      editor.update(() => {
        if ((cellValue(editor.doc.get(rowId)!, res.groupBy!, res.ctx) ?? null) !== option) editor.exec('dbSetCell', rowId, res.groupBy!.id, option);
        if (over && !res.view.sorts?.length) {
          const r = over.getBoundingClientRect();
          editor.exec('dbMoveRow', rowId, over.dataset.zid!, ev.clientY < r.top + r.height / 2 ? 'before' : 'after');
        }
      });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  /** decoration element inside the body grid (skipped by the reconciler: no data-zid) */
  const deco = (cls: string, style: string, ...children: (Node | string | null)[]) => {
    const el = h('div', { class: 'z-db-deco ' + cls, contenteditable: 'false', 'data-z-ignore': '' }, ...children);
    el.style.cssText = style;
    return el;
  };

  const layout = () => {
    const db = get();
    if (!db || db.type !== 'database') return;
    const res = queryDatabase(db, undefined, { search: query() });
    const { view, visible } = res;
    // headers and tabs are rebuilt: remember which one had keyboard focus and give it back
    const focused = document.activeElement as HTMLElement | null;
    const refocus = focused && (cols.contains(focused) || tabs.contains(focused)) ? (focused.dataset.prop ? `.z-db-colhead[data-prop="${focused.dataset.prop}"]` : focused.dataset.view ? `.z-db-tab[data-view="${focused.dataset.view}"]` : null) : null;
    if (dom.dataset.viewId !== view.id) scroll.scrollLeft = 0;
    dom.dataset.viewId = view.id;
    dom.dataset.view = view.type;
    dom.classList.toggle('z-db-hasend', !!res.endProp);
    dom.classList.toggle('z-db-readonly', ro());
    if (document.activeElement !== title) title.value = db.attrs.title ?? '';
    title.readOnly = ro();
    if (document.activeElement !== searchInput && searchInput.value !== query()) searchInput.value = query();
    searchBox.classList.toggle('z-open', !!query() || document.activeElement === searchInput);
    count.textContent = res.rows.length === res.total ? String(res.total) : L('db.count').replace('{n}', String(res.rows.length)).replace('{total}', String(res.total));

    /* view tabs */
    tabs.textContent = '';
    for (const v of dbViews(db)) {
      const selected = v.id === view.id;
      const tab = h('button', { type: 'button', class: 'z-db-tab', role: 'tab', 'aria-selected': String(selected), 'data-view': v.id, tabindex: selected ? '0' : '-1' }, h('span', { class: 'z-db-ic', html: icon(VIEW_META[v.type].icon) }), h('span', null, v.name));
      tab.addEventListener('click', () => (selected && !ro() ? viewMenu(tab, v.id) : void editor.exec('dbSetView', id, v.id)));
      tab.addEventListener('keydown', (e) => {
        const all = Array.from(tabs.querySelectorAll<HTMLElement>('[role=tab]'));
        const i = all.indexOf(tab);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length].focus();
        }
      });
      tabs.append(tab);
    }
    if (!ro()) tabs.append(btn(L('db.addView'), (e) => addViewMenu(e.currentTarget as HTMLElement), 'z-db-tab z-db-addview', 'plus'));
    // keep the active tab in sight when the tabs overflow (read layout after this pass)
    requestAnimationFrame(() => {
      const on = tabs.querySelector<HTMLElement>('[aria-selected="true"]');
      if (on && tabs.scrollWidth > tabs.clientWidth) {
        if (on.offsetLeft < tabs.scrollLeft) tabs.scrollLeft = on.offsetLeft - 8;
        else if (on.offsetLeft + on.offsetWidth > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = on.offsetLeft + on.offsetWidth - tabs.clientWidth + 40;
      }
      edges();
    });

    /* tools */
    for (const c of Array.from(tools.children)) if (c !== searchBox) c.remove();
    if (searchBox.parentNode !== tools) tools.prepend(searchBox);
    if (!ro()) {
      const tool = (label: string, ic: string, fn: (el: HTMLElement) => void, on: boolean, badge?: number) => {
        const b = btn(label, (e) => fn(e.currentTarget as HTMLElement), 'z-db-tool', ic, label);
        b.setAttribute('aria-pressed', String(on));
        if (badge) b.append(h('span', { class: 'z-db-badge' }, String(badge)));
        return b;
      };
      tools.append(tool(L('db.filter'), 'db-filter', filterPopup, !!view.filters?.length, view.filters?.length), tool(L('db.sort'), 'db-sort', sortPopup, !!view.sorts?.length), ...(view.type === 'calendar' || view.type === 'timeline' ? [] : [tool(L('db.group'), 'db-group', groupPopup, !!view.groupBy)]), tool(L('db.properties'), 'db-props', propsPopup, false), btn(L('db.newRow'), () => addRow(), 'z-db-newbtn', 'plus', L('db.newRow')));
    }

    /* per-view decorations */
    for (const el of Array.from(body.querySelectorAll(':scope > .z-db-deco'))) el.remove();
    cols.textContent = '';
    foot.textContent = '';
    body.style.gridTemplateColumns = '';
    const widths = visible.map((p) => p.width ?? (p.type === 'title' ? 280 : p.type === 'checkbox' ? 96 : p.type === 'number' ? 110 : 170));
    // fixed tracks: header, every row and the footer are separate grids and must line up exactly
    dom.style.setProperty('--z-db-template', widths.map((w) => w + 'px').join(' ') + ' 40px');

    const place2 = new Map<string, { col?: string; row?: string; end?: boolean }>();
    const shown = new Set(res.rows.map((r) => r.id));
    const groups = view.type === 'board' ? res.groups : null;
    const lanes: { ids: string[]; lane: HTMLElement; add: HTMLElement | null }[] = [];

    if (view.type === 'table') {
      visible.forEach((p, i) => {
        const sort = view.sorts?.[0]?.prop === p.id ? view.sorts[0].dir : null;
        const hd = h('button', { type: 'button', class: 'z-db-colhead', 'data-prop': p.id, 'aria-label': p.name, disabled: ro() }, h('span', { class: 'z-db-ic', html: icon(typeMeta(p.type).icon) }), h('span', { class: 'z-db-colname' }, p.name), sort ? h('span', { class: 'z-db-ic z-db-sortmark', html: icon(sort === 'asc' ? 'up' : 'down') }) : null, ro() ? null : h('span', { class: 'z-db-resize', 'aria-hidden': 'true' }));
        hd.addEventListener('pointerdown', (e) => headerPointer(hd, p, res, e, widths, i));
        // keyboard and assistive activation (pointer clicks are handled on pointerup)
        hd.addEventListener('click', (e) => e.detail === 0 && propMenu(hd, p, res));
        cols.append(hd);
      });
      cols.append(ro() ? h('span') : btn(L('db.addProperty'), (e) => addPropertyMenu(e.currentTarget as HTMLElement), 'z-db-colhead z-db-addprop', 'plus'));
      if (!ro()) foot.append(btn(L('db.newRow'), () => addRow(), 'z-db-new', 'plus', L('db.newRow')));
      if (Object.keys(res.calc).length) foot.append(h('div', { class: 'z-db-calc' }, ...visible.map((p) => h('span', { class: 'z-db-calccell', 'data-prop': p.id }, res.calc[p.id] !== undefined ? h('span', { class: 'z-db-calclabel' }, view.calc![p.id].replace('_', ' ') + ' ') : null, res.calc[p.id] ?? '')), h('span')));
    } else if (groups) {
      dom.style.setProperty('--z-db-board', `repeat(${groups.length}, 272px)`);
      groups.forEach((g, gi) => {
        cols.append(h('div', { class: 'z-db-colhead z-db-group', 'data-option': g.option?.id ?? '', 'data-color': g.option?.color ?? 'none' }, g.option ? chip(g.option) : h('span', { class: 'z-db-nogroup' }, L('db.noValue')), h('span', { class: 'z-db-groupcount' }, String(g.rows.length))));
        // cards, the tinted lane behind them and the "add" button share grid cells; rows are
        // assigned after the cards are measured (see `stack` below) so lanes pack independently
        g.rows.forEach((r, ri) => place2.set(r.id, { col: String(gi + 1), row: String(ri + 1) }));
        const lane = deco('z-db-lane', `grid-column:${gi + 1};grid-row:1;`);
        lane.dataset.color = g.option?.color ?? 'none';
        body.append(lane);
        let addEl: HTMLElement | null = null;
        if (!ro()) {
          const add = btn(L('db.newRow'), () => addRow(res.groupBy ? { [res.groupBy.id]: g.option?.id ?? null } : {}), 'z-db-new z-db-lanenew', 'plus', L('db.newRow'));
          addEl = deco('z-db-laneadd', `grid-column:${gi + 1};grid-row:1;`, add);
          body.append(addEl);
        }
        lanes.push({ ids: g.rows.map((r) => r.id), lane, add: addEl });
      });
    } else if (view.type === 'calendar' || view.type === 'timeline') {
      const dp = res.dateProp;
      const cur = cursor(view.id);
      const nav = (label: string, d: Date, ic?: string, text?: string) => btn(label, () => setCursor(view.id, d), 'z-db-tool z-db-nav', ic, text);
      const today = new Date();
      if (view.type === 'calendar') {
        const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
        const start = addDays(first, -first.getDay());
        const weeks = Math.ceil((first.getDay() + new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate()) / 7);
        cols.append(h('div', { class: 'z-db-calnav' }, h('strong', { class: 'z-db-month' }, new Intl.DateTimeFormat(editor.options.locale, { month: 'long', year: 'numeric' }).format(first)), nav(L('db.prev', 'Previous month'), new Date(cur.getFullYear(), cur.getMonth() - 1, 1), 'db-left'), nav(L('db.today', 'Today'), today, undefined, L('db.today', 'Today')), nav(L('db.next', 'Next month'), new Date(cur.getFullYear(), cur.getMonth() + 1, 1), 'db-right')));
        const byDay = new Map<string, Block[]>();
        if (dp) for (const r of res.rows) {
          const d = String(cellValue(r, dp, res.ctx) ?? '');
          if (parseISO(d)) byDay.set(d, [...(byDay.get(d) ?? []), r]);
        }
        body.style.gridTemplateColumns = 'repeat(7, minmax(0, 1fr))';
        for (let d = 0; d < 7; d++) body.append(deco('z-db-weekday', `grid-column:${d + 1};grid-row:1;`, new Intl.DateTimeFormat(editor.options.locale, { weekday: 'short' }).format(addDays(start, d))));
        let base = 2;
        for (let w = 0; w < weeks; w++) {
          const days = Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d));
          const slots = Math.max(2, ...days.map((d) => byDay.get(isoOf(d))?.length ?? 0));
          days.forEach((d, di) => {
            const key = isoOf(d);
            const cell = deco('z-db-day' + (d.getMonth() !== cur.getMonth() ? ' z-db-otherday' : '') + (key === isoOf(today) ? ' z-db-todaycell' : ''), `grid-column:${di + 1};grid-row:${base} / span ${slots + 1};`, h('span', { class: 'z-db-daynum' }, String(d.getDate())));
            cell.dataset.date = key;
            if (!ro() && dp) cell.append(btn(`${L('db.newRow')} ${key}`, () => addRow({ [dp.id]: key }), 'z-db-dayadd', 'plus'));
            body.append(cell);
            (byDay.get(key) ?? []).forEach((r, i) => place2.set(r.id, { col: String(di + 1), row: String(base + 1 + i) }));
          });
          base += slots + 1;
        }
        for (const r of res.rows) if (!place2.has(r.id)) shown.delete(r.id);
      } else {
        const DAYS = 28;
        const start = addDays(cur, -cur.getDay());
        cols.append(h('div', { class: 'z-db-calnav' }, h('strong', { class: 'z-db-month' }, new Intl.DateTimeFormat(editor.options.locale, { month: 'short', day: 'numeric' }).format(start) + ' – ' + new Intl.DateTimeFormat(editor.options.locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(addDays(start, DAYS - 1))), nav(L('db.prev', 'Previous'), addDays(start, -14), 'db-left'), nav(L('db.today', 'Today'), today, undefined, L('db.today', 'Today')), nav(L('db.next', 'Next'), addDays(start, 14), 'db-right')));
        body.style.gridTemplateColumns = `repeat(${DAYS}, minmax(34px, 1fr))`;
        let line = 2;
        const lines: { r: Block; from: number; to: number }[] = [];
        if (dp) for (const r of res.rows) {
          const s = parseISO(String(cellValue(r, dp, res.ctx) ?? ''));
          if (!s) continue;
          const e2 = (res.endProp && parseISO(String(cellValue(r, res.endProp, res.ctx) ?? ''))) || s;
          const from = dayDiff(s, start);
          const to = Math.max(from, dayDiff(e2, start));
          if (to < 0 || from >= DAYS) continue;
          lines.push({ r, from: Math.max(0, from), to: Math.min(DAYS - 1, to) });
        }
        for (let d = 0; d < DAYS; d++) {
          const day = addDays(start, d);
          const tl = body.appendChild(deco('z-db-tlday' + (isoOf(day) === isoOf(today) ? ' z-db-todaycell' : '') + (day.getDay() === 0 || day.getDay() === 6 ? ' z-db-weekend' : ''), `grid-column:${d + 1};grid-row:1 / span ${lines.length + 2};`, h('span', { class: 'z-db-daynum' }, (day.getDate() === 1 || d === 0 ? new Intl.DateTimeFormat(editor.options.locale, { month: 'short' }).format(day) + ' ' : '') + day.getDate())));
          tl.dataset.date = isoOf(day);
        }
        for (const l of lines) place2.set(l.r.id, { col: `${l.from + 1} / ${l.to + 2}`, row: String(line++), end: l.from > DAYS - 6 });
        for (const r of res.rows) if (!place2.has(r.id)) shown.delete(r.id);
      }
      const undated = res.rows.length - shown.size;
      if (!dp) foot.append(h('div', { class: 'z-db-hint' }, L('db.needDate', 'Add a date property to place rows.')));
      else if (undated) foot.append(h('div', { class: 'z-db-hint' }, L('db.offscreen', '{n} not shown (no date or outside this range)').replace('{n}', String(undated))));
      if (!ro()) foot.append(btn(L('db.newRow'), () => addRow(dp ? { [dp.id]: isoOf(today) } : {}), 'z-db-new', 'plus', L('db.newRow')));
    } else if (!ro()) foot.append(btn(L('db.newRow'), () => addRow(), 'z-db-new', 'plus', L('db.newRow')));

    /* rows: order, visibility and grid placement */
    let order = new Map(res.rows.map((r, i) => [r.id, i]));
    if (!groups && res.groups && (view.type === 'table' || view.type === 'list' || view.type === 'gallery')) {
      // grouped table / list / gallery: a header per group, rows ordered group by group;
      // a click on a header folds the group (view state, not saved)
      const folded: Set<string> = ((st().folded ??= {})[id + ':' + view.id] ??= new Set());
      order = new Map();
      let n = 0;
      for (const g of res.groups) {
        // an empty "no value" section is noise; empty option sections stay (unless hidden in the Group menu)
        if (!g.option && !g.rows.length) continue;
        const key = g.option?.id ?? '';
        const isFolded = folded.has(key);
        const head = btn(
          g.option?.name ?? L('db.noValue'),
          () => {
            if (folded.has(key)) folded.delete(key);
            else folded.add(key);
            schedule();
          },
          'z-db-section',
        );
        head.textContent = '';
        head.append(h('span', { class: 'z-db-ic z-db-fold', html: icon('chevron') }), g.option ? chip(g.option) : h('span', { class: 'z-db-nogroup' }, L('db.noValue')), h('span', { class: 'z-db-groupcount' }, String(g.rows.length)));
        head.setAttribute('aria-expanded', String(!isFolded));
        const sec = deco('z-db-sectionrow', `order:${n++};`, head);
        sec.dataset.option = key;
        if (isFolded) sec.classList.add('z-folded');
        body.append(sec);
        for (const r of g.rows) {
          order.set(r.id, n++);
          if (isFolded) shown.delete(r.id);
        }
      }
    }
    for (const el of Array.from(body.children) as HTMLElement[]) {
      const rid = el.dataset.zid;
      if (!rid) continue;
      const i = order.get(rid);
      el.hidden = i === undefined || !shown.has(rid);
      el.style.order = String(i ?? 0);
      const open = el.classList.contains('z-db-open');
      const pos = place2.get(rid);
      const wide = open && view.type !== 'table' && view.type !== 'list';
      el.style.gridColumn = wide ? '1 / -1' : (pos?.col ?? '');
      el.style.gridRow = wide ? (view.type === 'board' ? '999' : 'auto') : (pos?.row ?? '');
      el.style.justifySelf = !wide && pos?.end ? 'end' : '';
      rowApi.get(el)?.refresh(visible, db, res.ctx, view.type);
      // a board card does not repeat the value its column already shows
      for (const c of Array.from(el.querySelectorAll<HTMLElement>(':scope > .z-db-cells > .z-db-cell'))) c.classList.toggle('z-db-grouped', !!groups && !!res.groupBy && c.dataset.prop === res.groupBy.id);
    }
    if (groups) {
      // masonry: 4px tracks, every card spans as many as it is tall, so a tall card in one
      // column never pushes the cards of another column down
      const UNIT = 4;
      const byId = new Map((Array.from(body.children) as HTMLElement[]).filter((el) => el.dataset.zid).map((el) => [el.dataset.zid!, el]));
      const ends: number[] = [];
      for (const l of lanes) {
        let y = 1;
        for (const rid of l.ids) {
          const el = byId.get(rid);
          if (!el || el.hidden || el.classList.contains('z-db-open')) continue;
          const span = Math.max(1, Math.ceil((el.offsetHeight + 6) / UNIT));
          el.style.gridRow = `${y} / span ${span}`;
          y += span;
        }
        if (l.add) {
          l.add.style.gridRow = `${y} / span 10`;
          y += 10;
        }
        ends.push(y);
      }
      const end = Math.max(12, ...ends) + 1;
      for (const l of lanes) l.lane.style.gridRow = `1 / ${end}`;
    }
    if (refocus) (dom.querySelector(refocus) as HTMLElement | null)?.focus();
    body.classList.toggle('z-db-none', !res.rows.length && view.type !== 'calendar' && view.type !== 'timeline' && view.type !== 'board');
    body.dataset.empty = L('db.empty');
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (dom.isConnected) layout();
    });
  };
  dom.addEventListener('z-db-layout', schedule);
  let timer: any = 0;
  const offs = [
    editor.on('readonly', schedule),
    editor.on('db:open', (ev: any) => {
      // a row opened because the caret landed in it (find, undo, remote edit): reveal it now and
      // write the selection again once it is laid out
      const el = ev?.open ? (body.querySelector(`[data-zid="${ev.id}"]`) as HTMLElement | null) : null;
      if (el && !el.classList.contains('z-db-open')) {
        el.classList.add('z-db-open');
        void el.offsetHeight;
        if (ctx.view.hasFocus()) ctx.view.syncSelectionToDOM(true);
      }
      schedule();
    }),
    // relations, rollups and gallery previews depend on other blocks: refresh after any change
    editor.on('change', (ev) => {
      // the database itself changed (a row was added or removed, the schema edited): lay out now.
      // Changes elsewhere only matter for values computed from other blocks: a delayed pass is enough
      if (ev.tr.dirty.has(id)) return schedule();
      clearTimeout(timer);
      timer = setTimeout(schedule, 120);
    }),
  ];
  schedule();
  return {
    dom,
    childrenDOM: body,
    update: (b) => {
      id = b.id;
      schedule();
    },
    destroy: () => {
      clearTimeout(timer);
      offs.forEach((o) => o());
    },
  };
};

/* ------------------------------------------------------------------ pickers */

/** Popup editor for select / multi-select cells: search, pick, create. */
function optionPicker(editor: Editor, anchor: HTMLElement, rowId: string, dbId: string, prop: DbProperty, label: (k: string, f?: string) => string): void {
  const multi = prop.type === 'multi_select';
  const search = h('input', { class: 'z-input', type: 'text', placeholder: label('db.search'), 'aria-label': label('db.search') });
  const list = h('div', { class: 'z-db-options', role: 'listbox' });
  const current = (): string[] => {
    const row = editor.doc.get(rowId);
    const p = row ? dbProperties(row.parent!).find((x) => x.id === prop.id) : null;
    if (!row || !p) return [];
    const v = cellValue(row, p);
    return multi ? (v as string[]) : v ? [v as string] : [];
  };
  const choose = (optId: string) => {
    const cur = current();
    if (multi) editor.exec('dbSetCell', rowId, prop.id, cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId]);
    else {
      editor.exec('dbSetCell', rowId, prop.id, cur[0] === optId ? null : optId);
      pop.close();
      return;
    }
    render();
  };
  const render = () => {
    const db = editor.doc.get(dbId);
    const options = (db ? dbProperties(db).find((x) => x.id === prop.id)?.options : null) ?? [];
    const q = search.value.trim().toLowerCase();
    const cur = current();
    list.textContent = '';
    for (const o of options.filter((x) => !q || x.name.toLowerCase().includes(q))) {
      const item = h('button', { type: 'button', class: 'z-menu-item', role: 'option', 'aria-selected': String(cur.includes(o.id)), 'data-option': o.id }, chip(o), cur.includes(o.id) ? h('span', { class: 'z-db-tick', html: icon('check') }) : null);
      item.addEventListener('click', () => choose(o.id));
      list.append(item);
    }
    if (q && !options.some((o) => o.name.toLowerCase() === q)) {
      const create = h('button', { type: 'button', class: 'z-menu-item z-db-create' }, `${label('db.create')} "${search.value.trim()}"`);
      create.addEventListener('click', () => {
        if (editor.exec('dbAddOption', dbId, prop.id, search.value.trim())) {
          search.value = '';
          choose(editor.storage.db.lastOption);
        }
      });
      list.append(create);
    }
    if (cur.length) list.append(btn(label('db.clear'), () => (editor.exec('dbSetCell', rowId, prop.id, null), multi ? render() : pop.close()), 'z-menu-item'));
  };
  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (list.querySelector('.z-menu-item') as HTMLElement | null)?.click();
    }
  });
  const pop = popup(anchor, h('div', { class: 'z-db-menu' }, search, list), prop.name);
  render();
}

/** Popup for relation cells: search the rows of the related database and link / unlink them. */
function relationPicker(editor: Editor, anchor: HTMLElement, rowId: string, prop: DbProperty, label: (k: string, f?: string) => string): void {
  const search = h('input', { class: 'z-input', type: 'text', placeholder: label('db.searchRows', 'Search rows…'), 'aria-label': label('db.searchRows', 'Search rows…') });
  const list = h('div', { class: 'z-db-options', role: 'listbox' });
  const render = () => {
    const row = editor.doc.get(rowId);
    const target = prop.relation?.database ? editor.doc.get(prop.relation.database) : null;
    list.textContent = '';
    if (!row || !target || target.type !== 'database') {
      list.append(h('div', { class: 'z-db-hint' }, label('db.pickDatabase', 'Choose the related database in the property settings.')));
      return;
    }
    const tp = dbProperties(target).find((p) => p.type === 'title')!;
    const cur: string[] = Array.isArray(row.attrs.cells?.[prop.id]) ? row.attrs.cells[prop.id] : [];
    const q = search.value.trim().toLowerCase();
    const rows = dbRows(target).filter((r) => r.id !== rowId && (!q || cellText(r, tp).toLowerCase().includes(q)));
    for (const r of rows.slice(0, 50)) {
      const on = cur.includes(r.id);
      const item = h('button', { type: 'button', class: 'z-menu-item', role: 'option', 'aria-selected': String(on) }, h('span', { class: 'z-db-ic', html: icon('page') }), h('span', { class: 'z-menu-title' }, cellText(r, tp) || 'Untitled'), on ? h('span', { class: 'z-db-tick', html: icon('check') }) : null);
      item.addEventListener('click', () => {
        editor.exec('dbSetCell', rowId, prop.id, on ? cur.filter((x) => x !== r.id) : [...cur, r.id]);
        render();
      });
      list.append(item);
    }
    if (!rows.length) list.append(h('div', { class: 'z-db-hint' }, label('db.empty')));
  };
  search.addEventListener('input', render);
  popup(anchor, h('div', { class: 'z-db-menu' }, search, list), prop.name);
  render();
}

/* ------------------------------------------------------------------ row */

export const dbRow: NodeRenderer = (block, ctx) => {
  const { editor } = ctx;
  const L = (k: string, f?: string) => ctx.label(k, f);
  let row = block;
  let sig = '';
  const cover = h('div', { class: 'z-db-cover', contenteditable: 'false', 'data-z-ignore': '' });
  const cells = h('div', { class: 'z-db-cells', contenteditable: 'false', 'data-z-ignore': '' });
  const page = h('div', { class: 'z-db-page' });
  const dom = h('div', { class: 'z-block z-db-row' }, cover, cells, page);
  const isOpen = () => !!(editor.storage.db?.open as Set<string> | undefined)?.has(row.id);

  const buildCell = (p: DbProperty, db: Block, dctx: DbContext): HTMLElement => {
    const ro = editor.readOnly;
    const cell = h('div', { class: 'z-db-cell', 'data-prop': p.id, 'data-type': p.type, 'data-label': p.name });
    const value = cellValue(row, p, dctx);
    // cards hide empty properties until the row is opened
    if (p.type !== 'title' && (value == null || value === '' || value === false || (Array.isArray(value) && !value.length))) cell.setAttribute('data-empty', '');
    const set = (v: any) => void editor.exec('dbSetCell', row.id, p.id, v);
    const custom = dbTypeSpec(p.type);
    if (p.type === 'formula' || p.type === 'rollup') {
      const text = cellText(row, p, dctx);
      cell.append(h('span', { class: 'z-db-computed' + (text.startsWith('#ERR') ? ' z-db-error' : ''), title: text, 'aria-label': `${p.name}: ${text}` }, text));
    } else if (custom?.render) {
      cell.append(custom.render({ value, set, readOnly: ro, label: p.name }));
    } else if (p.type === 'checkbox') {
      const box = h('button', { type: 'button', class: 'z-check z-db-checkbox', role: 'checkbox', 'aria-checked': String(value === true), 'aria-label': p.name, disabled: ro });
      box.addEventListener('click', () => set(!(cellValue(row, p) === true)));
      cell.append(box);
    } else if (p.type === 'select' || p.type === 'multi_select') {
      const ids: string[] = p.type === 'select' ? (value ? [value] : []) : value;
      const b = h('button', { type: 'button', class: 'z-db-pick', 'aria-label': p.name, 'aria-haspopup': 'dialog', disabled: ro }, ...ids.map((oid) => chip(p.options!.find((o) => o.id === oid)!)));
      b.addEventListener('click', () => optionPicker(editor, b, row.id, db.id, p, L));
      cell.append(b);
    } else if (p.type === 'relation') {
      const b = h('button', { type: 'button', class: 'z-db-pick', 'aria-label': p.name, 'aria-haspopup': 'dialog', disabled: ro }, ...relatedRows(row, p, dctx).map((r) => h('span', { class: 'z-db-rel' }, h('span', { class: 'z-db-ic', html: icon('page') }), String(r.attrs.cells?.title ?? cellText(r, dbProperties(r.parent).find((x: DbProperty) => x.type === 'title')!) ?? '') || 'Untitled')));
      b.addEventListener('click', () => relationPicker(editor, b, row.id, p, L));
      cell.append(b);
    } else {
      const input = h('input', { class: 'z-db-input', type: p.type === 'date' ? 'date' : 'text', inputmode: p.type === 'number' ? 'decimal' : p.type === 'url' ? 'url' : p.type === 'email' ? 'email' : null, 'aria-label': p.name, placeholder: p.type === 'title' ? L('db.untitledRow', 'Untitled') : '', readonly: ro });
      input.value = value == null ? '' : String(value);
      const commit = () => {
        if (input.value !== String(cellValue(row, p) ?? '')) set(input.value);
      };
      const step = (dir: 1 | -1) => {
        const rows = visualRows(dom.parentElement);
        const next = rows[rows.indexOf(dom) + dir];
        ((next?.querySelector(`.z-db-cell[data-prop="${p.id}"] input`) as HTMLElement | null) ?? input).focus();
      };
      input.addEventListener('change', commit);
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          // Enter moves down the column, like a spreadsheet (in the order the view shows rows)
          step(1);
        } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.shiftKey && !e.altKey && input.type !== 'date') {
          e.preventDefault();
          commit();
          step(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Escape') {
          input.value = String(cellValue(row, p) ?? '');
          input.blur();
        }
      });
      cell.append(input);
      if (p.type === 'title') {
        // (toggleOpen shows the page before the caret moves into it: a caret placed in content
        // that has not been laid out is not usable in WebKit)
        const open = btn(L('db.open'), () => toggleOpen(), 'z-db-openbtn', 'db-open', L('db.open'));
        open.setAttribute('aria-expanded', String(isOpen()));
        cell.append(open);
      }
      if ((p.type === 'url' || p.type === 'email') && value) {
        const href = safeUrl(p.type === 'email' ? 'mailto:' + value : /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value);
        if (href) cell.append(h('a', { class: 'z-db-link', href, target: '_blank', rel: 'noopener noreferrer nofollow', 'aria-label': 'Open ' + value, html: icon('external') }));
      }
    }
    return cell;
  };

  const refresh = (props: DbProperty[], db: Block, dctx: DbContext, view: DbViewType) => {
    const open = isOpen();
    dom.classList.toggle('z-db-open', open);
    // gallery cover: the first image of the row's page, or the start of its text
    let coverSig = '';
    if (view === 'gallery') {
      const img = [...editor.doc.descendants(row)].find((b) => b.type === 'image' && safeUrl(b.attrs.src, { image: true }));
      coverSig = img ? 'i' + img.attrs.src : 't' + getText(editor, row.children ?? []).slice(0, 160);
    }
    const computed = props.filter((p) => p.type === 'formula' || p.type === 'rollup' || p.type === 'relation').map((p) => cellText(row, p, dctx));
    const next = JSON.stringify([props, row.attrs.cells, editor.readOnly, open, view === 'gallery', coverSig, computed]);
    if (next === sig) return;
    // never rebuild the control the user is typing in
    const active = document.activeElement as HTMLElement | null;
    const keep = active && cells.contains(active) && active.tagName === 'INPUT' ? active.closest('.z-db-cell')?.getAttribute('data-prop') : null;
    sig = next;
    cover.textContent = '';
    if (view === 'gallery') {
      if (coverSig[0] === 'i') cover.append(h('img', { src: coverSig.slice(1), alt: '', loading: 'lazy', draggable: 'false' }));
      else if (coverSig.length > 1) cover.append(h('span', { class: 'z-db-covertext' }, coverSig.slice(1)));
    }
    const old = new Map(Array.from(cells.children).map((c) => [(c as HTMLElement).dataset.prop, c]));
    cells.textContent = '';
    for (const p of props) cells.append(keep === p.id && old.get(p.id) ? old.get(p.id)! : buildCell(p, db, dctx));
    const actions = h('div', { class: 'z-db-cell z-db-actions' });
    if (!editor.readOnly) {
      const more = btn(L('db.rowActions', 'Row actions'), () => menu(more), 'z-db-rowbtn z-db-more', 'more');
      more.setAttribute('aria-haspopup', 'menu');
      actions.append(more);
    }
    cells.append(actions);
    if (keep) (cells.querySelector(`.z-db-cell[data-prop="${keep}"] input`) as HTMLElement | null)?.focus();
  };
  const toggleOpen = () => {
    const opening = !isOpen();
    if (opening) {
      dom.classList.add('z-db-open');
      void page.offsetHeight;
    }
    editor.exec('dbOpenRow', row.id, opening);
    if (opening) ctx.view.focus();
  };
  const menu = (at: HTMLElement | { x: number; y: number }) => {
    const db = row.parent;
    if (!db || editor.readOnly) return;
    const index = () => db.children!.findIndex((c) => c.id === row.id);
    const run = (fn: () => void) => () => {
      pop.close();
      fn();
    };
    const box = h(
      'div',
      { class: 'z-db-menu z-db-rowmenu' },
      menuItem(isOpen() ? L('db.close', 'Close') : L('db.open'), 'db-open', run(toggleOpen)),
      menuItem(L('db.insertAbove', 'Insert above'), 'up', run(() => void editor.exec('dbAddRow', db.id, {}, index()))),
      menuItem(L('db.insertBelow', 'Insert below'), 'down', run(() => void editor.exec('dbAddRow', db.id, {}, index() + 1))),
      menuItem(L('db.duplicateRow'), 'copy', run(() => void editor.exec('dbDuplicateRow', row.id))),
      h('div', { class: 'z-db-sep' }),
      menuItem(L('db.deleteRow'), 'trash', run(() => void editor.exec('dbDeleteRow', row.id))),
    );
    box.lastElementChild!.classList.add('z-danger');
    const anchor = at instanceof HTMLElement ? at : (cells.querySelector('.z-db-cell') as HTMLElement) ?? dom;
    const pop = popup(anchor, box, L('db.rowActions', 'Row actions'), 'menu');
    if (!(at instanceof HTMLElement)) place(pop.el, { left: at.x, top: at.y, bottom: at.y, right: at.x });
  };
  rowApi.set(dom, { refresh, menu });
  let host: Element | null = null;
  queueMicrotask(() => {
    host = dom.closest('.z-database');
    requestLayout(dom);
  });
  return {
    dom,
    childrenDOM: page,
    update: (b) => {
      row = b;
      host = dom.closest('.z-database');
      requestLayout(dom);
    },
    destroy: () => {
      (host ?? dom.closest('.z-database'))?.dispatchEvent(new CustomEvent('z-db-layout'));
      (editor.storage.db?.open as Set<string> | undefined)?.delete(row.id);
    },
  };
};
