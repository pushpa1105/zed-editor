/**
 * Renderers for databases and the workspace blocks (table of contents, bookmark, template
 * button, page link, date). Controls inside the document are `contenteditable="false"` and
 * marked `data-z-ignore`, so the editor leaves their keyboard and input events alone.
 */
import { Block, InlineAtom } from '../core/model';
import { safeUrl } from '../core/schema';
import type { Editor } from '../core/editor';
import { DB_CALCS, DB_COLORS, DB_FILTER_OPS, DB_PROPERTY_TYPES, DB_VIEW_TYPES, DbFilter, DbOption, DbProperty, DbResult, cellText, cellValue, dbActiveView, dbProperties, dbViews, queryDatabase } from '../core/database';
import { formatDate, tocEntries } from '../core/notion';
import { textSel } from '../core/selection';
import { InlineRenderer, NodeRenderer, RenderContext } from './render';
import { h, place } from './dom';
import { icon } from '../ui/icons';

/* ------------------------------------------------------------------ small popup helper */

function popup(anchor: HTMLElement, content: HTMLElement, label: string): { el: HTMLElement; close: () => void } {
  const el = h('div', { class: 'z-popover z-db-pop', role: 'dialog', 'aria-label': label, 'data-z-ignore': '' }, content);
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
    }
  });
  setTimeout(() => {
    document.addEventListener('pointerdown', down, true);
    (el.querySelector('input, select, button') as HTMLElement | null)?.focus();
  });
  return { el, close };
}
const btn = (label: string, onclick: (e: MouseEvent) => void, cls = 'z-btn', iconName?: string): HTMLButtonElement => {
  const b = h('button', { type: 'button', class: cls, 'aria-label': label, title: label, html: iconName ? icon(iconName) : undefined }, iconName ? null : label);
  b.addEventListener('click', onclick);
  return b;
};
const select = (label: string, options: [string, string][], value: string, onchange: (v: string) => void): HTMLSelectElement => {
  const s = h('select', { class: 'z-input z-db-select', 'aria-label': label }, ...options.map(([v, t]) => h('option', { value: v }, t)));
  s.value = value;
  s.addEventListener('change', () => onchange(s.value));
  return s;
};
const chip = (o: DbOption) => h('span', { class: 'z-db-chip', 'data-color': o.color }, o.name);
const TYPE_LABEL: Record<string, string> = { title: 'Title', text: 'Text', number: 'Number', select: 'Select', multi_select: 'Multi-select', checkbox: 'Checkbox', date: 'Date', url: 'URL', email: 'Email', person: 'Person' };

/* ------------------------------------------------------------------ database */

interface RowApi {
  refresh(props: DbProperty[], db: Block): void;
}
const rowApi = new WeakMap<HTMLElement, RowApi>();
const requestLayout = (el: HTMLElement | null) => el?.closest('.z-database')?.dispatchEvent(new CustomEvent('z-db-layout'));

const database: NodeRenderer = (block, ctx) => {
  const { editor } = ctx;
  const L = (k: string) => ctx.label(k);
  let id = block.id;
  const get = () => editor.doc.get(id);
  const ro = () => editor.readOnly;

  const title = h('input', { class: 'z-db-title', type: 'text', 'aria-label': L('db.untitled'), placeholder: L('db.untitled') });
  const tabs = h('div', { class: 'z-db-tabs', role: 'tablist', 'aria-label': L('db.views') });
  const tools = h('div', { class: 'z-db-tools' });
  const count = h('span', { class: 'z-db-count', role: 'status' });
  const head = h('div', { class: 'z-db-head', contenteditable: 'false', 'data-z-ignore': '' }, h('div', { class: 'z-db-headrow' }, title, count), h('div', { class: 'z-db-headrow' }, tabs, tools));
  const cols = h('div', { class: 'z-db-cols', contenteditable: 'false', 'data-z-ignore': '' });
  const body = h('div', { class: 'z-db-body' });
  const foot = h('div', { class: 'z-db-foot', contenteditable: 'false', 'data-z-ignore': '' });
  const scroll = h('div', { class: 'z-db-scroll' }, cols, body, foot);
  const dom = h('div', { class: 'z-block z-database' }, head, scroll);

  title.addEventListener('change', () => editor.exec('dbSetTitle', id, title.value));
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') title.blur();
  });

  const propMenu = (anchor: HTMLElement, p: DbProperty, res: DbResult) => {
    const name = h('input', { class: 'z-input', type: 'text', value: p.name, 'aria-label': L('db.rename') });
    const commit = () => name.value.trim() && name.value !== p.name && editor.exec('dbUpdateProperty', id, p.id, { name: name.value.trim() });
    name.addEventListener('change', commit);
    const box = h('div', { class: 'z-db-menu' }, name);
    if (p.type !== 'title')
      box.append(
        h('label', { class: 'z-db-field' }, L('db.type'), select(L('db.type'), DB_PROPERTY_TYPES.filter((t) => t !== 'title').map((t) => [t, TYPE_LABEL[t]]), p.type, (t) => {
          pop.close();
          editor.exec('dbUpdateProperty', id, p.id, { type: t as any, options: undefined });
        })),
      );
    box.append(
      h('label', { class: 'z-db-field' }, L('db.calculate'), select(L('db.calculate'), [['', L('db.none')], ...DB_CALCS.map((c) => [c, c.replace('_', ' ')] as [string, string])], res.view.calc?.[p.id] ?? '', (c) => void editor.exec('dbCalculate', id, p.id, c || null))),
      btn(L('db.sortAsc'), () => (pop.close(), void editor.exec('dbSort', id, p.id, 'asc')), 'z-menu-item'),
      btn(L('db.sortDesc'), () => (pop.close(), void editor.exec('dbSort', id, p.id, 'desc')), 'z-menu-item'),
    );
    if (p.type !== 'title')
      box.append(
        btn(L('db.hideProperty'), () => (pop.close(), void editor.exec('dbToggleProperty', id, p.id)), 'z-menu-item'),
        btn(L('db.deleteProperty'), () => (pop.close(), void editor.exec('dbDeleteProperty', id, p.id)), 'z-menu-item'),
      );
    const pop = popup(anchor, box, p.name);
  };

  const filterPopup = (anchor: HTMLElement) => {
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
            btn('Remove filter', () => save(filters.filter((_, j) => j !== i)), 'z-btn', 'close'),
          ),
        );
      });
      box.append(btn('+ ' + L('db.filter'), () => save([...filters, { prop: props[0].id, op: 'contains', value: '' }]), 'z-menu-item'));
    };
    const box = h('div', { class: 'z-db-menu' });
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
        select(L('db.sort'), [['', L('db.none')], ...dbProperties(db).map((p) => [p.id, p.name] as [string, string])], prop, (v) => ((prop = v), apply())),
        select('Direction', [['asc', L('db.sortAsc')], ['desc', L('db.sortDesc')]], dir, (v) => ((dir = v as any), apply())),
      ),
      L('db.sort'),
    );
  };
  const groupPopup = (anchor: HTMLElement) => {
    const db = get()!;
    popup(anchor, h('div', { class: 'z-db-menu' }, select(L('db.group'), [['', L('db.none')], ...dbProperties(db).filter((p) => p.type === 'select').map((p) => [p.id, p.name] as [string, string])], dbActiveView(db).groupBy ?? '', (v) => void editor.exec('dbGroupBy', id, v || null))), L('db.group'));
  };
  const propsPopup = (anchor: HTMLElement) => {
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
        box.append(h('label', { class: 'z-db-field z-db-check' }, cb, p.name));
      }
      box.append(btn('+ ' + L('db.addProperty'), () => {
        editor.exec('dbAddProperty', id, { type: 'text' });
        render();
      }, 'z-menu-item'));
    };
    const box = h('div', { class: 'z-db-menu' });
    render();
    popup(anchor, box, L('db.properties'));
  };
  const viewMenu = (anchor: HTMLElement, viewId: string) => {
    const db = get()!;
    const v = dbViews(db).find((x) => x.id === viewId)!;
    const name = h('input', { class: 'z-input', type: 'text', value: v.name, 'aria-label': L('db.rename') });
    name.addEventListener('change', () => name.value.trim() && editor.exec('dbUpdateView', id, viewId, { name: name.value.trim() }));
    const pop = popup(
      anchor,
      h(
        'div',
        { class: 'z-db-menu' },
        name,
        h('label', { class: 'z-db-field' }, L('db.type'), select(L('db.type'), DB_VIEW_TYPES.map((t) => [t, t[0].toUpperCase() + t.slice(1)]), v.type, (t) => void editor.exec('dbUpdateView', id, viewId, { type: t as any }))),
        btn(L('db.deleteView'), () => (pop.close(), void editor.exec('dbDeleteView', id, viewId)), 'z-menu-item'),
      ),
      v.name,
    );
  };

  let dragging: { row: string; el: HTMLElement } | null = null;
  /** board: drop a card on a column to change its group value */
  body.addEventListener('pointerdown', (e) => {
    const card = (e.target as HTMLElement).closest('.z-db-row') as HTMLElement | null;
    if (!card || dom.dataset.view !== 'board' || ro() || (e.target as HTMLElement).closest('input, button, select, .z-db-page')) return;
    dragging = { row: card.dataset.zid!, el: card };
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
      moved = true;
      card.classList.add('z-dragging');
      card.style.transform = `translate(${ev.clientX - startX}px, ${ev.clientY - startY}px)`;
    };
    const up = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      card.classList.remove('z-dragging');
      card.style.transform = '';
      const d = dragging;
      dragging = null;
      if (!moved || !d) return;
      const headers = Array.from(cols.querySelectorAll<HTMLElement>('.z-db-colhead'));
      const hit = headers.find((hd) => {
        const r = hd.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right;
      });
      const db = get();
      if (!hit || !db) return;
      const res = queryDatabase(db);
      if (res.groupBy) editor.exec('dbSetCell', d.row, res.groupBy.id, hit.dataset.option || null);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  const layout = () => {
    const db = get();
    if (!db || db.type !== 'database') return;
    const res = queryDatabase(db);
    const { view, visible } = res;
    dom.dataset.view = view.type;
    dom.classList.toggle('z-db-readonly', ro());
    if (document.activeElement !== title) title.value = db.attrs.title ?? '';
    title.readOnly = ro();
    count.textContent = res.rows.length === res.total ? String(res.total) : L('db.count').replace('{n}', String(res.rows.length)).replace('{total}', String(res.total));

    // view tabs
    tabs.textContent = '';
    for (const v of dbViews(db)) {
      const selected = v.id === view.id;
      const tab = h('button', { type: 'button', class: 'z-db-tab', role: 'tab', 'aria-selected': String(selected), 'data-view': v.id, tabindex: selected ? '0' : '-1' }, v.name);
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
    if (!ro()) {
      const add = h('select', { class: 'z-db-addview', 'aria-label': L('db.addView'), title: L('db.addView') }, h('option', { value: '' }, '+'), ...DB_VIEW_TYPES.map((t) => h('option', { value: t }, t[0].toUpperCase() + t.slice(1))));
      add.addEventListener('change', () => add.value && editor.exec('dbAddView', id, add.value));
      tabs.append(add);
    }
    tools.textContent = '';
    if (!ro()) {
      const mark = (b: HTMLButtonElement, on: boolean) => (b.setAttribute('aria-pressed', String(on)), b);
      tools.append(
        mark(btn(L('db.filter'), (e) => filterPopup(e.currentTarget as HTMLElement), 'z-btn z-db-tool'), !!view.filters?.length),
        mark(btn(L('db.sort'), (e) => sortPopup(e.currentTarget as HTMLElement), 'z-btn z-db-tool'), !!view.sorts?.length),
        mark(btn(L('db.group'), (e) => groupPopup(e.currentTarget as HTMLElement), 'z-btn z-db-tool'), !!view.groupBy),
        btn(L('db.properties'), (e) => propsPopup(e.currentTarget as HTMLElement), 'z-btn z-db-tool'),
      );
    }

    // column template shared by header, rows and footer (table view)
    // fixed tracks: header, every row and the footer are separate grids and must line up exactly
    const template = visible.map((p) => (p.width ?? (p.type === 'title' ? 280 : p.type === 'checkbox' ? 96 : p.type === 'number' ? 110 : 170)) + 'px').join(' ') + ' 40px';
    dom.style.setProperty('--z-db-template', template);

    cols.textContent = '';
    const groups = view.type === 'board' ? res.groups : null;
    if (view.type === 'table') {
      for (const p of visible) {
        const hd = h('button', { type: 'button', class: 'z-db-colhead', 'data-prop': p.id, 'aria-label': p.name, disabled: ro() }, h('span', { class: 'z-db-coltype' }, TYPE_LABEL[p.type][0]), p.name, view.sorts?.[0]?.prop === p.id ? (view.sorts[0].dir === 'asc' ? ' ↑' : ' ↓') : '');
        hd.addEventListener('click', () => propMenu(hd, p, res));
        cols.append(hd);
      }
      if (!ro()) cols.append(btn(L('db.addProperty'), () => void editor.exec('dbAddProperty', id, { type: 'text' }), 'z-db-colhead z-db-addprop', 'plus'));
      else cols.append(h('span'));
    } else if (groups) {
      dom.style.setProperty('--z-db-board', `repeat(${groups.length}, minmax(220px, 1fr))`);
      for (const g of groups) cols.append(h('div', { class: 'z-db-colhead z-db-group', 'data-option': g.option?.id ?? '' }, g.option ? chip(g.option) : h('span', { class: 'z-muted' }, L('db.noValue')), h('span', { class: 'z-db-groupcount' }, String(g.rows.length))));
    }

    // rows: order, visibility and board column — the reconciler keeps document order in the DOM
    const order = new Map(res.rows.map((r, i) => [r.id, i]));
    const column = new Map<string, number>();
    if (groups) groups.forEach((g, gi) => g.rows.forEach((r) => column.set(r.id, gi + 1)));
    for (const el of Array.from(body.children) as HTMLElement[]) {
      const rid = el.dataset.zid;
      if (!rid) continue;
      const i = order.get(rid);
      el.hidden = i === undefined;
      el.style.order = String(i ?? 0);
      const open = el.classList.contains('z-db-open');
      el.style.gridColumn = open && view.type !== 'table' && view.type !== 'list' ? '1 / -1' : groups ? String(column.get(rid) ?? 1) : '';
      rowApi.get(el)?.refresh(visible, db);
    }
    body.classList.toggle('z-db-none', !res.rows.length);
    body.dataset.empty = L('db.empty');

    foot.textContent = '';
    if (!ro()) {
      const add = btn('+ ' + L('db.newRow'), () => {
        const cells: Record<string, any> = {};
        // a new row satisfies simple "is" filters so it does not vanish immediately
        for (const f of view.filters ?? []) {
          const p = res.properties.find((x) => x.id === f.prop);
          if (p && f.op === 'is' && p.type === 'select') cells[p.id] = p.options?.find((o) => o.name.toLowerCase() === (f.value ?? '').toLowerCase())?.id;
        }
        if (editor.exec('dbAddRow', id, cells)) {
          const rid = editor.storage.db?.lastRow;
          requestAnimationFrame(() => (body.querySelector(`[data-zid="${rid}"] .z-db-cell[data-type="title"] input`) as HTMLElement | null)?.focus());
        }
      }, 'z-db-new');
      foot.append(add);
    }
    if (view.type === 'table' && Object.keys(res.calc).length) foot.append(h('div', { class: 'z-db-calc' }, ...visible.map((p) => h('span', { class: 'z-db-calccell', 'data-prop': p.id }, res.calc[p.id] !== undefined ? `${view.calc![p.id].replace('_', ' ')} ${res.calc[p.id]}` : '')), h('span')));
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
  ];
  schedule();
  return {
    dom,
    childrenDOM: body,
    update: (b) => {
      id = b.id;
      schedule();
    },
    destroy: () => offs.forEach((o) => o()),
  };
};

/** Popup editor for select / multi-select cells: search, pick, create. */
function optionPicker(editor: Editor, anchor: HTMLElement, rowId: string, dbId: string, prop: DbProperty, label: (k: string) => string): void {
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

const dbRow: NodeRenderer = (block, ctx) => {
  const { editor } = ctx;
  const L = (k: string) => ctx.label(k);
  let row = block;
  let sig = '';
  const cells = h('div', { class: 'z-db-cells', contenteditable: 'false', 'data-z-ignore': '' });
  const page = h('div', { class: 'z-db-page' });
  const dom = h('div', { class: 'z-block z-db-row' }, cells, page);
  const isOpen = () => !!(editor.storage.db?.open as Set<string> | undefined)?.has(row.id);

  const buildCell = (p: DbProperty, db: Block): HTMLElement => {
    const ro = editor.readOnly;
    const cell = h('div', { class: 'z-db-cell', 'data-prop': p.id, 'data-type': p.type, 'data-label': p.name });
    const value = cellValue(row, p);
    // cards hide empty properties until the row is opened
    if (p.type !== 'title' && (value == null || value === '' || value === false || (Array.isArray(value) && !value.length))) cell.setAttribute('data-empty', '');
    const set = (v: any) => void editor.exec('dbSetCell', row.id, p.id, v);
    if (p.type === 'checkbox') {
      const box = h('button', { type: 'button', class: 'z-check z-db-checkbox', role: 'checkbox', 'aria-checked': String(value === true), 'aria-label': p.name, disabled: ro });
      box.addEventListener('click', () => set(!(cellValue(row, p) === true)));
      cell.append(box);
    } else if (p.type === 'select' || p.type === 'multi_select') {
      const ids: string[] = p.type === 'select' ? (value ? [value] : []) : value;
      const b = h('button', { type: 'button', class: 'z-db-pick', 'aria-label': p.name, 'aria-haspopup': 'dialog', disabled: ro }, ...ids.map((oid) => chip(p.options!.find((o) => o.id === oid)!)));
      b.addEventListener('click', () => optionPicker(editor, b, row.id, db.id, p, L));
      cell.append(b);
    } else {
      const input = h('input', { class: 'z-db-input', type: p.type === 'date' ? 'date' : 'text', inputmode: p.type === 'number' ? 'decimal' : p.type === 'url' ? 'url' : p.type === 'email' ? 'email' : null, 'aria-label': p.name, placeholder: p.type === 'title' ? 'Untitled' : '', readonly: ro });
      input.value = value == null ? '' : String(value);
      const commit = () => {
        if (input.value !== String(cellValue(row, p) ?? '')) set(input.value);
      };
      input.addEventListener('change', commit);
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          // Enter moves down the column, like a spreadsheet
          let next = dom.nextElementSibling as HTMLElement | null;
          while (next && next.hidden) next = next.nextElementSibling as HTMLElement | null;
          ((next?.querySelector(`.z-db-cell[data-prop="${p.id}"] input`) as HTMLElement | null) ?? input).focus();
        } else if (e.key === 'Escape') {
          input.value = String(cellValue(row, p) ?? '');
          input.blur();
        }
      });
      cell.append(input);
      if (p.type === 'title') {
        const open = btn(L('db.open'), () => {
          const opening = !isOpen();
          if (opening) {
            // show the page before the caret moves into it: a caret placed in content that has
            // not been laid out is not usable in WebKit
            dom.classList.add('z-db-open');
            void page.offsetHeight;
          }
          editor.exec('dbOpenRow', row.id, opening);
          if (opening) ctx.view.focus();
        }, 'z-db-openbtn');
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

  const refresh = (props: DbProperty[], db: Block) => {
    const open = isOpen();
    dom.classList.toggle('z-db-open', open);
    const next = JSON.stringify([props, row.attrs.cells, editor.readOnly, open]);
    if (next === sig) return;
    // never rebuild the control the user is typing in
    const active = document.activeElement as HTMLElement | null;
    const keep = active && cells.contains(active) && active.tagName === 'INPUT' ? active.closest('.z-db-cell')?.getAttribute('data-prop') : null;
    sig = next;
    const old = new Map(Array.from(cells.children).map((c) => [(c as HTMLElement).dataset.prop, c]));
    cells.textContent = '';
    for (const p of props) cells.append(keep === p.id && old.get(p.id) ? old.get(p.id)! : buildCell(p, db));
    if (!editor.readOnly) {
      const more = btn(L('db.deleteRow'), () => void editor.exec('dbDeleteRow', row.id), 'z-db-rowbtn', 'trash');
      cells.append(h('div', { class: 'z-db-cell z-db-actions' }, more));
    } else cells.append(h('div', { class: 'z-db-cell z-db-actions' }));
    if (keep) (cells.querySelector(`.z-db-cell[data-prop="${keep}"] input`) as HTMLElement | null)?.focus();
  };
  rowApi.set(dom, { refresh });
  queueMicrotask(() => requestLayout(dom));
  let host: Element | null = null;
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

/* ------------------------------------------------------------------ workspace blocks */

function reveal(ctx: RenderContext, id: string): void {
  const { editor, view } = ctx;
  const b = editor.doc.get(id);
  if (!b) return;
  const page = b.type === 'page' ? b : editor.doc.closest(b, (x) => x.type === 'page');
  if (page) editor.exec('setActivePage', page.id);
  if (editor.schema.isText(b)) editor.setSelection(textSel(b.id, 0));
  const el = view.domOf(id) as HTMLElement | null;
  el?.scrollIntoView({ block: 'center' });
  el?.classList.add('z-flash');
  setTimeout(() => el?.classList.remove('z-flash'), 1600);
  view.focus();
}

const toc: NodeRenderer = (block, ctx) => {
  const list = h('ul', { class: 'z-toc-list' });
  const dom = h('nav', { class: 'z-block z-toc', contenteditable: 'false', 'aria-label': ctx.label('toc.title') }, list);
  let last = '';
  const render = () => {
    const entries = tocEntries(ctx.editor, block.id);
    const sig = JSON.stringify(entries);
    if (sig === last) return;
    last = sig;
    list.textContent = '';
    if (!entries.length) list.append(h('li', { class: 'z-muted' }, ctx.label('toc.empty')));
    const min = Math.min(...entries.map((e) => e.level), 6);
    for (const e of entries) {
      const a = h('a', { href: '#' + e.id, 'data-z-ignore': '', 'data-target': e.id }, e.text || '…');
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        reveal(ctx, e.id);
      });
      const li = h('li', { class: 'z-toc-item' }, a);
      li.style.paddingLeft = (e.level - min) * 16 + 'px';
      list.append(li);
    }
  };
  let timer: any = 0;
  const off = ctx.editor.on('change', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 150);
  });
  render();
  return {
    dom,
    destroy: () => {
      clearTimeout(timer);
      off();
    },
  };
};

const bookmark: NodeRenderer = (block, ctx) => {
  const dom = h('div', { class: 'z-block z-bookmark', contenteditable: 'false' });
  const sync = (b: Block) => {
    const a = b.attrs;
    const url = safeUrl(a.url);
    dom.textContent = '';
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      host = url;
    }
    const img = /^https?:\/\//i.test(safeUrl(a.image)) ? h('img', { class: 'z-bookmark-img', src: a.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null;
    dom.append(
      h(
        'a',
        { class: 'z-bookmark-card', href: url || '#', target: '_blank', rel: 'noopener noreferrer nofollow', 'data-z-ignore': '' },
        h('span', { class: 'z-bookmark-text' }, h('span', { class: 'z-bookmark-title' }, a.title || url), a.description ? h('span', { class: 'z-bookmark-desc' }, a.description) : null, h('span', { class: 'z-bookmark-host' }, a.site || host)),
        img,
      ),
    );
  };
  sync(block);
  return { dom, update: sync };
};

const templateButton: NodeRenderer = (block, ctx) => {
  const label = h('span');
  const use = h('button', { type: 'button', class: 'z-btn z-template-btn', 'data-z-ignore': '', html: icon('plus') }, label);
  const dom = h('div', { class: 'z-block z-template', contenteditable: 'false' }, use);
  let id = block.id;
  use.addEventListener('click', () => {
    ctx.editor.exec('useTemplate', id);
    ctx.view.focus();
  });
  use.addEventListener('dblclick', () => {
    if (ctx.editor.readOnly) return;
    const next = prompt(ctx.label('template.rename'), label.textContent ?? '');
    if (next) ctx.editor.exec('setBlockAttrs', id, { label: next });
  });
  const sync = (b: Block) => {
    id = b.id;
    label.textContent = b.attrs.label ?? '';
    use.setAttribute('aria-label', `${ctx.label('template.use')}: ${b.attrs.label ?? ''}`);
    use.disabled = ctx.editor.readOnly;
  };
  sync(block);
  return { dom, update: sync };
};

const pageLink: InlineRenderer = (atom: InlineAtom, ctx) => {
  const page = ctx.editor.doc.get(atom.attrs?.page ?? '');
  const el = h('a', { class: 'z-page-link', href: '#' + (atom.attrs?.page ?? ''), 'data-page-link': atom.attrs?.page, html: icon('page') });
  // the live title wins over the one stored when the link was created
  el.append(page && page.type === 'page' ? page.attrs.title || 'Untitled' : atom.attrs?.title || ctx.label('pagelink.missing'));
  if (!page) el.classList.add('z-missing');
  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (page) ctx.editor.exec('setActivePage', page.id);
  });
  return el;
};

const dateChip: InlineRenderer = (atom: InlineAtom, ctx) => {
  const iso = atom.attrs?.date ?? '';
  const el = h('time', { class: 'z-date', datetime: iso, role: 'button', tabindex: '-1', title: iso, 'aria-label': `${ctx.label('date.change')}: ${iso}` }, '@' + formatDate(iso));
  el.addEventListener('click', (e) => {
    if (ctx.editor.readOnly) return;
    e.preventDefault();
    const blockEl = el.closest('[data-zid]') as HTMLElement | null;
    const id = blockEl?.dataset.zid;
    const b = id ? ctx.editor.doc.get(id) : null;
    if (!b || !b.content) return;
    // locate this atom in the block by walking the rendered atoms
    const atoms = Array.from(blockEl!.querySelectorAll(':scope > .z-content [data-atom]'));
    const nth = atoms.indexOf(el);
    let seen = -1;
    let offset = -1;
    let pos = 0;
    for (const c of b.content) {
      if ('atom' in c) {
        seen++;
        if (seen === nth) offset = pos;
      }
      pos += 'atom' in c ? 1 : c.text.length;
    }
    if (offset < 0) return;
    const input = h('input', { type: 'date', class: 'z-input', value: iso, 'aria-label': ctx.label('date.change') });
    const pop = popup(el, h('div', { class: 'z-db-menu' }, input), ctx.label('date.change'));
    const commit = () => {
      const cur = ctx.editor.doc.get(id!)?.content;
      let p2 = 0;
      const at = cur?.find((c) => {
        const hit = p2 === offset;
        p2 += 'atom' in c ? 1 : c.text.length;
        return hit;
      }) as InlineAtom | undefined;
      if (/^\d{4}-\d{2}-\d{2}$/.test(input.value) && at?.atom === 'date' && at.attrs?.date !== input.value)
        ctx.editor.update((tr) => void tr.replaceText(id!, offset, offset + 1, [{ ...at, attrs: { date: input.value } }]));
    };
    // engines differ in when a date input fires `change`: commit on change, Enter and blur
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commit();
        pop.close();
        ctx.view.focus();
      }
    });
  });
  return el;
};

export const notionNodeRenderers: Record<string, NodeRenderer> = { database, db_row: dbRow, toc, bookmark, template_button: templateButton };
export const notionInlineRenderers: Record<string, InlineRenderer> = { page_link: pageLink, date: dateChip };
void DB_COLORS;
void cellText;
