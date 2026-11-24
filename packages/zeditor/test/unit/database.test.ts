import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { make, p, resetIds, checkInvariants, caret, texts } from './helpers';
import { Editor, queryDatabase, dbProperties, dbRows, dbViews, toHTML, toMarkdown, fromHTML, createDatabase, getPages, tocEntries, renderToHTML, blockSel } from '../../src/core';
import { createCollab, connectSync, memoryHub } from '../../src/collab';

beforeEach(resetIds);

const TASKS = {
  title: 'Tasks',
  properties: [
    { name: 'Name', type: 'title' as const },
    { name: 'Status', type: 'select' as const, options: [{ id: 'todo', name: 'To do', color: 'gray' as const }, { id: 'doing', name: 'Doing', color: 'blue' as const }, { id: 'done', name: 'Done', color: 'green' as const }] },
    { name: 'Points', type: 'number' as const },
    { name: 'Tags', type: 'multi_select' as const, options: [{ id: 'ui', name: 'UI', color: 'pink' as const }, { id: 'api', name: 'API', color: 'purple' as const }] },
    { name: 'Shipped', type: 'checkbox' as const },
    { name: 'Due', type: 'date' as const },
  ],
  rows: [
    { Name: 'Design', Status: 'Done', Points: 3, Tags: ['UI'], Shipped: true, Due: '2026-01-10' },
    { Name: 'Build API', Status: 'Doing', Points: 8, Tags: ['API'], Due: '2026-02-01' },
    { Name: 'Write docs', Status: 'To do', Points: 2 },
    { Name: 'Polish', Status: 'Doing', Points: 5, Tags: ['UI', 'API'] },
    { Name: 'Backlog idea' },
  ],
};
function setup(): { e: Editor; id: string; prop: (name: string) => string; names: (viewId?: string) => string[] } {
  const e = make([p('intro', 'a')]);
  e.commands.insertDatabase('table', { ...TASKS, at: { after: 'a' } });
  const db = e.doc.blocks.find((b) => b.type === 'database')!;
  const prop = (name: string) => dbProperties(e.doc.get(db.id)!).find((x) => x.name === name)!.id;
  const names = (viewId?: string) => queryDatabase(e.doc.get(db.id)!, viewId).rows.map((r) => r.attrs.cells.title ?? '');
  return { e, id: db.id, prop, names };
}

describe('database model', () => {
  it('creates a database whose rows are blocks with page content', () => {
    const { e, id } = setup();
    const db = e.doc.get(id)!;
    expect(dbProperties(db).map((x) => x.type)).toEqual(['title', 'select', 'number', 'multi_select', 'checkbox', 'date']);
    expect(dbRows(db).length).toBe(5);
    expect(dbRows(db)[0].children![0].type).toBe('paragraph'); // every row is a page
    checkInvariants(e);
    // the row's page content is ordinary editable content
    const page = dbRows(db)[1].children![0];
    caret(e, page.id, 0);
    e.commands.insertText('Notes for the API');
    e.commands.toggleBlockType('list', { kind: 'check' });
    expect(e.doc.get(page.id)!.type).toBe('list');
    // selection cannot leak out of a row
    e.commands.selectAll();
    expect(e.selection).toMatchObject({ anchor: { id: page.id, offset: 0 }, focus: { id: page.id } });
    e.commands.deleteBackward();
    e.commands.deleteBackward();
    e.commands.deleteBackward();
    expect(dbRows(e.doc.get(id)!).length).toBe(5);
    checkInvariants(e);
  });

  it('sorts, filters, groups and calculates', () => {
    const { e, id, prop, names } = setup();
    expect(names()).toEqual(['Design', 'Build API', 'Write docs', 'Polish', 'Backlog idea']);
    e.commands.dbSort(id, prop('Points'), 'desc');
    expect(names()).toEqual(['Build API', 'Polish', 'Design', 'Write docs', 'Backlog idea']); // empty values last
    e.commands.dbSort(id, prop('Status'), 'asc'); // option order, not alphabetical
    expect(names()).toEqual(['Write docs', 'Build API', 'Polish', 'Design', 'Backlog idea']);
    e.commands.dbSort(id, null);
    e.commands.dbFilter(id, [{ prop: prop('Status'), op: 'is', value: 'doing' }]);
    expect(names()).toEqual(['Build API', 'Polish']);
    e.commands.dbFilter(id, [{ prop: prop('Tags'), op: 'contains', value: 'ui' }, { prop: prop('Points'), op: 'gt', value: '3' }]);
    expect(names()).toEqual(['Polish']);
    e.commands.dbFilter(id, [{ prop: prop('Shipped'), op: 'unchecked' }, { prop: prop('Due'), op: 'not_empty' }]);
    expect(names()).toEqual(['Build API']);
    e.commands.dbFilter(id, null);
    e.commands.dbCalculate(id, prop('Points'), 'sum');
    e.commands.dbCalculate(id, prop('Shipped'), 'percent_checked');
    e.commands.dbCalculate(id, 'title', 'count');
    const res = queryDatabase(e.doc.get(id)!);
    expect(res.calc).toEqual({ [prop('Points')]: '18', [prop('Shipped')]: '20%', title: '5' });
    // board view groups by the first select property
    e.commands.dbAddView(id, 'board');
    const board = queryDatabase(e.doc.get(id)!);
    expect(board.view.type).toBe('board');
    expect(board.groups!.map((g) => [g.option?.name ?? null, g.rows.length])).toEqual([[null, 1], ['To do', 1], ['Doing', 2], ['Done', 1]]);
    // views keep independent settings
    expect(dbViews(e.doc.get(id)!).length).toBe(2);
    expect(queryDatabase(e.doc.get(id)!, 'v1').calc.title).toBe('5');
    expect(board.calc).toEqual({});
  });

  it('edits cells with type coercion; every change is undoable', () => {
    const { e, id, prop } = setup();
    const row = dbRows(e.doc.get(id)!)[2];
    const before = e.getJSON();
    e.commands.dbSetCell(row.id, prop('Points'), '13');
    e.commands.dbSetCell(row.id, prop('Status'), 'done');
    e.commands.dbSetCell(row.id, prop('Tags'), ['ui', 'nope']);
    e.commands.dbSetCell(row.id, prop('Shipped'), true);
    e.commands.dbSetCell(row.id, prop('Due'), 'not a date');
    expect(e.doc.get(row.id)!.attrs.cells).toEqual({ title: 'Write docs', [prop('Points')]: 13, [prop('Status')]: 'done', [prop('Tags')]: ['ui'], [prop('Shipped')]: true });
    expect(e.commands.dbSetCell(row.id, prop('Status'), 'bogus')).toBe(true);
    expect(e.doc.get(row.id)!.attrs.cells[prop('Status')]).toBeUndefined();
    // options can be created on the fly
    e.commands.dbAddOption(id, prop('Status'), 'Blocked');
    e.commands.dbSetCell(row.id, prop('Status'), e.storage.db.lastOption);
    expect(queryDatabase(e.doc.get(id)!).properties[1].options!.map((o) => o.name)).toEqual(['To do', 'Doing', 'Done', 'Blocked']);
    // rows
    e.commands.dbAddRow(id, { title: 'New row' });
    e.commands.dbDuplicateRow(row.id);
    e.commands.dbDeleteRow(dbRows(e.doc.get(id)!)[0].id);
    expect(dbRows(e.doc.get(id)!).map((r) => r.attrs.cells.title)).toEqual(['Build API', 'Write docs', 'Write docs', 'Polish', 'Backlog idea', 'New row']);
    checkInvariants(e);
    while (e.canUndo()) e.undo();
    expect(e.getJSON().blocks.length).toBe(1);
    void before;
  });

  it('adds, converts and deletes properties', () => {
    const { e, id, prop } = setup();
    e.commands.dbAddProperty(id, { name: 'Owner', type: 'text' });
    const owner = prop('Owner');
    const rows = dbRows(e.doc.get(id)!);
    e.commands.dbSetCell(rows[0].id, owner, 'Ada');
    e.commands.dbSetCell(rows[1].id, owner, 'Bob, Ada');
    // text -> multi-select turns existing values into options
    e.commands.dbUpdateProperty(id, owner, { type: 'multi_select' });
    const converted = dbProperties(e.doc.get(id)!).find((x) => x.id === owner)!;
    expect(converted.options!.map((o) => o.name)).toEqual(['Ada', 'Bob']);
    expect(queryDatabase(e.doc.get(id)!).rows.slice(0, 2).map((r) => r.attrs.cells[owner].length)).toEqual([1, 2]);
    // the title property cannot be removed or retyped
    expect(e.commands.dbDeleteProperty(id, 'title')).toBe(false);
    e.commands.dbUpdateProperty(id, 'title', { type: 'number' as any, name: 'Task' });
    expect(dbProperties(e.doc.get(id)!)[0]).toMatchObject({ type: 'title', name: 'Task' });
    // deleting a property cleans cells and view settings that referenced it
    e.commands.dbSort(id, owner, 'asc');
    e.commands.dbDeleteProperty(id, owner);
    expect(dbProperties(e.doc.get(id)!).some((x) => x.id === owner)).toBe(false);
    expect(dbViews(e.doc.get(id)!)[0].sorts).toBeUndefined();
    expect(dbRows(e.doc.get(id)!).every((r) => !(owner in r.attrs.cells))).toBe(true);
    e.undo();
    expect(dbProperties(e.doc.get(id)!).some((x) => x.id === owner)).toBe(true);
    checkInvariants(e);
  });

  it('sanitizes hostile database documents', () => {
    const e = make([
      {
        id: 'd',
        type: 'database',
        attrs: {
          title: 42,
          properties: [{ id: 'x', name: 'A', type: 'evil' }, { id: 'x', name: 'dup' }, { id: '<bad id>', name: 'B' }, { id: 't2', type: 'title' }, { id: 's', type: 'select', options: [{ id: 'o', name: 'O', color: 'url(javascript:1)' }, null] }],
          views: [{ id: 'v', type: 'pivot', filters: [{ prop: 'x', op: 'drop table' }], calc: { x: 'eval', __proto__: 'sum' } }, 'nope'],
          view: { toString: 1 },
        },
        children: [{ id: 'r', type: 'db_row', attrs: { cells: { x: { nested: true }, s: 'o', '<k>': 1, t2: 'Title' } }, children: [] }, { id: 'pp', type: 'paragraph', content: [] } as any],
      } as any,
    ]);
    const db = e.doc.get('d')!;
    expect(db.attrs.title).toBe('');
    expect(dbProperties(db)).toEqual([{ id: 't2', name: 'Property', type: 'title' }, { id: 'x', name: 'A', type: 'text' }, { id: 's', name: 'Property', type: 'select', options: [{ id: 'o', name: 'O', color: 'gray' }] }]);
    expect(dbViews(db)).toEqual([{ id: 'v', name: 'View', type: 'table', filters: [{ prop: 'x', op: 'contains', value: '' }] }]);
    expect(db.children!.map((c) => c.type)).toEqual(['db_row']); // stray paragraph dropped
    expect(db.children![0].attrs.cells).toEqual({ s: 'o', t2: 'Title' });
    expect(db.children![0].children!.length).toBe(1);
    expect(() => queryDatabase(db)).not.toThrow();
    checkInvariants(e);
  });

  it('exports a crawlable table, round-trips losslessly through HTML and JSON, and degrades to a table in Markdown', () => {
    const { e, id } = setup();
    const html = toHTML(e);
    expect(html).toContain('<caption>Tasks</caption>');
    expect(html).toContain('<th scope="col">Status</th>');
    expect(html).toContain('<th scope="row">Build API</th><td>Doing</td><td>8</td><td>API</td>');
    expect(html).toContain('<time datetime="2026-02-01">');
    const back = make(fromHTML(e, html));
    expect(back.getJSON().blocks[1]).toEqual(e.getJSON().blocks[1]);
    expect(make(JSON.parse(JSON.stringify(e.getJSON())).blocks).getJSON()).toEqual(e.getJSON());
    const md = toMarkdown(e);
    expect(md).toContain('| Name | Status | Points | Tags | Shipped | Due |');
    expect(md).toContain('| Polish | Doing | 5 | UI, API |  |  |');
    // static rendering for SEO works without the DOM
    expect(renderToHTML(e.getJSON())).toContain('<th scope="row">Design</th>');
    void id;
  });

  it('opening a document without the database feature keeps it intact', () => {
    const { e } = setup();
    const saved = e.getJSON();
    const bare = make(JSON.parse(JSON.stringify(saved)).blocks, { features: { database: false } });
    expect(bare.doc.blocks[1].type).toBe('unknown');
    caret(bare, 'a', 5);
    bare.commands.insertText('!');
    expect(bare.getJSON().blocks[1]).toEqual(saved.blocks[1]);
  });

  it('concurrent edits to different rows and to the schema merge', async () => {
    const flush = async () => {
      for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
    };
    const hub = memoryHub();
    const mk = (seed: boolean, content?: any[]) => {
      const doc = new Y.Doc();
      const e = make(content ?? [p('', 'seed')]);
      const c = createCollab(e, { doc, user: { id: 'u' + doc.clientID, name: 'u' }, seed });
      const t = hub.endpoint();
      connectSync(doc, c.awareness, t);
      t.connect();
      return { e, t };
    };
    const base = make([p('x', 'a')]);
    const dbJson = createDatabase(base, TASKS);
    const A = mk(true, [p('x', 'a'), dbJson]);
    await flush();
    const B = mk(false);
    await flush();
    expect(B.e.getJSON().blocks).toEqual(A.e.getJSON().blocks);
    const rowsA = dbRows(A.e.doc.get(dbJson.id)!);
    const points = dbProperties(A.e.doc.get(dbJson.id)!)[2].id;
    B.t.disconnect();
    A.e.commands.dbSetCell(rowsA[0].id, points, 100); // A edits row 1
    B.e.commands.dbSetCell(rowsA[1].id, 'title', 'Renamed offline'); // B edits row 2
    B.e.commands.dbAddRow(dbJson.id, { title: 'Added by B' }); // and adds a row
    A.e.commands.dbAddView(dbJson.id, 'board'); // A changes the schema
    B.t.connect();
    await flush();
    expect(B.e.getJSON().blocks).toEqual(A.e.getJSON().blocks);
    const merged = A.e.doc.get(dbJson.id)!;
    expect(dbRows(merged).map((r) => r.attrs.cells.title)).toEqual(['Design', 'Renamed offline', 'Write docs', 'Polish', 'Backlog idea', 'Added by B']);
    expect(dbRows(merged)[0].attrs.cells[points]).toBe(100);
    expect(dbViews(merged).length).toBe(2);
    checkInvariants(A.e);
    checkInvariants(B.e);
  });
});

describe('workspace blocks', () => {
  it('table of contents lists the headings of its page', () => {
    const e = make([{ id: 'h1', type: 'heading', attrs: { level: 1 }, content: [{ text: 'One' }] }, { id: 't', type: 'toc' }, p('x', 'a'), { id: 'h2', type: 'heading', attrs: { level: 2 }, content: [{ text: 'Two' }] }]);
    expect(tocEntries(e, 't').map((h) => h.text)).toEqual(['One', 'Two']);
    caret(e, 'a', 1);
    e.commands.insertPageBreak(); // not paged: inserts a break block
    e.undo();
    e.commands.enablePages();
    caret(e, 'a', 1);
    e.commands.insertPageBreak(); // paged: splits; "Two" is now on page 2
    expect(tocEntries(e, 't').map((h) => h.text)).toEqual(['One']);
    expect(toHTML(e)).toContain('<nav data-toc="">');
  });

  it('bookmarks resolve previews through the host adapter and ignore stale answers', async () => {
    const e = make([p('', 'a')]);
    const calls: { url: string; resolve: (m: any) => void; signal: AbortSignal }[] = [];
    e.storage.linkPreview = (url: string, { signal }: { signal: AbortSignal }) => new Promise((resolve) => calls.push({ url, resolve, signal }));
    expect(e.commands.insertBookmark('javascript:alert(1)')).toBe(false);
    expect(e.commands.insertBookmark('https://example.com/a')).toBe(true);
    expect(e.commands.insertBookmark('https://example.com/b')).toBe(true);
    await Promise.resolve();
    const marks = e.doc.blocks.filter((b) => b.type === 'bookmark');
    expect(marks.length).toBe(2);
    const undoDepth = (e as any).builtinHistory.undoStack.length;
    e.commands.deleteBlocks([marks[0].id]); // removed before its preview arrives
    calls[0].resolve({ title: 'Stale', image: 'https://example.com/i.png' });
    calls[1].resolve({ title: 'Example B', description: 'Desc', image: 'javascript:alert(1)', site: 'Example' });
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.stringify(e.getJSON())).not.toContain('Stale');
    expect(e.doc.get(marks[1].id)!.attrs).toEqual({ url: 'https://example.com/b', title: 'Example B', description: 'Desc', image: '', site: 'Example' });
    // the preview is not an undo step
    expect((e as any).builtinHistory.undoStack.length).toBe(undoDepth + 1);
    const html = toHTML(e);
    expect(make(fromHTML(e, html)).getJSON().blocks.find((b) => b.type === 'bookmark')!.attrs).toMatchObject({ title: 'Example B', url: 'https://example.com/b' });
  });

  it('template buttons store blocks and insert fresh copies', () => {
    const e = make([{ id: 'h', type: 'heading', attrs: { level: 3 }, content: [{ text: 'Standup' }] }, { id: 'c', type: 'list', attrs: { kind: 'check', checked: true }, content: [{ text: 'Yesterday' }] }, p('end', 'z')]);
    e.setSelection(blockSel(['h', 'c']));
    expect(e.commands.saveAsTemplate()).toBe(true);
    const btn = e.doc.blocks.find((b) => b.type === 'template_button')!;
    expect(btn.attrs.label).toBe('New Standup');
    expect(e.commands.useTemplate(btn.id)).toBe(true);
    expect(e.commands.useTemplate(btn.id)).toBe(true);
    expect(texts(e)).toBe('Standup|Yesterday|Standup|Yesterday|Standup|Yesterday|end');
    const ids = [...e.doc.descendants()].map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length); // copies get new ids
    checkInvariants(e);
    // a stored template is untrusted data: hostile content is sanitized when used
    e.commands.setBlockAttrs(btn.id, { blocks: [{ id: 'x', type: 'paragraph', content: [{ text: 'l', marks: { link: { href: 'javascript:alert(1)' } } }] }] });
    e.commands.useTemplate(btn.id);
    expect(JSON.stringify(e.getJSON().blocks.filter((b) => b.type !== 'template_button'))).not.toContain('javascript');
    const round = make(JSON.parse(JSON.stringify(e.getJSON())).blocks);
    expect(round.getJSON()).toEqual(e.getJSON());
  });

  it('page links follow page renames; dates and toggle headings', () => {
    const e = make([p('see ', 'a')]);
    e.commands.enablePages();
    e.commands.addPage('Specs');
    const [first, specs] = getPages(e);
    e.commands.setActivePage(first.id);
    caret(e, 'a', 4);
    expect(e.commands.insertPageLink(specs.id)).toBe(true);
    expect(e.doc.get('a')!.content![1]).toEqual({ atom: 'page_link', attrs: { page: specs.id, title: 'Specs' } });
    e.commands.renamePage(specs.id, 'Specification');
    expect((e.doc.get('a')!.content![1] as any).attrs.title).toBe('Specification');
    expect(toMarkdown(e)).toContain(`[Specification](#${specs.id})`);
    e.commands.insertDate('2026-12-24');
    expect(e.doc.get('a')!.content!.some((c: any) => c.atom === 'date' && c.attrs.date === '2026-12-24')).toBe(true);
    expect(toHTML(e)).toContain('<time datetime="2026-12-24">');
    expect(e.commands.insertDate('tomorrow-ish')).toBe(true); // falls back to today
    e.commands.setToggleLevel(2, 'a');
    expect(e.doc.get('a')).toMatchObject({ type: 'toggle', attrs: { open: true, level: 2 } });
    checkInvariants(e);
  });
});
