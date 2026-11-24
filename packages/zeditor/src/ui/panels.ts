/**
 * Find & replace, status bar, page tabs, table tools, media prompts and the review panel.
 */
import type { Editor } from '../core/editor';
import { textSel } from '../core/selection';
import { tableContext, tableMap } from '../core/table';
import { activePage, getPages, emptyId } from '../core/builtin';
import { safeUrl } from '../core/schema';
import { findAll, replaceAll, replaceMatch, getCounts, Match, FindOptions } from '../features/text';
import type { Uploads } from '../features/persist';
import type { CommentsController, SuggestionsController } from '../features/review';
import { h, place } from '../view/dom';
import { inlinePrompt } from '../view/render';
import { icon } from './icons';
import { dismissable, roving } from './toolbar';

type Disposable = { destroy(): void };

/* ------------------------------------------------------------------ find & replace */

export function createFindPanel(editor: Editor, host: HTMLElement): Disposable & { open(): void; close(): void } {
  const view = editor.view;
  let matches: Match[] = [];
  let current = -1;
  const opts: FindOptions = {};
  const q = h('input', { class: 'z-input', type: 'search', placeholder: editor.label('find.placeholder', 'Find'), 'aria-label': editor.label('find.placeholder', 'Find') });
  const rep = h('input', { class: 'z-input', type: 'text', placeholder: editor.label('find.replace', 'Replace with'), 'aria-label': editor.label('find.replace', 'Replace with') });
  const count = h('span', { class: 'z-find-count', role: 'status', 'aria-live': 'polite' });
  const toggle = (label: string, key: keyof FindOptions, text: string) => {
    const b = h('button', { type: 'button', class: 'z-btn z-toggle-opt', 'aria-pressed': 'false', title: label, 'aria-label': label }, text);
    b.addEventListener('click', () => {
      opts[key] = !opts[key];
      b.setAttribute('aria-pressed', String(!!opts[key]));
      search();
    });
    return b;
  };
  const btn = (label: string, fn: () => void, ic?: string) => h('button', { type: 'button', class: 'z-btn', 'aria-label': label, title: label, onclick: fn, html: ic ? icon(ic) : undefined }, ic ? null : label);
  const panel = h(
    'div',
    { class: 'z-find', role: 'search', 'aria-label': editor.label('find.title', 'Find and replace'), 'data-z-ignore': '', hidden: true },
    h('div', { class: 'z-find-row' }, q, count, btn(editor.label('find.prev', 'Previous match'), () => go(-1), 'up'), btn(editor.label('find.next', 'Next match'), () => go(1), 'down'), toggle(editor.label('find.case', 'Match case'), 'caseSensitive', 'Aa'), toggle(editor.label('find.word', 'Whole word'), 'wholeWord', 'W'), toggle(editor.label('find.regex', 'Regular expression'), 'regex', '.*'), btn(editor.label('find.close', 'Close'), () => close(), 'close')),
    h('div', { class: 'z-find-row' }, rep, btn(editor.label('find.replaceOne', 'Replace'), () => replaceOne()), btn(editor.label('find.replaceAll', 'Replace all'), () => doReplaceAll())),
  );
  host.append(panel);
  const offSource = view.addHighlightSource('find', () => {
    if (panel.hidden || !matches.length) return {};
    const cur = matches[current];
    return { 'z-find': matches.filter((m) => m !== cur), 'z-find-current': cur ? [cur] : [] };
  });
  const show = () => {
    count.textContent = q.value ? `${matches.length ? current + 1 : 0} / ${matches.length}` : '';
    view.scheduleHighlights();
  };
  const search = (keep = false) => {
    matches = panel.hidden ? [] : findAll(editor, q.value, opts);
    if (!keep || current >= matches.length) current = matches.length ? 0 : -1;
    show();
  };
  const reveal = () => {
    const m = matches[current];
    if (!m) return;
    // show the page that holds the match, then scroll it into view without stealing focus
    const b = editor.doc.get(m.id);
    const page = b && editor.doc.closest(b, (x) => x.type === 'page');
    if (page) editor.exec('setActivePage', page.id);
    editor.setSelection(textSel(m.id, m.from, m.id, m.to));
    view.rangeFor(m.id, m.from, m.to)?.startContainer.parentElement?.scrollIntoView({ block: 'nearest' });
    show();
  };
  const go = (d: number) => {
    if (!matches.length) return;
    current = (current + d + matches.length) % matches.length;
    reveal();
  };
  const replaceOne = () => {
    const m = matches[current];
    if (!m) return;
    replaceMatch(editor, m, q.value, rep.value, opts);
    search(true);
    if (matches.length) reveal();
  };
  const doReplaceAll = () => {
    replaceAll(editor, q.value, rep.value, opts);
    search();
  };
  const open = () => {
    panel.hidden = false;
    const sel = editor.selection;
    if (sel?.type === 'text' && sel.anchor.id === sel.focus.id && sel.anchor.offset !== sel.focus.offset) {
      const b = editor.doc.get(sel.anchor.id)!;
      q.value = b.text.slice(Math.min(sel.anchor.offset, sel.focus.offset), Math.max(sel.anchor.offset, sel.focus.offset)).replace(/￼/g, '');
    }
    q.focus();
    q.select();
    search();
  };
  const close = () => {
    panel.hidden = true;
    matches = [];
    show();
    editor.focus();
  };
  q.addEventListener('input', () => search());
  panel.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && e.target === q) {
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Enter' && e.target === rep) {
      e.preventDefault();
      replaceOne();
    }
  });
  const key = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      open();
    }
  };
  view.root.addEventListener('keydown', key);
  const offs = [editor.on('change', () => !panel.hidden && search(true)), editor.on('ui:find', open)];
  return {
    open,
    close,
    destroy() {
      offs.forEach((o) => o());
      offSource();
      view.root.removeEventListener('keydown', key);
      panel.remove();
    },
  };
}

/* ------------------------------------------------------------------ status bar */

export function createStatusBar(editor: Editor, host: HTMLElement): Disposable {
  const counts = h('span', { class: 'z-status-counts' });
  const limit = h('span', { class: 'z-status-limit' });
  const save = h('span', { class: 'z-status-save', role: 'status', 'aria-live': 'polite' });
  const bar = h('div', { class: 'z-status', 'data-z-ignore': '' }, counts, limit, h('span', { class: 'z-spacer' }), save);
  host.append(bar);
  let timer: any = 0;
  const update = () => {
    timer = 0;
    const c = getCounts(editor);
    counts.textContent = `${c.words} ${editor.label('status.words')} · ${c.characters} ${editor.label('status.chars')}`;
    const max = editor.storage.characterLimit as number | undefined;
    limit.textContent = max ? `${c.characters} / ${max}` : '';
    limit.classList.toggle('z-over', !!max && c.characters >= max);
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(update, 200);
  };
  const offs = [
    editor.on('change', schedule),
    editor.on('save', (ev: any) => {
      save.textContent = editor.label('save.' + ev.status);
      save.dataset.status = ev.status;
    }),
    editor.on('limit', () => {
      limit.classList.add('z-flash');
      setTimeout(() => limit.classList.remove('z-flash'), 400);
    }),
  ];
  update();
  return {
    destroy() {
      clearTimeout(timer);
      offs.forEach((o) => o());
      bar.remove();
    },
  };
}

/* ------------------------------------------------------------------ page tabs */

/**
 * Page tabs for multi-page documents (like sheets in a spreadsheet or pages in a notebook).
 * Tabs follow the ARIA tabs pattern: arrow keys move, Enter/Space activates, F2 renames,
 * Delete removes, Alt+Arrow reorders.
 */
export function createPageTabs(editor: Editor, host: HTMLElement): Disposable {
  const list = h('div', { class: 'z-page-tabs', role: 'tablist', 'aria-label': editor.label('pages.tabs') });
  const addBtn = h('button', { type: 'button', class: 'z-btn z-page-add', 'aria-label': editor.label('pages.add'), title: editor.label('pages.add'), html: icon('plus') });
  const viewBtn = h('button', { type: 'button', class: 'z-btn z-page-view', 'aria-pressed': 'false' });
  const info = h('span', { class: 'z-page-info', role: 'status' });
  const bar = h('div', { class: 'z-pages-bar', 'data-z-ignore': '' }, list, addBtn, h('span', { class: 'z-spacer' }), info, viewBtn);
  host.append(bar);
  let renaming: string | null = null;
  let sig = '';

  const rename = (id: string) => {
    if (editor.readOnly) return;
    renaming = id;
    render(true);
    const input = list.querySelector('input') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  };
  const menuFor = (id: string, anchor: HTMLElement) => {
    const pages = getPages(editor);
    const idx = pages.findIndex((p) => p.id === id);
    const item = (label: string, fn: () => void, disabled = false) => h('button', { type: 'button', class: 'z-menu-item', role: 'menuitem', disabled, onclick: () => {
      off();
      menu.remove();
      fn();
    } }, label);
    const menu = h(
      'div',
      { class: 'z-menu', role: 'menu', 'data-z-ignore': '' },
      item(editor.label('pages.rename'), () => rename(id)),
      item(editor.label('pages.duplicate'), () => editor.exec('duplicatePage', id)),
      item(editor.label('pages.moveLeft'), () => editor.exec('movePage', id, idx - 1), idx === 0),
      item(editor.label('pages.moveRight'), () => editor.exec('movePage', id, idx + 1), idx === pages.length - 1),
      item(editor.label('pages.delete'), () => editor.exec('removePage', id), pages.length < 2),
    );
    (bar.closest('.zeditor') ?? document.body).append(menu);
    place(menu, anchor.getBoundingClientRect());
    roving(menu, '.z-menu-item', true);
    const off = dismissable(menu, () => {
      off();
      menu.remove();
      anchor.focus();
    }, { ignore: anchor });
    (menu.querySelector('.z-menu-item:not([disabled])') as HTMLElement | null)?.focus();
  };

  const render = (force = false) => {
    const pages = getPages(editor);
    const active = activePage(editor);
    bar.hidden = !pages.length;
    const pv = editor.view?.pageView ?? 'tabs';
    viewBtn.textContent = editor.label(pv === 'paged' ? 'pages.view.paged' : 'pages.view.tabs');
    viewBtn.setAttribute('aria-pressed', String(pv === 'paged'));
    addBtn.disabled = editor.readOnly;
    const idx = active ? pages.indexOf(active) : -1;
    info.textContent = pages.length ? editor.label('pages.count').replace('{n}', String(idx + 1)).replace('{total}', String(pages.length)) : '';
    const next = pages.map((p) => p.id + ':' + p.attrs.title).join('|') + '#' + active?.id + '#' + renaming + '#' + editor.readOnly;
    if (next === sig && !force) return;
    sig = next;
    const hadFocus = list.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName !== 'INPUT';
    list.textContent = '';
    pages.forEach((p, i) => {
      const selected = p === active;
      const title = p.attrs.title || editor.label('pages.untitled');
      if (renaming === p.id) {
        const input = h('input', { class: 'z-input z-page-rename', value: p.attrs.title ?? '', 'aria-label': editor.label('pages.rename') });
        const commit = (save: boolean) => {
          if (renaming !== p.id) return;
          renaming = null;
          if (save && input.value !== p.attrs.title) editor.exec('renamePage', p.id, input.value);
          render(true);
        };
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit(true);
          else if (e.key === 'Escape') commit(false);
        });
        input.addEventListener('blur', () => commit(true));
        list.append(input);
        return;
      }
      const tab = h('button', { type: 'button', class: 'z-page-tab', role: 'tab', id: 'z-tab-' + p.id, 'aria-selected': String(selected), tabindex: selected ? '0' : '-1', 'data-page': p.id, title }, h('span', { class: 'z-page-num' }, String(i + 1)), h('span', { class: 'z-page-title' }, title));
      tab.addEventListener('click', () => editor.exec('setActivePage', p.id));
      tab.addEventListener('dblclick', () => rename(p.id));
      tab.addEventListener('contextmenu', (e) => {
        if (editor.readOnly) return;
        e.preventDefault();
        menuFor(p.id, tab);
      });
      tab.addEventListener('keydown', (e) => {
        const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role=tab]'));
        const at = tabs.indexOf(tab);
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          if (editor.exec('movePage', p.id, i + (e.key === 'ArrowLeft' ? -1 : 1))) setTimeout(() => (list.querySelector(`[data-page="${p.id}"]`) as HTMLElement | null)?.focus());
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          tabs[(at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]?.focus();
        } else if (e.key === 'Home') tabs[0]?.focus();
        else if (e.key === 'End') tabs[tabs.length - 1]?.focus();
        else if (e.key === 'F2') rename(p.id);
        else if (e.key === 'Delete' && !editor.readOnly) editor.exec('removePage', p.id);
        else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          menuFor(p.id, tab);
        }
      });
      list.append(tab);
      if (selected && !editor.readOnly) {
        const more = h('button', { type: 'button', class: 'z-btn z-page-more', 'aria-label': editor.label('pages.tabs') + ': ' + title, 'aria-haspopup': 'menu', html: icon('more') });
        more.addEventListener('click', () => menuFor(p.id, more));
        list.append(more);
      }
    });
    if (hadFocus) (list.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus();
  };
  addBtn.addEventListener('click', () => {
    editor.exec('addPage');
    editor.focus();
  });
  viewBtn.addEventListener('click', () => editor.view?.setPageView(editor.view.pageView === 'paged' ? 'tabs' : 'paged'));
  const offs = [editor.on('update', () => render()), editor.on('page', () => render())];
  render();
  return {
    destroy() {
      offs.forEach((o) => o());
      bar.remove();
    },
  };
}

/* ------------------------------------------------------------------ table tools */

export function createTableTools(editor: Editor, host: HTMLElement): Disposable {
  const view = editor.view;
  const L = (k: string) => editor.label(k);
  const defs: [string, string, any[], string][] = [
    ['table.addRowBefore', 'addRow', ['before'], '↑+'],
    ['table.addRowAfter', 'addRow', ['after'], '↓+'],
    ['table.addColBefore', 'addColumn', ['before'], '←+'],
    ['table.addColAfter', 'addColumn', ['after'], '→+'],
    ['table.deleteRow', 'deleteRow', [], '−▭'],
    ['table.deleteCol', 'deleteColumn', [], '−▯'],
    ['table.merge', 'mergeCells', [], '⊞'],
    ['table.split', 'splitCell', [], '⊟'],
    ['table.headerRow', 'toggleHeaderRow', [], 'H▭'],
    ['table.headerCol', 'toggleHeaderColumn', [], 'H▯'],
    ['table.delete', 'deleteTable', [], '✕'],
  ];
  const bar = h('div', { class: 'z-toolbar z-table-tools', role: 'toolbar', 'aria-label': L('table.tools'), 'data-z-ignore': '', hidden: true });
  for (const [label, cmd, args, text] of defs) {
    const b = h('button', { type: 'button', class: 'z-tool z-tool-text', 'aria-label': L(label), title: L(label), 'data-cmd': cmd }, text);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      editor.exec(cmd, ...args);
      editor.focus();
    });
    bar.append(b);
  }
  roving(bar, '.z-tool');
  const handles = h('div', { class: 'z-col-handles', 'data-z-ignore': '' });
  host.append(bar, handles);
  let tableId: string | null = null;

  const layout = () => {
    const ctx = editor.readOnly ? null : tableContext(editor);
    const dom = ctx ? (view.domOf(ctx.table.id) as HTMLElement | null) : null;
    if (!ctx || !dom || !view.hasFocus() && !bar.contains(document.activeElement) && !handles.contains(document.activeElement)) {
      if (!bar.contains(document.activeElement) && !handles.contains(document.activeElement)) {
        bar.hidden = true;
        handles.textContent = '';
        tableId = null;
      }
      return;
    }
    tableId = ctx.table.id;
    bar.hidden = false;
    const r = dom.getBoundingClientRect();
    place(bar, { left: r.left, top: r.top, bottom: r.top, right: r.right }, { above: true });
    (bar.querySelector('[data-cmd=mergeCells]') as HTMLButtonElement).disabled = editor.selection?.type !== 'cell';
    // column resize handles along the first row
    const map = tableMap(ctx.table);
    const focused = Array.prototype.indexOf.call(handles.children, document.activeElement);
    handles.textContent = '';
    const tableEl = dom.querySelector('table') as HTMLElement;
    const tr = tableEl.getBoundingClientRect();
    const edges: number[] = [];
    for (let c = 0; c < map.cols; c++) {
      // right edge of column c: use any cell that ends in this column
      for (let row = 0; row < map.rows; row++) {
        const id = map.grid[row][c];
        const p = id ? map.pos.get(id) : null;
        if (id && p && p.col + p.colspan - 1 === c) {
          const cd = view.domOf(id);
          if (cd) {
            edges[c] = cd.getBoundingClientRect().right;
            break;
          }
        }
      }
    }
    edges.forEach((x, c) => {
      if (x == null) return;
      const hd = h('div', { class: 'z-col-handle', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': `${L('table.resize')} ${c + 1}` });
      hd.style.cssText = `position:fixed;left:${x - 4}px;top:${tr.top}px;height:${tr.height}px`;
      const widthOf = () => {
        const prev = c > 0 && edges[c - 1] != null ? edges[c - 1] : tr.left;
        return x - prev;
      };
      hd.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        hd.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startW = widthOf();
        const move = (ev: PointerEvent) => {
          hd.style.left = ev.clientX - 4 + 'px';
        };
        const up = (ev: PointerEvent) => {
          hd.removeEventListener('pointermove', move);
          hd.removeEventListener('pointerup', up);
          hd.removeEventListener('pointercancel', up);
          if (tableId && ev.type === 'pointerup' && Math.abs(ev.clientX - startX) > 1) {
            freeze(map.cols, edges, tr.left);
            editor.exec('setColumnWidth', tableId, c, startW + (ev.clientX - startX));
          }
          layout();
        };
        hd.addEventListener('pointermove', move);
        hd.addEventListener('pointerup', up);
        hd.addEventListener('pointercancel', up);
      });
      hd.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        if (!tableId) return;
        freeze(map.cols, edges, tr.left);
        editor.exec('setColumnWidth', tableId, c, widthOf() + (e.key === 'ArrowRight' ? 16 : -16));
        layout();
      });
      hd.dataset.col = String(c);
      handles.append(hd);
    });
    if (focused >= 0) (handles.children[focused] as HTMLElement | undefined)?.focus();
  };
  /** The first resize pins every column to its current width so only the dragged one changes. */
  const freeze = (cols: number, edges: number[], left: number) => {
    const t = tableId ? editor.doc.get(tableId) : null;
    if (!t || (Array.isArray(t.attrs.colWidths) && t.attrs.colWidths.length >= cols && t.attrs.colWidths.every((w: number) => w > 0))) return;
    const widths: number[] = [];
    for (let c = 0; c < cols; c++) widths.push(Math.round((edges[c] ?? left) - (c > 0 ? edges[c - 1] ?? left : left)) || 80);
    editor.update((tr) => void tr.setAttrs(t.id, { colWidths: widths }), { group: 'col-resize:' + t.id });
  };
  let raf: any = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      layout();
    });
  };
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  const offs = [editor.on('update', schedule), editor.on('focus', schedule), editor.on('blur', () => setTimeout(schedule, 100))];
  return {
    destroy() {
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      offs.forEach((o) => o());
      bar.remove();
      handles.remove();
    },
  };
}

/* ------------------------------------------------------------------ media prompts & uploads */

/** Wires the `ui:image` / `ui:file` / `ui:embed` / `ui:files` events to pickers and the upload manager. */
export function createMediaUI(editor: Editor, host: HTMLElement, uploads: Uploads | null): Disposable {
  const pick = (accept: string, ev: any) => {
    if (editor.readOnly) return;
    const anchor = editor.view?.domOf(ev?.blockId ?? '') ?? editor.view?.root ?? host;
    if (!uploads) {
      // no upload handler configured: ask for a URL instead
      inlinePrompt(anchor, {
        value: '',
        label: accept.startsWith('image') ? 'Image URL' : 'File URL',
        onSubmit: (url) => {
          if (!url.trim()) return;
          const at = { replace: emptyId(editor, ev?.blockId ?? ''), after: ev?.blockId };
          if (accept.startsWith('image')) {
            if (safeUrl(url.trim(), { image: true })) editor.exec('insertBlocks', [editor.schema.create('image', { src: url.trim() })], at);
          } else if (safeUrl(url.trim())) editor.exec('insertBlocks', [editor.schema.create('file', { url: url.trim(), name: url.trim().split('/').pop() || 'file' })], at);
          editor.focus();
        },
      });
      return;
    }
    const input = h('input', { type: 'file', accept, multiple: true, style: 'display:none', 'data-z-ignore': '' });
    host.append(input);
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (files.length) uploads.uploadFiles(files, { replace: emptyId(editor, ev?.blockId ?? ''), after: ev?.blockId });
      editor.focus();
    });
    input.addEventListener('cancel', () => input.remove());
    input.click();
  };
  const offs = [
    editor.on('ui:image', (ev: any) => pick('image/*', ev)),
    editor.on('ui:file', (ev: any) => pick('*/*', ev)),
    editor.on('ui:embed', (ev: any) => {
      const anchor = editor.view?.domOf(ev?.blockId ?? '') ?? editor.view?.root ?? host;
      inlinePrompt(anchor, {
        value: '',
        label: editor.label('embed.prompt'),
        onSubmit: (url) => {
          const u = url.trim();
          if (u && /^https?:\/\//i.test(safeUrl(u))) editor.exec('insertBlocks', [editor.schema.create('embed', { url: u })], { replace: emptyId(editor, ev?.blockId ?? ''), after: ev?.blockId });
          editor.focus();
        },
      });
    }),
    editor.on('ui:bookmark', (ev: any) => {
      const anchor = editor.view?.domOf(ev?.blockId ?? '') ?? editor.view?.root ?? host;
      inlinePrompt(anchor, {
        value: '',
        label: editor.label('bookmark.prompt'),
        onSubmit: (url) => {
          const u = url.trim();
          if (u) editor.exec('insertBookmark', /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u, { replace: emptyId(editor, ev?.blockId ?? ''), after: ev?.blockId });
          editor.focus();
        },
      });
    }),
    editor.on('ui:files', (ev: any) => {
      if (uploads) uploads.uploadFiles(ev.files);
      else editor.emit('ui:error', { message: 'No upload handler configured' });
    }),
    editor.on('ui:retryUpload', (ev: any) => void uploads?.retry(ev.id)),
    editor.on('ui:copyBlockLink', (ev: any) => {
      const url = location.href.replace(/#.*$/, '') + '#' + ev.id;
      navigator.clipboard?.writeText(url).catch(() => undefined);
      editor.emit('ui:blockLink', { id: ev.id, url });
    }),
  ];
  return { destroy: () => offs.forEach((o) => o()) };
}

/** Scroll to and flash the block named in the URL hash (direct links to blocks). */
export function revealBlock(editor: Editor, id: string): boolean {
  const b = editor.doc.get(id);
  const view = editor.view;
  if (!b || !view || b === editor.doc.root) return false;
  const page = b.type === 'page' ? b : editor.doc.closest(b, (x) => x.type === 'page');
  if (page) editor.exec('setActivePage', page.id);
  // expand collapsed ancestors
  for (const a of editor.doc.ancestors(b)) if (a.type === 'toggle' && a.attrs.open === false) editor.exec('toggleOpen', a.id);
  const dom = view.domOf(id);
  if (!dom) return false;
  dom.scrollIntoView({ block: 'center' });
  dom.classList.add('z-flash');
  setTimeout(() => dom.classList.remove('z-flash'), 1600);
  return true;
}

/* ------------------------------------------------------------------ review panel */

/** A simple comments + suggestions sidebar. Hosts can build their own from the controllers. */
export function createReviewPanel(editor: Editor, container: HTMLElement, ctl: { comments?: CommentsController; suggestions?: SuggestionsController }): Disposable {
  const L = (k: string) => editor.label(k);
  const threads = h('div', { class: 'z-threads' });
  const sugg = h('div', { class: 'z-suggestions' });
  const modeBtn = h('button', { type: 'button', class: 'z-btn', 'aria-pressed': 'false' }, L('suggest.mode'));
  const panel = h('aside', { class: 'z-review', 'aria-label': L('comment.panel'), 'data-z-ignore': '' }, ctl.suggestions ? h('div', { class: 'z-review-head' }, modeBtn, h('button', { type: 'button', class: 'z-btn', onclick: () => ctl.suggestions!.acceptAll() }, L('suggest.acceptAll')), h('button', { type: 'button', class: 'z-btn', onclick: () => ctl.suggestions!.rejectAll() }, L('suggest.rejectAll'))) : null, sugg, h('h3', { class: 'z-review-title' }, L('comment.panel')), threads);
  container.append(panel);
  modeBtn.addEventListener('click', () => {
    const s = ctl.suggestions!;
    s.setSuggesting(!s.isSuggesting());
    modeBtn.setAttribute('aria-pressed', String(s.isSuggesting()));
  });
  const fmt = (t: number) => new Date(t).toLocaleString();
  const render = () => {
    threads.textContent = '';
    const list = ctl.comments?.threads() ?? [];
    const at = new Set(ctl.comments?.threadsAtSelection() ?? []);
    if (ctl.comments && !list.length) threads.append(h('p', { class: 'z-muted' }, L('comment.empty')));
    for (const t of list) {
      const reply = h('input', { class: 'z-input', placeholder: L('comment.reply'), 'aria-label': L('comment.reply') });
      const form = h('form', { class: 'z-thread-reply' }, reply, h('button', { type: 'submit', class: 'z-btn' }, L('comment.send')));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (reply.value.trim()) ctl.comments!.reply(t.id, reply.value);
      });
      threads.append(
        h(
          'section',
          { class: 'z-thread' + (t.resolved ? ' z-resolved' : '') + (at.has(t.id) ? ' z-thread-active' : ''), 'data-thread': t.id },
          h('button', { type: 'button', class: 'z-thread-quote', title: t.quote, onclick: () => ctl.comments!.goTo(t.id) && editor.focus() }, '“' + t.quote + '”'),
          t.anchored ? null : h('p', { class: 'z-muted z-orphaned' }, L('comment.orphaned')),
          ...t.comments.map((c) => h('div', { class: 'z-comment-item' }, h('strong', null, c.author.name), ' ', h('time', { class: 'z-muted' }, fmt(c.createdAt)), h('p', null, c.body))),
          t.resolved ? null : form,
          h('div', { class: 'z-thread-actions' }, h('button', { type: 'button', class: 'z-btn', onclick: () => ctl.comments!.resolve(t.id, !t.resolved) }, L(t.resolved ? 'comment.reopen' : 'comment.resolve')), h('button', { type: 'button', class: 'z-btn', onclick: () => ctl.comments!.removeThread(t.id) }, L('comment.delete'))),
        ),
      );
    }
    sugg.textContent = '';
    for (const s of ctl.suggestions?.list() ?? []) {
      sugg.append(
        h(
          'section',
          { class: 'z-thread z-suggestion-item', 'data-suggestion': s.id },
          h('p', null, h('strong', null, s.author), ' · ', L(s.kind === 'insert' ? 'suggest.inserted' : 'suggest.deleted'), ': ', h(s.kind === 'insert' ? 'ins' : 'del', null, s.text.slice(0, 120))),
          h('div', { class: 'z-thread-actions' }, h('button', { type: 'button', class: 'z-btn', onclick: () => ctl.suggestions!.accept(s.id) }, L('suggest.accept')), h('button', { type: 'button', class: 'z-btn', onclick: () => ctl.suggestions!.reject(s.id) }, L('suggest.reject'))),
        ),
      );
    }
  };
  let timer: any = 0;
  const schedule = () => {
    if (panel.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT' && (document.activeElement as HTMLInputElement).value) return;
    clearTimeout(timer);
    timer = setTimeout(render, 60);
  };
  const offs = [
    ctl.comments?.subscribe(schedule),
    ctl.suggestions?.subscribe(schedule),
    editor.on('selection', schedule),
    editor.on('ui:comment', () => {
      if (!ctl.comments) return;
      const anchor = editor.view?.root ?? container;
      const rect = editor.view?.selectionRect();
      inlinePrompt(anchor, { value: '', label: L('comment.placeholder'), multiline: true, onSubmit: (body) => void ctl.comments!.addThread(body) });
      const pop = document.querySelector('.z-prompt:last-of-type') as HTMLElement | null;
      if (pop && rect) place(pop, rect);
    }),
  ];
  render();
  return {
    destroy() {
      clearTimeout(timer);
      offs.forEach((o) => o?.());
      panel.remove();
    },
  };
}
