import { describe, it, expect, beforeEach, vi } from 'vitest';
import { make, p, resetIds, checkInvariants, caret, texts } from './helpers';
import {
  createComments, createSuggestions, createVersions, createAutosave, createUploads, latestRunner, findAll, replaceAll, replaceMatch,
  createHeadlessEditor, Extension, getPages, activePage, textSel, blockSel, DocJSON, toMarkdown, fromMarkdown, toHTML, fromHTML,
} from '../../src/core';

beforeEach(resetIds);
const user = { id: 'u1', name: 'Ada' };
const other = { id: 'u2', name: 'Bob' };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('comments', () => {
  it('anchors follow edits and moves; deleting the text orphans the thread; undo re-anchors', () => {
    const e = make([p('hello brave world', 'a'), p('second', 'b'), { id: 'img', type: 'image', attrs: { src: 'https://x.example/i.png' } }]);
    const c = createComments(e, { user });
    caret(e, 'a', 6, 'a', 11);
    const t = c.addThread('why brave?')!;
    expect(t.quote).toBe('brave');
    expect(e.canUndo()).toBe(false); // anchoring is not an undo step
    expect(c.anchors(t.id)).toEqual([{ id: 'a', from: 6, to: 11 }]);
    // typing before and inside
    caret(e, 'a', 0);
    e.commands.insertText('>> ');
    caret(e, 'a', 11);
    e.commands.insertText('XX');
    expect(c.anchors(t.id)).toEqual([{ id: 'a', from: 9, to: 16 }]);
    // typing at the end edge does not extend the anchor
    caret(e, 'a', 16);
    e.commands.insertText('!');
    expect(c.anchors(t.id)).toEqual([{ id: 'a', from: 9, to: 16 }]);
    // reorder the block: anchor and image identity are preserved, and undo restores the order
    const before = e.getJSON();
    e.commands.moveBlocksTo(['a'], 'img', 'after');
    expect(e.doc.blocks.map((b) => b.id)).toEqual(['b', 'img', 'a']);
    expect(c.anchors(t.id)).toEqual([{ id: 'a', from: 9, to: 16 }]);
    e.commands.moveBlocksTo(['img'], 'b', 'before');
    expect(e.doc.get('img')!.attrs.src).toBe('https://x.example/i.png');
    e.undo();
    e.undo();
    expect(e.getJSON()).toEqual(before);
    expect(c.threads()[0].anchored).toBe(true);
    // delete the anchored text
    caret(e, 'a', 9, 'a', 16);
    e.commands.deleteSelection();
    expect(c.threads()[0]).toMatchObject({ anchored: false, quote: 'brave' });
    e.undo();
    expect(c.threads()[0].anchored).toBe(true);
    // replies, permissions, resolve
    expect(c.reply(t.id, 'because')).toBeTruthy();
    const c2 = createComments(e, { user: other, store: c.store, permissions: { canModerate: () => false } });
    expect(c2.removeThread(t.id)).toBe(false);
    expect(c2.editComment(t.id, t.comments[0].id, 'hacked')).toBe(false);
    expect(c.resolve(t.id)).toBe(true);
    expect(c.removeThread(t.id)).toBe(true);
    expect(JSON.stringify(e.getJSON())).not.toContain('comment');
    checkInvariants(e);
  });
});

describe('suggestions', () => {
  it('records insertions and deletions, accept and reject', () => {
    const e = make([p('keep remove keep', 'a')]);
    const s = createSuggestions(e, { user });
    s.setSuggesting(true);
    caret(e, 'a', 5, 'a', 12);
    e.commands.deleteSelection();
    expect(texts(e)).toBe('keep remove keep'); // still there, marked
    caret(e, 'a', 16);
    for (const ch of ' added') e.commands.insertText(ch);
    let list = s.list();
    expect(list.map((x) => [x.kind, x.text])).toEqual([['delete', 'remove '], ['insert', ' added']]);
    // deleting your own pending insertion really removes it
    e.commands.deleteBackward();
    expect(texts(e)).toBe('keep remove keep adde');
    s.setSuggesting(false);
    list = s.list();
    const snapshot = e.getJSON();
    expect(s.accept(list[0].id)).toBe(true);
    expect(texts(e)).toBe('keep keep adde');
    expect(s.reject(list[1].id)).toBe(true);
    expect(texts(e)).toBe('keep keep');
    expect(s.list()).toEqual([]);
    e.undo();
    e.undo();
    expect(e.getJSON()).toEqual(snapshot);
    expect(s.rejectAll()).toBe(2);
    expect(texts(e)).toBe('keep remove keep');
    expect(e.doc.get('a')!.content).toEqual([{ text: 'keep remove keep' }]);
  });
  it('respects review permissions', () => {
    const e = make([p('abc', 'a')]);
    const s = createSuggestions(e, { user, permissions: { canReview: () => false } });
    s.setSuggesting(true);
    caret(e, 'a', 3);
    e.commands.insertText('d');
    expect(s.acceptAll()).toBe(0);
  });
});

describe('versions', () => {
  it('saves and restores a version as one undoable edit', async () => {
    const e = make([p('v1', 'a')]);
    const v = createVersions(e, { user });
    const first = await v.save('first');
    caret(e, 'a', 2);
    e.commands.insertText(' changed');
    e.commands.splitBlock();
    const later = e.getJSON();
    expect(await v.restore(first.id)).toBe(true);
    expect(texts(e)).toBe('v1');
    e.undo();
    expect(e.getJSON()).toEqual(later);
    expect((await v.list()).map((x) => x.label)).toEqual(['first']);
  });
});

describe('autosave', () => {
  it('a late save response never marks newer edits as saved', async () => {
    const e = make([p('', 'a')]);
    const saves: { doc: DocJSON; resolve: () => void }[] = [];
    const statuses: string[] = [];
    const store = new Map<string, string>();
    const a = createAutosave(e, {
      debounce: 5,
      save: (doc) => new Promise<void>((resolve) => saves.push({ doc, resolve })),
      onStatus: (s) => statuses.push(s),
      draftKey: 'd',
      draftStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    });
    e.commands.insertText('one');
    expect(a.status).toBe('dirty');
    expect(store.has('d')).toBe(true);
    await tick(20);
    expect(a.status).toBe('saving');
    expect(saves.length).toBe(1);
    // edit while the first save is in flight
    e.commands.insertText(' two');
    saves[0].resolve(); // late response for the older revision
    await tick(1);
    expect(a.status).toBe('dirty');
    expect(store.has('d')).toBe(true); // draft kept: newest edits are not saved yet
    await tick(20);
    expect(saves.length).toBe(2);
    expect(JSON.stringify(saves[1].doc)).toContain('one two');
    saves[1].resolve();
    await tick(1);
    expect(a.status).toBe('saved');
    expect(store.has('d')).toBe(false);
    expect(statuses).toEqual(['dirty', 'saving', 'dirty', 'saving', 'saved']);
    a.destroy();
  });

  it('reports errors and offline, retries, and recovers a local draft', async () => {
    const e = make([p('', 'a')]);
    let fail = true;
    let onlineNow = false;
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const a = createAutosave(e, { debounce: 1, retryDelays: [5], isOnline: () => onlineNow, draftKey: 'k', draftStorage: storage, save: async () => {
      if (fail) throw new Error('network');
    } });
    e.commands.insertText('draft text');
    await tick(15);
    expect(a.status).toBe('offline');
    onlineNow = true;
    await tick(15);
    expect(a.status).toBe('error');
    // simulate a crash: a new editor instance finds the draft
    const e2 = make([p('', 'a')]);
    const a2 = createAutosave(e2, { draftKey: 'k', draftStorage: storage, save: async () => {} });
    expect(a2.getDraft()).toBeTruthy();
    expect(a2.recoverDraft()).toBe(true);
    expect(texts(e2)).toBe('draft text');
    fail = false;
    expect(await a.retry()).toBe(true);
    expect(a.status).toBe('saved');
    a.destroy();
    a2.destroy();
  });
});

describe('uploads', () => {
  const file = (name: string, type = 'image/png') => ({ name, type, size: 10 }) as unknown as File;
  function setup() {
    const e = make([p('', 'a')]);
    const calls: { file: File; signal: AbortSignal; resolve: (u: string) => void; reject: (e: any) => void; onProgress: (n: number) => void }[] = [];
    const u = createUploads(e, {
      preview: (f) => 'blob:preview-' + f.name,
      revokePreview: () => {},
      upload: (f, { signal, onProgress }) => new Promise((resolve, reject) => calls.push({ file: f, signal, onProgress, resolve: (url) => resolve({ url }), reject })),
    });
    return { e, u, calls };
  }
  const images = (e: any) => [...e.doc.descendants()].filter((b: any) => b.type === 'image');

  it('inserts a placeholder and swaps in the final url without an undo step', async () => {
    const { e, u, calls } = setup();
    const [id] = u.uploadFiles([file('a.png')]);
    await tick();
    expect(images(e)[0].attrs).toMatchObject({ src: 'blob:preview-a.png', status: 'uploading', uploadId: id });
    calls[0].onProgress(0.5);
    expect(u.progress(id)).toBe(0.5);
    calls[0].resolve('https://cdn.example/a.png');
    await tick();
    expect(images(e)[0].attrs).toMatchObject({ src: 'https://cdn.example/a.png' });
    expect(images(e)[0].attrs.uploadId).toBeUndefined();
    expect(toHTML(e)).not.toContain('blob:');
    e.undo(); // undoes the insertion, not the url swap
    expect(images(e).length).toBe(0);
    e.redo(); // the placeholder comes back and is reconciled with the finished upload
    await tick();
    expect(images(e)[0].attrs).toMatchObject({ src: 'https://cdn.example/a.png' });
    u.destroy();
  });

  it('aborts when the image is deleted mid-upload and ignores the stale result', async () => {
    const { e, u, calls } = setup();
    u.uploadFiles([file('a.png')]);
    await tick();
    e.commands.deleteBlocks([images(e)[0].id]);
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].resolve('https://cdn.example/late.png');
    await tick();
    expect(images(e).length).toBe(0);
    expect(u.pending()).toEqual([]);
    // undo brings the placeholder back as a failed upload that can be retried
    e.undo();
    await tick();
    expect(images(e)[0].attrs.status).toBe('error');
    expect(u.retry(images(e)[0].attrs.uploadId)).toBe(true);
    await tick();
    calls[1].resolve('https://cdn.example/retry.png');
    await tick();
    expect(images(e)[0].attrs.src).toBe('https://cdn.example/retry.png');
    u.destroy();
  });

  it('marks failures and supports retry; non-images become file attachments', async () => {
    const { e, u, calls } = setup();
    const [id] = u.uploadFiles([file('doc.pdf', 'application/pdf')]);
    await tick();
    calls[0].reject(new Error('500'));
    await tick();
    const f = [...e.doc.descendants()].find((b) => b.type === 'file')!;
    expect(f.attrs).toMatchObject({ status: 'error', name: 'doc.pdf' });
    u.retry(id);
    await tick();
    calls[1].resolve('https://cdn.example/doc.pdf');
    await tick();
    expect(e.doc.get(f.id)!.attrs).toMatchObject({ url: 'https://cdn.example/doc.pdf', name: 'doc.pdf' });
    u.destroy();
  });
});

describe('latestRunner (typeahead)', () => {
  it('drops stale results and aborts superseded requests', async () => {
    const signals: AbortSignal[] = [];
    const run = latestRunner(async (q: string, signal) => {
      signals.push(signal);
      await tick(q === 'a' ? 30 : 5);
      return q.toUpperCase();
    });
    const first = run.run('a');
    const second = run.run('ab');
    expect(await second).toMatchObject({ stale: false, result: 'AB' });
    expect(await first).toMatchObject({ stale: true });
    expect(signals[0].aborted).toBe(true);
    const third = run.run('abc');
    run.cancel();
    expect((await third).stale).toBe(true);
  });
});

describe('find and replace', () => {
  it('finds, replaces one and replaces all in one undo step', () => {
    const e = make([p('Cat cat CAT concat', 'a'), p('cat', 'b')]);
    expect(findAll(e, 'cat').length).toBe(5);
    expect(findAll(e, 'cat', { caseSensitive: true }).length).toBe(3);
    expect(findAll(e, 'cat', { wholeWord: true }).length).toBe(4);
    expect(findAll(e, 'c.t', { regex: true, caseSensitive: true }).length).toBe(3);
    expect(findAll(e, '(', { regex: true })).toEqual([]);
    replaceMatch(e, findAll(e, 'cat')[0], 'cat', 'Dog');
    expect(texts(e)).toBe('Dog cat CAT concat|cat');
    expect(replaceAll(e, 'cat', 'x', { wholeWord: true })).toBe(3);
    expect(texts(e)).toBe('Dog x x concat|x');
    e.undo();
    expect(texts(e)).toBe('Dog cat CAT concat|cat');
  });
});

describe('pages', () => {
  it('converts to pages, adds, renames, moves, splits and removes pages; all undoable', () => {
    const e = make([p('one', 'a'), p('two', 'b'), p('three', 'c')]);
    const initial = e.getJSON();
    expect(getPages(e)).toEqual([]);
    caret(e, 'b', 3);
    expect(e.commands.insertPageBreak()).toBe(true); // not paged yet: inserts a page_break block
    expect(e.doc.blocks.map((b) => b.type)).toContain('page_break');
    e.undo();
    expect(e.commands.enablePages()).toBe(true);
    expect(getPages(e).length).toBe(1);
    expect(e.selection).toEqual(textSel('b', 3)); // caret survives the conversion
    e.commands.insertPageBreak(); // paged: splits the page after the caret block
    let pages = getPages(e);
    expect(pages.map((pg) => pg.children!.map((b) => b.id).join(','))).toEqual(['a,b', 'c']);
    expect(activePage(e)!.id).toBe(pages[1].id);
    e.commands.renamePage(pages[1].id, 'Appendix');
    e.commands.addPage('Notes');
    pages = getPages(e);
    expect(pages.map((pg) => pg.attrs.title)).toEqual(['Page 1', 'Appendix', 'Notes']);
    expect(activePage(e)!.attrs.title).toBe('Notes');
    e.commands.movePage(pages[2].id, 0);
    expect(getPages(e).map((pg) => pg.attrs.title)).toEqual(['Notes', 'Page 1', 'Appendix']);
    // selection cannot be merged across pages
    caret(e, 'c', 0);
    e.commands.deleteBackward();
    expect(e.doc.get('c')!.parent!.attrs.title).toBe('Appendix');
    // select all stays inside the page
    e.commands.selectAll();
    expect(e.selection).toEqual(textSel('c', 0, 'c', 5));
    expect(e.commands.setActivePage(getPages(e)[1].id)).toBe(true);
    expect((e.selection as any).focus.id).toBe('a');
    expect(e.commands.removePage(getPages(e)[0].id)).toBe(true);
    expect(getPages(e).length).toBe(2);
    checkInvariants(e);
    // serialization keeps pages
    const md = toMarkdown(e);
    expect(md).toContain('<!-- page: Appendix -->');
    expect(make(fromMarkdown(e, md)).getJSON().blocks.map((b) => [b.type, b.attrs?.title])).toEqual([['page', 'Page 1'], ['page', 'Appendix']]);
    expect(make(fromHTML(e, toHTML(e))).getJSON().blocks.map((b) => [b.type, b.attrs?.title])).toEqual([['page', 'Page 1'], ['page', 'Appendix']]);
    e.commands.disablePages();
    expect(e.doc.blocks.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    while (e.canUndo()) e.undo();
    expect(e.getJSON()).toEqual(initial);
  });

  it('wraps stray top-level blocks into pages (paste / remote edits)', () => {
    const e = make([{ id: 'pg', type: 'page', attrs: { title: 'P' }, children: [p('x', 'a')] }]);
    e.update((tr) => void tr.insert('root', 1, [p('stray', 's')]));
    expect(e.doc.blocks.length).toBe(1);
    expect(e.doc.get('s')!.parent!.id).toBe('pg');
    e.setSelection(blockSel(['pg']));
    checkInvariants(e);
  });
});

describe('extensions', () => {
  it('orders by dependency, reports conflicts and missing dependencies, and cleans up', () => {
    const order: string[] = [];
    const cleanup = vi.fn();
    const a: Extension = { name: 'a', requires: ['b'], setup: () => void order.push('a') };
    const b: Extension = { name: 'b', setup: () => { order.push('b'); return cleanup; } };
    const e = createHeadlessEditor({ extensions: [a, b] });
    expect(order).toEqual(['b', 'a']);
    e.destroy();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(e.listenerCount()).toBe(0);
    expect(() => createHeadlessEditor({ extensions: [{ name: 'x', requires: ['nope'] }] })).toThrow(/requires "nope"/);
    expect(() => createHeadlessEditor({ extensions: [{ name: 'x', nodes: [{ type: 'paragraph', kind: 'text' }] }] })).toThrow(/defined by both/);
    expect(() => createHeadlessEditor({ extensions: [{ name: 'x', apiVersion: 99 }] })).toThrow(/API v99/);
    expect(() => createHeadlessEditor({ extensions: [{ name: 'x', requires: ['y'] }, { name: 'y', requires: ['x'] }] })).toThrow(/circular/);
  });

  it('extends an existing node, overrides commands with priority-ordered keymaps', () => {
    const calls: string[] = [];
    const ext: Extension = {
      name: 'x',
      priority: 100,
      extendNode: { heading: (spec) => ({ ...spec, attrs: { ...spec.attrs, anchor: { default: '' } } }) },
      keymap: { 'Mod-b': () => { calls.push('x'); return true; } },
      commands: { hello: (ed, name: string) => ed.exec('insertText', 'hello ' + name) },
    };
    const e = createHeadlessEditor({ extensions: [ext], content: [{ id: 'h', type: 'heading', attrs: { level: 1 }, content: [] }] });
    expect(e.doc.get('h')!.attrs).toEqual({ level: 1, anchor: '' });
    expect(e.keymaps.filter((k) => k.key === 'Mod-b')[0].ext).toBe('x');
    expect(e.exec('hello', 'world')).toBe(true);
    expect(texts(e)).toBe('hello world');
    expect(e.exec('missing')).toBe(false);
  });

  it('hashtags and autolinks are detected while typing', () => {
    const e = make();
    for (const ch of 'see #topic and www.example.com now') e.commands.insertText(ch);
    const c = e.doc.get('a')!.content!;
    expect(c.find((x: any) => x.text === '#topic')!.marks).toEqual({ hashtag: true });
    expect(c.find((x: any) => x.text === 'www.example.com')!.marks).toEqual({ link: { href: 'https://www.example.com', title: '' } });
    checkInvariants(e);
  });
});
