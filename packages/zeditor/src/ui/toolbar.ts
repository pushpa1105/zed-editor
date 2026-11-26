/**
 * Default toolbar, floating selection toolbar, color palette and link popover.
 * All controls are plain DOM with ARIA roles; nothing here is required by the engine.
 */
import type { Editor } from '../core/editor';
import type { ToolbarItem } from '../core/extension';
import { isCollapsed } from '../core/selection';
import { markRangeAt, markValue } from '../core/commands';
import { safeUrl } from '../core/schema';
import { h, formatShortcut, place } from '../view/dom';
import { icon } from './icons';

export interface ToolbarOptions {
  /** item ids to show, in order ('|' inserts a separator). Default: all registered items. */
  items?: string[];
  /** only items flagged `floating` */
  floating?: boolean;
  icons?: Record<string, string>;
  label?: string;
  /** show the "Insert" menu built from the slash-menu items (default true) */
  insert?: boolean;
}
export interface UIHandle {
  dom: HTMLElement;
  update(): void;
  destroy(): void;
}

export const PALETTE = ['#111827', '#6b7280', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777'];
export const HIGHLIGHTS = ['#fef08a', '#fed7aa', '#fecaca', '#bbf7d0', '#bae6fd', '#ddd6fe', '#fbcfe8', '#e5e7eb'];

/** Close a popup on outside press or Escape. Returns a disposer. */
export function dismissable(el: HTMLElement, close: () => void, opts: { ignore?: HTMLElement | null } = {}): () => void {
  const down = (e: Event) => {
    const t = e.target as Node;
    if (el.contains(t) || opts.ignore?.contains(t)) return;
    close();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('pointerdown', down, true);
  el.addEventListener('keydown', key);
  return () => {
    document.removeEventListener('pointerdown', down, true);
    el.removeEventListener('keydown', key);
  };
}

/** Arrow-key navigation between the focusable children of a toolbar / menu (roving tabindex). */
export function roving(container: HTMLElement, selector: string, vertical = false): void {
  const items = () => Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
  const setActive = (el: HTMLElement) => {
    for (const i of container.querySelectorAll<HTMLElement>(selector)) i.tabIndex = i === el ? 0 : -1;
  };
  container.addEventListener('focusin', (e) => {
    const t = (e.target as HTMLElement).closest?.(selector) as HTMLElement | null;
    if (t && container.contains(t)) setActive(t);
  });
  container.addEventListener('keydown', (e) => {
    const list = items();
    const cur = list.indexOf(document.activeElement as HTMLElement);
    if (cur < 0) return;
    const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    // let native controls keep their own arrow keys
    if ((document.activeElement as HTMLElement).tagName === 'SELECT' && vertical === false && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
    if ((document.activeElement as HTMLElement).tagName === 'INPUT' && (e.key === prev || e.key === next)) return;
    let to = -1;
    if (e.key === next) to = (cur + 1) % list.length;
    else if (e.key === prev) to = (cur - 1 + list.length) % list.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = list.length - 1;
    if (to >= 0) {
      e.preventDefault();
      setActive(list[to]);
      list[to].focus();
    }
  });
  const first = container.querySelector<HTMLElement>(selector);
  for (const i of container.querySelectorAll<HTMLElement>(selector)) i.tabIndex = i === first ? 0 : -1;
}

function colorPopover(editor: Editor, anchor: HTMLElement, item: ToolbarItem, onDone: () => void): void {
  const colors = item.id === 'highlight' ? HIGHLIGHTS : PALETTE;
  const current = item.value?.(editor) ?? '';
  const pick = (c: string) => {
    close();
    item.run?.(editor, c);
    editor.focus();
  };
  const grid = h(
    'div',
    { class: 'z-swatches', role: 'group', 'aria-label': editor.label(item.label) },
    h('button', { type: 'button', class: 'z-swatch z-swatch-none', 'aria-label': editor.label('color.none'), title: editor.label('color.none'), onclick: () => pick('') }, '⦸'),
    ...colors.map((c) => {
      const b = h('button', { type: 'button', class: 'z-swatch', 'aria-label': c, title: c, 'aria-pressed': String(c.toLowerCase() === String(current).toLowerCase()), onclick: () => pick(c) });
      b.style.backgroundColor = c;
      return b;
    }),
  );
  const pop = h('div', { class: 'z-popover z-color-pop', role: 'dialog', 'aria-label': editor.label(item.label), 'data-z-ignore': '' }, grid);
  pop.addEventListener('mousedown', (e) => e.preventDefault());
  const host = anchor.closest('.zeditor') ?? document.body;
  host.append(pop);
  place(pop, anchor.getBoundingClientRect());
  roving(grid, 'button');
  let off = () => {};
  const close = () => {
    off();
    pop.remove();
    onDone();
  };
  off = dismissable(pop, () => {
    close();
    anchor.focus();
  }, { ignore: anchor });
  ((grid.querySelector('[aria-pressed="true"]') ?? grid.querySelector('button')) as HTMLElement | null)?.focus();
}

export function createToolbar(editor: Editor, opts: ToolbarOptions = {}): UIHandle {
  const dom = h('div', { class: 'z-toolbar' + (opts.floating ? ' z-floating-toolbar' : ''), role: 'toolbar', 'aria-label': opts.label ?? editor.label(opts.floating ? 'floating.toolbar' : 'toolbar'), 'aria-orientation': 'horizontal', 'data-z-ignore': '' });
  const all = editor.toolbarItems.filter((i) => !opts.floating || i.floating);
  const byId = new Map(all.map((i) => [i.id, i]));
  const list: (ToolbarItem | '|')[] = [];
  if (opts.items) for (const id of opts.items) {
    if (id === '|') list.push('|');
    else if (id === 'insert' && !opts.floating) list.push('insert' as any);
    else if (byId.has(id)) list.push(byId.get(id)!);
  }
  else {
    let group: string | undefined;
    for (const it of all) {
      if (list.length && it.group !== group && !opts.floating) list.push('|');
      group = it.group;
      list.push(it);
    }
  }
  const updaters: (() => void)[] = [];
  const text = (key: string) => editor.label(key);
  let insertSlot: HTMLElement | null = null;
  for (const it of list) {
    if (it === '|') {
      dom.append(h('span', { class: 'z-sep', role: 'separator', 'aria-orientation': 'vertical' }));
      continue;
    }
    if ((it as any) === 'insert') {
      dom.append((insertSlot = h('span', { hidden: true })));
      continue;
    }
    const label = text(it.label);
    const title = it.shortcut ? `${label} (${formatShortcut(it.shortcut)})` : label;
    if (it.type === 'custom' && it.render) {
      dom.append(it.render(editor));
      continue;
    }
    if (it.type === 'select') {
      const sel = h('select', { class: 'z-tool z-select', 'aria-label': label, title, 'data-id': it.id }, ...(it.options ?? []).map((o) => h('option', { value: o.value }, text(o.label))));
      sel.addEventListener('change', () => {
        it.run?.(editor, sel.value);
        editor.focus();
      });
      updaters.push(() => {
        const v = it.value?.(editor) ?? '';
        if (![...sel.options].some((o) => o.value === v)) {
          // current block type is not in the list (e.g. list item): show it as a disabled entry
          let extra = sel.querySelector<HTMLOptionElement>('option[data-extra]');
          if (!extra) sel.append((extra = h('option', { 'data-extra': '', disabled: true })));
          extra.value = v;
          // no label for this type (table, image, database…): show its name readably
          extra.textContent = text('block.' + v) === 'block.' + v ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ') : text('block.' + v);
        }
        if (sel.value !== v) sel.value = v;
        sel.disabled = editor.readOnly;
      });
      dom.append(sel);
      continue;
    }
    const btn = h('button', { type: 'button', class: 'z-tool', 'aria-label': label, title, 'data-id': it.id, html: icon(it.icon, opts.icons) || undefined });
    if (!btn.firstChild) btn.textContent = label;
    // keep the editor selection when pressing a control with a pointer
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    if (it.type === 'color') {
      const bar = h('span', { class: 'z-color-bar' });
      btn.append(bar);
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => {
        if (btn.getAttribute('aria-expanded') === 'true') return;
        btn.setAttribute('aria-expanded', 'true');
        colorPopover(editor, btn, it, () => btn.setAttribute('aria-expanded', 'false'));
      });
      updaters.push(() => {
        bar.style.backgroundColor = it.value?.(editor) || 'transparent';
        btn.disabled = editor.readOnly;
      });
    } else {
      btn.addEventListener('click', () => {
        if (it.run) it.run(editor);
        else if (it.command) editor.exec(it.command, ...(it.args ?? []));
        if (!document.activeElement || document.activeElement === btn || document.activeElement === document.body) editor.focus();
      });
      updaters.push(() => {
        if (it.active) btn.setAttribute('aria-pressed', String(!!it.active(editor)));
        btn.disabled = editor.readOnly || (it.enabled ? !it.enabled(editor) : false);
      });
    }
    dom.append(btn);
  }
  // "Insert": every slash-menu item is also reachable from the toolbar (useful in classic mode)
  if (!opts.floating && editor.slashItems.length && (opts.items ? opts.items.includes('insert') : opts.insert !== false)) {
    const ins = h('button', { type: 'button', class: 'z-tool z-tool-insert', 'aria-label': editor.label('insert', 'Insert'), title: editor.label('insert', 'Insert'), 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-id': 'insert' }, h('span', { html: icon('plus', opts.icons) }), h('span', { class: 'z-tool-label' }, editor.label('insert', 'Insert')));
    ins.addEventListener('mousedown', (e) => e.preventDefault());
    ins.addEventListener('click', () => {
      if (ins.getAttribute('aria-expanded') === 'true' || editor.readOnly) return;
      const search = h('input', { class: 'z-input', type: 'search', placeholder: editor.label('insert.search', 'Search blocks…'), 'aria-label': editor.label('insert.search', 'Search blocks…') });
      const listEl = h('div', { class: 'z-insert-list', role: 'menu', 'aria-label': editor.label('insert', 'Insert') });
      const menu = h('div', { class: 'z-menu z-insert-menu', 'data-z-ignore': '' }, search, listEl);
      const close = () => {
        off();
        menu.remove();
        ins.setAttribute('aria-expanded', 'false');
      };
      const render = () => {
        const q = search.value.trim().toLowerCase();
        listEl.textContent = '';
        let group: string | undefined;
        for (const it of editor.slashItems.filter((i) => !q || i.title.toLowerCase().includes(q) || (i.keywords ?? []).some((k) => k.includes(q)))) {
          if (it.group !== group && !q) listEl.append(h('div', { class: 'z-menu-group', role: 'presentation' }, it.group ?? ''));
          group = it.group;
          const row = h('button', { type: 'button', class: 'z-menu-item', role: 'menuitem' }, h('span', { class: 'z-menu-icon', html: icon(it.icon, opts.icons) || undefined }), h('span', { class: 'z-menu-text' }, h('span', { class: 'z-menu-title' }, it.title), it.description ? h('span', { class: 'z-menu-desc' }, it.description) : null));
          row.addEventListener('click', () => {
            close();
            const sel = editor.selection;
            // act on the block holding the selection; fall back to the end of the document
            const blockId = sel?.type === 'text' ? sel.focus.id : sel?.type === 'block' ? sel.ids[sel.ids.length - 1] : sel?.type === 'cell' ? sel.focus : (editor.doc.last()?.id ?? '');
            editor.focus();
            editor.cutHistory();
            it.run(editor, { blockId });
          });
          listEl.append(row);
        }
        if (!listEl.firstChild) listEl.append(h('div', { class: 'z-menu-empty' }, editor.label('slash.empty')));
      };
      search.addEventListener('input', render);
      search.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          (listEl.querySelector('.z-menu-item') as HTMLElement | null)?.focus();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          (listEl.querySelector('.z-menu-item') as HTMLElement | null)?.click();
        }
      });
      render();
      (dom.closest('.zeditor') ?? document.body).append(menu);
      place(menu, ins.getBoundingClientRect());
      roving(listEl, '.z-menu-item', true);
      ins.setAttribute('aria-expanded', 'true');
      const off = dismissable(menu, () => {
        close();
        ins.focus();
      }, { ignore: ins });
      search.focus();
    });
    updaters.push(() => {
      ins.disabled = editor.readOnly;
    });
    const firstSep = dom.querySelector('.z-sep');
    if (firstSep && !opts.items) firstSep.after(ins, h('span', { class: 'z-sep', role: 'separator', 'aria-orientation': 'vertical' }));
    else if (insertSlot) insertSlot.replaceWith(ins);
    else dom.append(ins);
  }
  roving(dom, '.z-tool');
  let raf: any = 0;
  const update = () => {
    for (const u of updaters) u();
    // the toolbar's single tab stop must be a control that can take focus
    const stop = dom.querySelector<HTMLButtonElement>('.z-tool[tabindex="0"]');
    if (!stop || stop.disabled) {
      const first = dom.querySelector<HTMLElement>('.z-tool:not(:disabled)');
      if (first && document.activeElement !== stop) {
        if (stop) stop.tabIndex = -1;
        first.tabIndex = 0;
      }
    }
  };
  const schedule = () => {
    if (raf) return;
    raf = (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(() => {
      raf = 0;
      update();
    });
  };
  const off = editor.on('update', schedule);
  update();
  return {
    dom,
    update,
    destroy() {
      off();
      dom.remove();
    },
  };
}

/** Toolbar that follows a non-collapsed text selection. Needs no hover, so it works on touch. */
export function createFloatingToolbar(editor: Editor, host: HTMLElement, opts: { items?: string[]; icons?: Record<string, string>; when?: () => boolean } = {}): UIHandle {
  const tb = createToolbar(editor, { floating: true, items: opts.items, icons: opts.icons });
  const dom = tb.dom;
  dom.hidden = true;
  host.append(dom);
  let timer: any = 0;
  let pointerDown = false;
  const show = () => {
    const sel = editor.selection;
    const view = editor.view;
    const ok = !!view && !!sel && sel.type === 'text' && !isCollapsed(sel) && !editor.readOnly && view.hasFocus() && !view.composing && (opts.when?.() ?? true) && !pointerDown;
    if (!ok) {
      if (!dom.contains(document.activeElement)) dom.hidden = true;
      return;
    }
    const rect = view.selectionRect();
    if (!rect) return;
    dom.hidden = false;
    tb.update();
    place(dom, rect, { above: true, align: 'center' });
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(show, 80);
  };
  const down = (e: Event) => {
    if (dom.contains(e.target as Node)) return;
    pointerDown = true;
    dom.hidden = true;
  };
  const up = () => {
    pointerDown = false;
    schedule();
  };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointerup', up, true);
  window.addEventListener('scroll', schedule, true);
  const offs = [editor.on('update', schedule), editor.on('blur', schedule), editor.on('focus', schedule)];
  return {
    dom,
    update: show,
    destroy() {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      window.removeEventListener('scroll', schedule, true);
      offs.forEach((o) => o());
      tb.destroy();
    },
  };
}

/** Link editor: opens on the `ui:link` event (toolbar button or Mod-K). */
export function createLinkPopover(editor: Editor, host: HTMLElement): { destroy(): void } {
  let pop: HTMLElement | null = null;
  let off = () => {};
  const close = (refocus = true) => {
    off();
    pop?.remove();
    pop = null;
    if (refocus) editor.focus();
  };
  const open = () => {
    if (pop || editor.readOnly) return;
    const sel = editor.selection;
    const view = editor.view;
    if (!sel || sel.type === 'cell' || !view) return;
    let current = markValue(editor, 'link')?.href ?? '';
    if (sel.type === 'text' && isCollapsed(sel)) {
      const b = editor.doc.get(sel.focus.id);
      current = (b && markRangeAt(b, sel.focus.offset, 'link')?.value?.href) || '';
    }
    const input = h('input', { class: 'z-input', type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: editor.label('link.placeholder'), 'aria-label': editor.label('link'), value: current });
    const apply = () => {
      const v = input.value.trim();
      const href = v && !/^[a-z][a-z0-9+.-]*:|^[/#.]/i.test(v) ? 'https://' + v : v;
      close(false);
      editor.focus();
      if (!href) editor.exec('unsetLink');
      else if (!editor.exec('setLink', href)) editor.emit('ui:error', { message: editor.label('notice.badUrl', 'That address is not a valid link.') });
    };
    const remove = h('button', { type: 'button', class: 'z-btn', onclick: () => {
      close(false);
      editor.focus();
      editor.exec('unsetLink');
    } }, editor.label('link.remove'));
    const openBtn = h('a', { class: 'z-btn', target: '_blank', rel: 'noopener noreferrer nofollow', href: safeUrl(current) || '#' }, editor.label('link.open'));
    const form = h('form', { class: 'z-link-form' }, input, h('button', { type: 'submit', class: 'z-btn z-primary' }, editor.label('link.apply')), current ? remove : null, current ? openBtn : null);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      apply();
    });
    pop = h('div', { class: 'z-popover z-link-pop', role: 'dialog', 'aria-label': editor.label('link'), 'data-z-ignore': '' }, form);
    host.append(pop);
    const rect = view.selectionRect() ?? view.root.getBoundingClientRect();
    place(pop, rect);
    off = dismissable(pop, () => close());
    input.focus();
    input.select();
  };
  const offEv = editor.on('ui:link', open);
  return {
    destroy() {
      offEv();
      close(false);
    },
  };
}
