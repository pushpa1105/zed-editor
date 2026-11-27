/**
 * Typeahead menus (slash commands, mentions, emoji, custom sources) and block handles
 * (insert, drag to reorder, block actions).
 */
import type { Editor } from '../core/editor';
import type { SlashItem, TypeaheadItem, TypeaheadSource } from '../core/extension';
import { isCollapsed, textSel, blockSel, topMost } from '../core/selection';
import { latestRunner, LatestRunner } from '../features/persist';
import { h, place } from '../view/dom';
import { icon } from './icons';
import { dismissable, roving } from './toolbar';

/* ------------------------------------------------------------------ typeahead */

export interface TypeaheadOptions {
  /** show the slash menu: only in block mode (default), in both modes, or never */
  slash?: 'block' | 'always' | false;
  icons?: Record<string, string>;
}

function slashSource(editor: Editor): TypeaheadSource {
  return {
    name: 'slash',
    trigger: '/',
    allowSpaces: true,
    emptyLabel: editor.label('slash.empty'),
    search: (q) => {
      const s = q.toLowerCase().trim();
      const items = editor.slashItems.filter((i) => !s || i.title.toLowerCase().includes(s) || i.id.includes(s) || (i.keywords ?? []).some((k) => k.includes(s)));
      // titles that start with the query rank first
      items.sort((a, b) => Number(b.title.toLowerCase().startsWith(s)) - Number(a.title.toLowerCase().startsWith(s)) || (a.order ?? 100) - (b.order ?? 100));
      return items.map((i) => ({ id: i.id, label: i.title, description: i.description, icon: i.icon, slash: i }));
    },
    select: (ed, item, range) => {
      ed.update((tr) => {
        tr.replaceText(range.id, range.from, range.to);
        tr.select(textSel(range.id, range.from));
      });
      ed.cutHistory();
      (item.slash as SlashItem).run(ed, { blockId: range.id });
      ed.focus();
    },
  };
}

interface Active {
  source: TypeaheadSource;
  id: string;
  from: number;
  to: number;
  query: string;
}

export function createTypeahead(editor: Editor, host: HTMLElement, opts: TypeaheadOptions = {}): { destroy(): void; isOpen(): boolean } {
  const menu = h('div', { class: 'z-menu z-typeahead', role: 'listbox', 'aria-label': editor.label('slash.label'), 'data-z-ignore': '', hidden: true });
  menu.id = 'z-ta-' + Math.random().toString(36).slice(2, 8);
  host.append(menu);
  const slash = slashSource(editor);
  let active: Active | null = null;
  let items: TypeaheadItem[] = [];
  let index = 0;
  let dismissedAt: string | null = null;
  const runners = new Map<TypeaheadSource, LatestRunner<TypeaheadItem[]>>();
  const runnerFor = (s: TypeaheadSource) => {
    let r = runners.get(s);
    if (!r) runners.set(s, (r = latestRunner((q, signal) => s.search(q, { signal, editor }), s.debounce ?? 0)));
    return r;
  };
  const sources = (): TypeaheadSource[] => {
    const list = [...editor.typeaheads];
    if (opts.slash !== false && (opts.slash === 'always' || editor.mode === 'block') && editor.slashItems.length) list.push(slash);
    return list;
  };

  /** the "/" came from the "+" button and nothing was typed after it: remove it again */
  const takeBackPlus = () => {
    const id = editor.storage.plusSlash as string | undefined;
    if (!id) return;
    editor.storage.plusSlash = undefined;
    const b = editor.doc.get(id);
    if (b && b.text === '/' && !editor.readOnly) editor.update((tr) => void tr.replaceText(id, 0, 1));
  };
  const close = () => {
    if (active) runners.get(active.source)?.cancel();
    active = null;
    items = [];
    menu.hidden = true;
    editor.view?.root.removeAttribute('aria-activedescendant');
    editor.view?.root.removeAttribute('aria-controls');
  };

  const render = (state: 'loading' | 'ready' | 'error') => {
    if (!active) return;
    menu.textContent = '';
    if (state !== 'ready' || !items.length) {
      menu.append(h('div', { class: 'z-menu-empty', role: 'status' }, state === 'loading' ? '…' : state === 'error' ? 'Error' : active.source.emptyLabel ?? editor.label('slash.empty')));
    } else {
      let group: string | undefined;
      items.forEach((it, i) => {
        const g = (it.slash as SlashItem | undefined)?.group;
        if (g && g !== group && active!.source === slash && !active!.query) {
          menu.append(h('div', { class: 'z-menu-group', role: 'presentation' }, g));
        }
        group = g;
        const custom = active!.source.renderItem?.(it);
        const row = h(
          'div',
          { class: 'z-menu-item', role: 'option', id: `${menu.id}-${i}`, 'aria-selected': String(i === index), 'data-index': String(i) },
          ...(custom
            ? [typeof custom === 'string' ? h('span', null, custom) : custom]
            : [it.icon ? h('span', { class: 'z-menu-icon', html: icon(it.icon, opts.icons) || undefined }) : null, h('span', { class: 'z-menu-text' }, h('span', { class: 'z-menu-title' }, it.label), it.description ? h('span', { class: 'z-menu-desc' }, it.description) : null)]),
        );
        menu.append(row);
      });
    }
    menu.hidden = false;
    const view = editor.view;
    const rect = view?.coordsAt({ id: active.id, offset: active.from });
    if (rect) place(menu, rect);
    view?.root.setAttribute('aria-controls', menu.id);
    if (items.length) view?.root.setAttribute('aria-activedescendant', `${menu.id}-${index}`);
    (menu.querySelector('[aria-selected="true"]') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  };

  const choose = (i: number) => {
    const a = active;
    const it = items[i];
    if (!a || !it) return;
    editor.storage.plusSlash = undefined;
    close();
    a.source.select(editor, it, { id: a.id, from: a.from, to: a.to });
  };

  const detect = (): Active | null => {
    const sel = editor.selection;
    if (!sel || sel.type !== 'text' || !isCollapsed(sel) || editor.readOnly) return null;
    const b = editor.doc.get(sel.focus.id);
    if (!b || editor.schema.node(b.type)?.code) return null;
    const offset = sel.focus.offset;
    const before = b.text.slice(Math.max(0, offset - 80), offset);
    const base = offset - before.length;
    let best: Active | null = null;
    for (const s of sources()) {
      const t = s.trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|[\\s(\\uFFFC])${t}(${s.allowSpaces ? '[^\\n' + t + ']{0,40}' : '[^\\s' + t + ']{0,40}'})$`);
      const m = re.exec(before);
      if (!m) continue;
      const from = base + m.index + (m[0].length - m[1].length - s.trigger.length);
      if (!best || from > best.from) best = { source: s, id: b.id, from, to: offset, query: m[1] };
    }
    return best;
  };

  const refresh = () => {
    if (!editor.view?.hasFocus() || editor.view.composing) {
      if (!editor.view?.composing) close();
      return;
    }
    const next = detect();
    const plus = editor.storage.plusSlash as string | undefined;
    if (plus && (!next || next.id !== plus)) {
      // the caret left the block (or more than the "/" is gone)
      if (editor.doc.get(plus)?.text === '/') {
        takeBackPlus();
        return;
      }
      editor.storage.plusSlash = undefined;
    } else if (plus && next && next.query) editor.storage.plusSlash = undefined; // the user is typing a query: it is their text now
    if (!next) {
      dismissedAt = null;
      close();
      return;
    }
    const key = next.source.name + ':' + next.id + ':' + next.from;
    if (dismissedAt === key) return;
    dismissedAt = null;
    const changed = !active || active.source !== next.source || active.query !== next.query || active.id !== next.id || active.from !== next.from;
    if (active && active.source !== next.source) runners.get(active.source)?.cancel();
    active = next;
    if (!changed) return;
    if (menu.hidden) render('loading');
    const mine = next;
    runnerFor(next.source)
      .run(next.query)
      .then((res) => {
        // a newer query (or a closed menu) makes this result stale
        if (res.stale || active !== mine) return;
        if (res.error) {
          items = [];
          render('error');
          return;
        }
        items = res.result ?? [];
        index = 0;
        // a slash query with no matches and a space is just text: get out of the way
        if (!items.length && mine.source === slash && /\s/.test(mine.query)) {
          dismissedAt = mine.source.name + ':' + mine.id + ':' + mine.from;
          close();
        } else render('ready');
      });
  };

  const onKey = (e: KeyboardEvent) => {
    if (!active || menu.hidden || e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dismissedAt = active.source.name + ':' + active.id + ':' + active.from;
      const fromPlus = editor.storage.plusSlash === active.id;
      close();
      if (fromPlus) takeBackPlus();
      return;
    }
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      index = (index + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      render('ready');
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      choose(index);
    }
  };
  const root = editor.view?.root;
  root?.addEventListener('keydown', onKey, true);
  // pointer and touch selection: pointerdown keeps focus in the editor
  menu.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const row = (e.target as HTMLElement).closest('.z-menu-item') as HTMLElement | null;
    if (row) choose(+row.dataset.index!);
  });
  const offs = [editor.on('update', refresh), editor.on('blur', () => setTimeout(() => !editor.view?.hasFocus() && close(), 150))];
  return {
    isOpen: () => !!active && !menu.hidden,
    destroy() {
      close();
      offs.forEach((o) => o());
      root?.removeEventListener('keydown', onKey, true);
      for (const r of runners.values()) r.cancel();
      menu.remove();
    },
  };
}

/* ------------------------------------------------------------------ block handles */

export interface BlockHandleOptions {
  icons?: Record<string, string>;
  /** called when a block link should be copied; default writes `location#id` to the clipboard */
  blockLink?: (id: string) => string;
}

const TURN_INTO: { label: string; type: string; attrs?: any }[] = [
  { label: 'block.paragraph', type: 'paragraph' },
  { label: 'block.h1', type: 'heading', attrs: { level: 1 } },
  { label: 'block.h2', type: 'heading', attrs: { level: 2 } },
  { label: 'block.h3', type: 'heading', attrs: { level: 3 } },
  { label: 'list.bullet', type: 'list', attrs: { kind: 'bullet' } },
  { label: 'list.ordered', type: 'list', attrs: { kind: 'ordered' } },
  { label: 'list.check', type: 'list', attrs: { kind: 'check', checked: false } },
  { label: 'block.quote', type: 'quote' },
  { label: 'block.code', type: 'code' },
];

/**
 * Insert button and drag grip next to the hovered block — or next to the block that holds
 * the selection, so the controls are reachable by keyboard and on touch screens.
 */
export function createBlockHandles(editor: Editor, host: HTMLElement, opts: BlockHandleOptions = {}): { destroy(): void } {
  const view = editor.view;
  const add = h('button', { type: 'button', class: 'z-handle-btn', 'aria-label': editor.label('handle.add'), title: editor.label('handle.add'), html: icon('plus', opts.icons) });
  const grip = h('button', { type: 'button', class: 'z-handle-btn z-grip', 'aria-label': editor.label('handle.drag'), title: editor.label('handle.drag'), 'aria-haspopup': 'menu', html: icon('grip', opts.icons), 'data-z-drag': '' });
  const box = h('div', { class: 'z-handles', 'data-z-ignore': '', hidden: true }, add, grip);
  const indicator = h('div', { class: 'z-drop-indicator', hidden: true });
  host.append(box, indicator);
  let current: string | null = null;
  let menu: HTMLElement | null = null;
  let closeMenu = () => {};
  let dragging = false;

  const enabled = () => editor.mode === 'block' && !editor.readOnly;
  const handleable = (id: string | null): string | null => {
    // rows, cells, columns and pages are structural: point at the nearest movable block
    let b = id ? editor.doc.get(id) : null;
    while (b && b !== editor.doc.root && ['table_row', 'table_cell', 'column', 'page', 'db_row'].includes(b.type)) b = b.parent;
    return b && b !== editor.doc.root ? b.id : null;
  };
  const position = () => {
    if (!enabled() || !current || !editor.doc.get(current)) {
      if (!menu) box.hidden = true;
      return;
    }
    const dom = view.domOf(current) as HTMLElement | null;
    if (!dom || dom.offsetParent === null) {
      box.hidden = true;
      return;
    }
    const r = dom.getBoundingClientRect();
    // align with the first visible line: a block's own text, or a database's title row. Hidden
    // descendants (a closed database row's page) have an empty rect at the viewport's origin
    let first: DOMRect | undefined;
    for (const el of Array.from(dom.querySelectorAll<HTMLElement>('.z-content, .z-db-headrow')).slice(0, 8)) {
      const rr = el.getBoundingClientRect();
      if (rr.height > 0 && rr.top >= r.top - 1) {
        first = rr;
        break;
      }
    }
    const lh = first ? Math.min(first.height, parseFloat(getComputedStyle(dom).lineHeight) || 24) : Math.min(r.height, 28);
    box.hidden = false;
    box.style.position = 'fixed';
    const w = box.offsetWidth || 48;
    box.style.left = Math.max(0, r.left - w - 4) + 'px';
    box.style.top = (first?.top ?? r.top) + Math.max(0, (lh - 24) / 2) + 'px';
  };
  const target = (id: string | null) => {
    if (dragging || menu) return;
    const next = handleable(id);
    if (next === current && !box.hidden) return;
    current = next;
    position();
  };
  const onMove = (e: MouseEvent) => {
    if (!enabled() || dragging) return;
    const t = e.target as HTMLElement;
    if (box.contains(t)) return;
    if (!view.root.contains(t)) return;
    let id = view.blockIdAt(t);
    if (!id) {
      // the pointer is in the editor's padding (on its way to the handle, or in the left
      // gutter): use the block on the same line instead of hiding the handle
      const x = view.root.getBoundingClientRect().left + (parseFloat(getComputedStyle(view.root).paddingLeft) || 0) + 12;
      const under = document.elementFromPoint(x, e.clientY);
      id = under && view.root.contains(under) ? view.blockIdAt(under) : null;
      if (!id) return; // keep the current handle
    }
    target(id);
  };
  let frame: any = 0;
  /** positioning reads layout: at most once per frame */
  const onSelection = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      followSelection();
    });
  };
  const followSelection = () => {
    if (!enabled()) {
      box.hidden = true;
      return;
    }
    // keyboard / touch: follow the selection
    const sel = editor.selection;
    const id = sel?.type === 'text' ? sel.focus.id : sel?.type === 'block' ? sel.ids[0] : sel?.type === 'cell' ? sel.table : null;
    if (id && view.hasFocus()) target(id);
    else position();
  };

  const idsFor = (id: string): string[] => {
    const sel = editor.selection;
    if (sel?.type === 'block' && sel.ids.includes(id)) return topMost(editor.doc, sel.ids).map((b) => b.id);
    return [id];
  };

  /* ---- insert */
  add.addEventListener('mousedown', (e) => e.preventDefault());
  add.addEventListener('click', () => {
    if (!current) return;
    const b = editor.doc.get(current);
    if (!b) return;
    const para = editor.schema.create('paragraph');
    // an empty paragraph is reused; otherwise a new one is added below
    const empty = b.type === 'paragraph' && b.length === 0 && !b.children;
    const host2 = editor.schema.canContain(b.parent!, 'paragraph') ? b : null;
    if (!host2) return;
    if (!empty) editor.update((tr) => void tr.insertAfter(b.id, [para]));
    const id = empty ? b.id : para.id;
    editor.setSelection(textSel(id, 0));
    editor.focus();
    editor.exec('insertText', '/', { rules: false });
    editor.storage.plusSlash = id;
  });

  /* ---- action menu */
  const openMenu = () => {
    if (!current || menu) return;
    const id = current;
    const ids = idsFor(id);
    const b = editor.doc.get(id)!;
    if (editor.selection?.type !== 'block' || !editor.selection.ids.includes(id)) editor.setSelection(blockSel([id]));
    const run = (fn: () => void) => () => {
      closeMenu();
      fn();
      editor.focus();
    };
    const item = (label: string, ic: string | undefined, fn: () => void, disabled = false) =>
      h('button', { type: 'button', class: 'z-menu-item', role: 'menuitem', disabled, onclick: run(fn) }, ic ? h('span', { class: 'z-menu-icon', html: icon(ic, opts.icons) || undefined }) : null, h('span', { class: 'z-menu-title' }, label));
    const rows: HTMLElement[] = [];
    for (const a of editor.blockActions) rows.push(item(editor.label(a.label), a.icon, () => a.run(editor, ids), a.enabled ? !a.enabled(editor, ids) : false));
    if (editor.schema.isText(b)) {
      rows.push(h('div', { class: 'z-menu-group', role: 'presentation' }, editor.label('action.turnInto')));
      for (const t of TURN_INTO) {
        if (!editor.schema.node(t.type)) continue;
        rows.push(item(editor.label(t.label), undefined, () => {
          editor.exec('setBlockType', t.type, t.attrs, ids.filter((i) => editor.schema.isText(editor.doc.get(i))));
        }));
      }
    }
    menu = h('div', { class: 'z-menu z-block-menu', role: 'menu', 'aria-label': editor.label('handle.drag'), 'data-z-ignore': '' }, ...rows);
    host.append(menu);
    place(menu, grip.getBoundingClientRect());
    roving(menu, '.z-menu-item', true);
    grip.setAttribute('aria-expanded', 'true');
    const off = dismissable(menu, () => {
      closeMenu();
      editor.focus();
    }, { ignore: grip });
    closeMenu = () => {
      off();
      menu?.remove();
      menu = null;
      grip.setAttribute('aria-expanded', 'false');
      closeMenu = () => {};
    };
    (menu.querySelector('.z-menu-item:not([disabled])') as HTMLElement | null)?.focus();
  };

  /* ---- drag to reorder (pointer events: mouse, pen and touch) */
  let drop: { id: string; place: 'before' | 'after' | 'inside' } | null = null;
  grip.addEventListener('mousedown', (e) => e.preventDefault());
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !current) return;
    const id = current;
    const ids = idsFor(id);
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    grip.setPointerCapture(e.pointerId);
    const blocks = ids.map((i) => editor.doc.get(i)!).filter(Boolean);
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return;
        started = true;
        dragging = true;
        for (const b of blocks) view.domOf(b.id)?.classList.add('z-dragging');
      }
      ev.preventDefault();
      // edge auto-scroll
      if (ev.clientY < 60) window.scrollBy(0, -12);
      else if (ev.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
      drop = null;
      const rootRect = view.root.getBoundingClientRect();
      const x = Math.min(Math.max(ev.clientX, rootRect.left + 4), rootRect.right - 4);
      const el = document.elementFromPoint(x, ev.clientY) as HTMLElement | null;
      let tid = el && view.root.contains(el) ? view.blockIdAt(el) : null;
      tid = handleable(tid);
      const tb = tid ? editor.doc.get(tid) : null;
      const tdom = tb ? (view.domOf(tb.id) as HTMLElement) : null;
      if (!tb || !tdom || blocks.some((b) => b === tb || editor.doc.isAncestor(b, tb))) {
        // invalid target: a block cannot be dropped on itself or inside its own descendants
        indicator.hidden = true;
        return;
      }
      const r = tdom.getBoundingClientRect();
      const content = (tdom.querySelector(':scope > .z-content') as HTMLElement | null)?.getBoundingClientRect() ?? r;
      let where: 'before' | 'after' | 'inside' = ev.clientY < content.top + content.height / 2 ? 'before' : 'after';
      const canNest = editor.schema.node(tb.type)?.children === true && blocks.every((b) => editor.schema.canContain(tb, b.type));
      if (where === 'after' && canNest && ev.clientX > content.left + 48) where = 'inside';
      if (where !== 'inside' && !blocks.every((b) => editor.schema.canContain(tb.parent!, b.type))) {
        indicator.hidden = true;
        return;
      }
      drop = { id: tb.id, place: where };
      indicator.hidden = false;
      indicator.style.position = 'fixed';
      indicator.style.left = (where === 'inside' ? content.left + 24 : r.left) + 'px';
      indicator.style.width = Math.max(24, r.right - (where === 'inside' ? content.left + 24 : r.left)) + 'px';
      indicator.style.top = (where === 'before' ? r.top - 2 : where === 'inside' ? content.bottom : r.bottom) + 'px';
    };
    const end = (ev: PointerEvent) => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      for (const b of blocks) view.domOf(b.id)?.classList.remove('z-dragging');
      indicator.hidden = true;
      dragging = false;
      if (!started) {
        if (ev.type === 'pointerup') openMenu();
        return;
      }
      if (drop && ev.type === 'pointerup') {
        editor.exec('moveBlocksTo', ids, drop.id, drop.place);
        editor.focus();
      }
      drop = null;
      position();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  });
  grip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu();
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && current) {
      e.preventDefault();
      editor.exec(e.key === 'ArrowUp' ? 'moveBlocksUp' : 'moveBlocksDown', idsFor(current));
      position();
    }
  });

  document.addEventListener('mousemove', onMove);
  window.addEventListener('scroll', position, true);
  window.addEventListener('resize', position);
  const offs = [
    editor.on('update', () => {
      if (current && !editor.doc.get(current)) current = null;
      onSelection();
    }),
    editor.on('mode', onSelection),
  ];
  return {
    destroy() {
      closeMenu();
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('mousemove', onMove);
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
      offs.forEach((o) => o());
      box.remove();
      indicator.remove();
    },
  };
}
