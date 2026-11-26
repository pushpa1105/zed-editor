/**
 * Renderers for databases and the workspace blocks (table of contents, bookmark, template
 * button, page link, date). Controls inside the document are `contenteditable="false"` and
 * marked `data-z-ignore`, so the editor leaves their keyboard and input events alone.
 */
import { Block, InlineAtom } from '../core/model';
import { safeUrl } from '../core/schema';
import type { Editor } from '../core/editor';
import { database, dbRow, popup } from './database-render';
import { formatDate, tocEntries } from '../core/notion';
import { blocksToHTML } from '../core/html';
import { textSel } from '../core/selection';
import { InlineRenderer, NodeRenderer, RenderContext } from './render';
import { h, place } from './dom';
import { icon } from '../ui/icons';

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
  const el = h('time', { class: 'z-date', datetime: iso, role: 'button', tabindex: '-1', title: iso, 'aria-label': `${ctx.label('date.change')}: ${iso}` }, '@' + formatDate(iso, ctx.editor.options.locale));
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

const synced: NodeRenderer = (block, ctx) => {
  const body = h('div', { class: 'z-synced-body' });
  const go = h('button', { type: 'button', class: 'z-synced-go', 'data-z-ignore': '' }, h('span', { class: 'z-db-ic', html: icon('sync') }), ctx.label('synced.label') + ' · ' + ctx.label('synced.goto'));
  const dom = h('div', { class: 'z-block z-synced', contenteditable: 'false' }, go, body);
  let source = block.attrs.source as string;
  let last = '';
  const render = () => {
    const src = ctx.editor.doc.get(source);
    // rendered through the HTML serializer: escaped text, validated URLs, no live controls
    const html = src && src.type !== 'synced' ? blocksToHTML(ctx.editor.schema, [src]) : '';
    if (html === last && body.firstChild) return;
    last = html;
    dom.classList.toggle('z-missing', !html);
    if (html) body.innerHTML = html;
    else body.textContent = ctx.label('synced.missing');
    go.disabled = !html;
  };
  go.addEventListener('click', () => reveal(ctx, source));
  let timer: any = 0;
  const off = ctx.editor.on('change', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  });
  render();
  return {
    dom,
    update: (b) => {
      source = b.attrs.source;
      render();
    },
    destroy: () => {
      clearTimeout(timer);
      off();
    },
  };
};

export const notionNodeRenderers: Record<string, NodeRenderer> = { database, db_row: dbRow, toc, bookmark, template_button: templateButton, synced };
export const notionInlineRenderers: Record<string, InlineRenderer> = { page_link: pageLink, date: dateChip };
