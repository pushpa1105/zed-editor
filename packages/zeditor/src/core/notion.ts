/**
 * Workspace-style blocks: table of contents, bookmarks (link previews), links to pages, date
 * chips, template buttons and toggle headings. Headless specs and commands; renderers are in
 * view/notion-render.ts.
 */
import { BlockJSON, InlineAtom, cloneWithNewIds } from './model';
import type { Editor } from './editor';
import type { Extension } from './extension';
import { safeUrl } from './schema';
import { esc } from './html';
import { textSel, blockSel } from './selection';
import { emptyId, getPages, v } from './builtin';
import { selectedBlocks } from './commands';
import { getHeadings } from '../features/text';

export interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
  site?: string;
}
/** Host adapter: resolve metadata for a bookmarked URL (the editor never fetches URLs itself). */
export type LinkPreviewHandler = (url: string, ctx: { signal: AbortSignal }) => Promise<LinkPreview | null> | LinkPreview | null;

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function formatDate(iso: string, locale?: string): string {
  if (!DATE.test(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const days = Math.round((new Date(y, m - 1, d).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  try {
    return new Intl.DateTimeFormat(locale, { year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric', month: 'short', day: 'numeric' }).format(date);
  } catch {
    return iso;
  }
}

const pending = new WeakMap<Editor, Map<string, AbortController>>();

export const notionExtension: Extension = {
  name: 'notion',
  requires: ['base', 'layout'],
  schemaVersion: 1,
  nodes: [
    {
      type: 'toc',
      kind: 'atom',
      toHTML: (b, c) => `<nav${c.id(b)} data-toc=""></nav>`,
      parseHTML: [{ tag: 'nav', match: (el) => el.attrs['data-toc'] !== undefined, priority: 60 }],
      toMarkdown: () => '<!-- toc -->',
      toText: () => '',
    },
    {
      type: 'bookmark',
      kind: 'atom',
      attrs: {
        url: { default: '', validate: v.url },
        title: { default: '', validate: v.str(300) },
        description: { default: '', validate: v.str(600) },
        image: { default: '', validate: (x) => (/^https?:\/\//i.test(safeUrl(x)) ? x : '') },
        site: { default: '', validate: v.str(100) },
      },
      // a block-level wrapper, so the importer does not read it as a link inside a paragraph
      parseHTML: [{ tag: 'div', match: (el) => el.attrs['data-bookmark'] !== undefined, getAttrs: (el) => (safeUrl(el.attrs['data-url']) ? { url: el.attrs['data-url'], title: el.attrs['data-title'] ?? '', description: el.attrs['data-description'] ?? '', image: el.attrs['data-image'] ?? '', site: el.attrs['data-site'] ?? '' } : false), priority: 75 }],
      toHTML: (b, c) => {
        const a = b.attrs ?? {};
        const url = esc(safeUrl(a.url));
        return `<div${c.id(b)} data-bookmark="" data-url="${url}" data-title="${esc(a.title ?? '')}" data-description="${esc(a.description ?? '')}" data-image="${esc(a.image ?? '')}" data-site="${esc(a.site ?? '')}"><a href="${url}" rel="noopener noreferrer nofollow">${esc(a.title || a.url || '')}</a>${a.description ? `<p>${esc(a.description)}</p>` : ''}</div>`;
      },
      toMarkdown: (b) => `[${String(b.attrs?.title || b.attrs?.url || '').replace(/[[\]]/g, '')}](${b.attrs?.url ?? ''})`,
      toText: (b) => b.attrs?.title || b.attrs?.url || '',
    },
    {
      type: 'template_button',
      kind: 'atom',
      attrs: {
        label: { default: 'New item', validate: v.str(100) },
        // stored block JSON; validated again by `insertBlocks` every time it is used
        blocks: { default: [], validate: (x) => (Array.isArray(x) ? x.slice(0, 200) : undefined) },
      },
      toText: (b) => b.attrs?.label ?? '',
    },
    {
      // a live, read-only mirror of another block of the same document
      type: 'synced',
      kind: 'atom',
      attrs: { source: { default: '', validate: (x) => (typeof x === 'string' && /^[\w:.-]{1,64}$/.test(x) ? x : undefined) } },
      parseHTML: [{ tag: 'div', match: (el) => !!el.attrs['data-synced'], getAttrs: (el) => ({ source: el.attrs['data-synced'] }), priority: 75 }],
      toHTML: (b, c) => `<div${c.id(b)} data-synced="${esc(b.attrs?.source ?? '')}"></div>`,
      toText: () => '',
    },
    {
      type: 'page_link',
      kind: 'inline',
      attrs: { page: { default: '', validate: (x) => (typeof x === 'string' && /^[\w:.-]{1,64}$/.test(x) ? x : undefined) }, title: { default: '', validate: v.str(200) } },
      parseHTML: [{ tag: 'a', match: (el) => !!el.attrs['data-page-link'], getAttrs: (el) => ({ page: el.attrs['data-page-link'], title: el.attrs['data-title'] ?? '' }), priority: 75 }],
      toHTML: (a: InlineAtom) => `<a data-page-link="${esc(a.attrs?.page ?? '')}" data-title="${esc(a.attrs?.title ?? '')}" href="#${esc(a.attrs?.page ?? '')}">${esc(a.attrs?.title || 'Page')}</a>`,
      toMarkdown: (a: InlineAtom) => `[${String(a.attrs?.title || 'Page').replace(/[[\]]/g, '')}](#${a.attrs?.page ?? ''})`,
      toText: (a: InlineAtom) => a.attrs?.title || 'Page',
    },
    {
      type: 'date',
      kind: 'inline',
      attrs: { date: { default: '', validate: (x) => (typeof x === 'string' && DATE.test(x) ? x : undefined) } },
      parseHTML: [{ tag: 'time', match: (el) => DATE.test(el.attrs.datetime ?? ''), getAttrs: (el) => ({ date: el.attrs.datetime }), priority: 60 }],
      toHTML: (a: InlineAtom) => `<time datetime="${esc(a.attrs?.date ?? '')}">${esc(a.attrs?.date ?? '')}</time>`,
      toMarkdown: (a: InlineAtom) => a.attrs?.date ?? '',
      toText: (a: InlineAtom) => a.attrs?.date ?? '',
    },
  ],
  // toggle headings: a toggle whose summary is styled as a heading
  extendNode: {
    toggle: (spec) => ({ ...spec, attrs: { ...spec.attrs, level: { validate: (x: any) => (v.int(1, 3)(x) as number) || undefined } } }),
  },
  commands: {
    insertToc: (editor) => editor.exec('insertBlock', 'toc'),
    /** Insert a bookmark and resolve its preview through the host's `linkPreview` adapter. */
    insertBookmark: (editor, url: string, at?: { replace?: string; after?: string }) => {
      const safe = safeUrl(url);
      if (!/^https?:\/\//i.test(safe)) return false;
      const block = editor.schema.create('bookmark', { url: safe });
      if (!editor.exec('insertBlocks', [block], at)) return false;
      const handler = editor.storage.linkPreview as LinkPreviewHandler | undefined;
      if (!handler) return true;
      const ctrl = new AbortController();
      let map = pending.get(editor);
      if (!map) pending.set(editor, (map = new Map()));
      map.set(block.id, ctrl);
      Promise.resolve()
        .then(() => handler(safe, { signal: ctrl.signal }))
        .then(
          (meta) => {
            map!.delete(block.id);
            const b = editor.doc.get(block.id);
            // ignore results for a bookmark that was removed or re-pointed meanwhile
            if (!meta || ctrl.signal.aborted || editor.destroyed || !b || b.attrs.url !== safe) return;
            // host data is validated like any other attribute source
            const clean = editor.schema.parseAttrs(editor.schema.node('bookmark')!.attrs, { ...b.attrs, title: meta.title, description: meta.description, image: meta.image, site: meta.site }, true);
            editor.update((tr) => void tr.setAttrs(block.id, clean), { history: false, origin: 'preview' });
          },
          () => void map!.delete(block.id),
        );
      return true;
    },
    insertDate: (editor, date?: string) => editor.exec('insertInline', { atom: 'date', attrs: { date: date && DATE.test(date) ? date : isoDate(new Date()) } }, { trailingSpace: true }),
    insertPageLink: (editor, pageId: string) => {
      const page = editor.doc.get(pageId);
      if (!page || page.type !== 'page') return false;
      return editor.exec('insertInline', { atom: 'page_link', attrs: { page: pageId, title: page.attrs.title ?? '' } }, { trailingSpace: true });
    },
    /** Insert a live, read-only mirror of a block (default: the block holding the selection) below it. */
    insertSyncedCopy: (editor, sourceId?: string, at?: { after?: string }) => {
      if (editor.readOnly) return false;
      const source = sourceId ? editor.doc.get(sourceId) : selectedBlocks(editor)[0];
      if (!source || source === editor.doc.root || ['synced', 'page', 'db_row', 'table_row', 'table_cell', 'column'].includes(source.type)) return false;
      const copy = editor.schema.create('synced', { source: source.id });
      return editor.update((tr) => {
        tr.insertAfter(at?.after && editor.doc.get(at.after) ? at.after : source.id, [copy]);
        tr.select(blockSel([copy.id]));
      });
    },
    /** Create a button that inserts copies of the given (or selected) blocks when pressed. */
    saveAsTemplate: (editor, ids?: string[], label?: string) => {
      if (editor.readOnly) return false;
      const blocks = ids?.length ? ids.map((i) => editor.doc.get(i)!).filter(Boolean) : selectedBlocks(editor);
      const usable = blocks.filter((b) => b.type !== 'template_button' && b.type !== 'page' && b.type !== 'db_row' && b.type !== 'table_row' && b.type !== 'table_cell' && b.type !== 'column');
      if (!usable.length) return false;
      const last = usable[usable.length - 1];
      const btn = editor.schema.create('template_button', { label: label ?? 'New ' + (editor.schema.isText(usable[0]) && usable[0].length ? usable[0].text.slice(0, 30) : usable[0].type), blocks: usable.map((b) => editor.schema.serializeBlock(b)) });
      return editor.update((tr) => {
        tr.insertAfter(last.id, [btn]);
        tr.select(blockSel([btn.id]));
      });
    },
    /** Insert the template's blocks (fresh ids) below the button. */
    useTemplate: (editor, buttonId: string) => {
      const b = editor.doc.get(buttonId);
      if (!b || b.type !== 'template_button' || editor.readOnly) return false;
      const copies = (b.attrs.blocks as BlockJSON[]).filter((x) => x && typeof x === 'object').map((x) => cloneWithNewIds(x));
      if (!copies.length) return false;
      // goes through the normal validation path: stored templates are untrusted data
      return editor.exec('insertBlocks', copies, { after: buttonId });
    },
    setToggleLevel: (editor, level: number | null, id?: string) => editor.exec('setBlockType', 'toggle', { open: true, level: level || undefined }, id ? [id] : undefined),
  },
  typeahead: [
    {
      // `[[` links to a page of this document
      name: 'page-link',
      trigger: '[[',
      allowSpaces: true,
      emptyLabel: 'No pages — use "New page" first',
      search: (q, { editor }) =>
        getPages(editor)
          .filter((p) => String(p.attrs.title ?? '').toLowerCase().includes(q.toLowerCase()))
          .slice(0, 20)
          .map((p) => ({ id: p.id, label: p.attrs.title || 'Untitled', icon: 'page' })),
      select: (editor, item, range) => {
        editor.update((tr) => {
          tr.replaceText(range.id, range.from, range.to, [{ atom: 'page_link', attrs: { page: item.id, title: item.label } }, { text: ' ' }]);
          tr.select(textSel(range.id, range.from + 2));
        });
      },
    },
  ],
  slashItems: [
    { id: 'toc', title: 'Table of contents', description: 'Outline of this document', keywords: ['toc', 'outline', 'contents', 'headings'], icon: 'list-bullet', group: 'advanced', order: 60, run: (e, { blockId }) => void e.exec('insertBlocks', [e.schema.create('toc')], { replace: emptyId(e, blockId), after: blockId }) },
    { id: 'bookmark', title: 'Bookmark', description: 'Link with a preview card', keywords: ['link', 'preview', 'url', 'web'], icon: 'link', group: 'advanced', order: 61, run: (e, { blockId }) => void e.emit('ui:bookmark', { blockId }) },
    { id: 'date', title: 'Date', description: 'Insert today, click to change', keywords: ['today', 'calendar', 'reminder', 'time'], icon: 'page', group: 'advanced', order: 62, run: (e) => void e.exec('insertDate') },
    { id: 'template', title: 'Template button', description: 'Button that inserts saved blocks', keywords: ['template', 'button', 'reuse', 'snippet'], icon: 'copy', group: 'advanced', order: 63, run: (e, { blockId }) => void e.exec('insertBlocks', [e.schema.create('template_button', { label: 'New to-do', blocks: [e.schema.create('list', { kind: 'check', checked: false }, 'To-do')] })], { replace: emptyId(e, blockId), after: blockId }) },
    ...[1, 2, 3].map((level) => ({ id: 'toggle-h' + level, title: 'Toggle heading ' + level, description: 'Collapsible heading', keywords: ['toggle', 'heading', 'collapse', 'h' + level], icon: 'toggle', group: 'advanced', order: 63 + level, run: (e: Editor, { blockId }: { blockId: string }) => void e.exec('setToggleLevel', level, blockId) })),
  ],
  blockActions: [
    { id: 'syncedCopy', label: 'action.syncedCopy', icon: 'sync', run: (e, ids) => void e.exec('insertSyncedCopy', ids[0]) },
    { id: 'saveTemplate', label: 'action.saveTemplate', icon: 'copy', run: (e, ids) => void e.exec('saveAsTemplate', ids) },
  ],
  labels: {
    'action.saveTemplate': 'Save as template button',
    'action.syncedCopy': 'Create synced copy',
    'synced.label': 'Synced copy',
    'synced.goto': 'Go to original',
    'synced.missing': 'The original block was deleted',
    'toc.title': 'Table of contents',
    'toc.empty': 'Add headings to build an outline',
    'bookmark.prompt': 'Paste a link to bookmark',
    'template.use': 'Insert template',
    'template.rename': 'Rename template',
    'date.change': 'Change date',
    'pagelink.missing': 'Missing page',
  },
  setup: (editor) => () => {
    for (const c of pending.get(editor)?.values() ?? []) c.abort();
  },
};

/** Entries for a `toc` block: headings of the page that contains it (or of the document). */
export function tocEntries(editor: Editor, tocId: string) {
  const toc = editor.doc.get(tocId);
  const page = editor.doc.closest(toc, (b) => b.type === 'page');
  return getHeadings(editor).filter((h) => !page || editor.doc.closest(editor.doc.get(h.id), (b) => b.type === 'page') === page);
}

declare module './editor' {
  interface Commands {
    insertToc(): boolean;
    insertSyncedCopy(sourceId?: string, at?: { after?: string }): boolean;
    insertBookmark(url: string, at?: { replace?: string; after?: string }): boolean;
    insertDate(date?: string): boolean;
    insertPageLink(pageId: string): boolean;
    saveAsTemplate(ids?: string[], label?: string): boolean;
    useTemplate(buttonId: string): boolean;
    setToggleLevel(level: number | null, id?: string): boolean;
  }
}
