import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { make, p, resetIds, caret, checkInvariants } from './helpers';
import { BlockChanges, createBlockSync, applyBlockChanges, SyncBatch, blockSel } from '../../src/core';

beforeEach(resetIds);

const collect = (e: ReturnType<typeof make>) => {
  const all: BlockChanges[] = [];
  e.on('blocks', (c) => all.push(c));
  return all;
};

describe('backend ids', () => {
  it('idGenerator names every new block; invalid or duplicate ids fall back', () => {
    let n = 100;
    const e = make([p('one', 'a')], { idGenerator: () => 'srv-' + n++ });
    caret(e, 'a', 3);
    e.commands.splitBlock();
    expect(e.doc.blocks.map((b) => b.id)).toEqual(['a', 'srv-100']);
    e.commands.insertDatabase('table', { at: { after: 'a' } });
    const db = e.doc.blocks.find((b) => b.type === 'database')!;
    expect(db.id).toMatch(/^srv-/);
    expect(db.children!.every((r) => r.id.startsWith('srv-'))).toBe(true);
    // loaded content keeps its ids (numbers and UUIDs are fine)
    const e2 = make([p('x', '42'), p('y', '3f2504e0-4f89-11d3-9a0c-0305e82c3301')], { idGenerator: () => 'a' });
    expect(e2.doc.blocks.map((b) => b.id)).toEqual(['42', '3f2504e0-4f89-11d3-9a0c-0305e82c3301']);
    // a generator returning a used / invalid id does not break the document
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    caret(e2, '42', 1);
    e2.commands.splitBlock();
    caret(e2, '42', 0);
    e2.commands.splitBlock();
    expect(new Set(e2.doc.blocks.map((b) => b.id)).size).toBe(4);
    checkInvariants(e2);
    warn.mockRestore();
  });

  it('remapIds renames blocks, their references, the selection and the undo history', () => {
    const e = make([p('first', 'a'), p('second', 'b')]);
    caret(e, 'b', 6);
    e.commands.insertText('!');
    e.commands.insertSyncedCopy?.('a', { after: 'b' });
    caret(e, 'b', 7);
    const remapped: any[] = [];
    e.on('ids:remapped', (x) => remapped.push(x.map));
    expect(e.remapIds({ a: 'doc-1', b: 'doc-2' })).toBe(true);
    expect(e.doc.blocks.map((b) => b.id).slice(0, 2)).toEqual(['doc-1', 'doc-2']);
    expect(e.doc.get('doc-2')!.text).toBe('second!');
    const synced = e.doc.blocks.find((b) => b.type === 'synced');
    if (synced) expect(JSON.stringify(synced.attrs)).toContain('doc-1');
    expect(e.selection).toMatchObject({ type: 'text', focus: { id: 'doc-2' } });
    expect(remapped).toEqual([{ a: 'doc-1', b: 'doc-2' }]);
    // undo still works on the renamed blocks
    e.commands.undo();
    e.commands.undo();
    expect(e.doc.get('doc-2')!.text).toBe('second');
    checkInvariants(e);
    // refused: unknown block, invalid id, id already used
    expect(e.remapIds({ nope: 'x' })).toBe(false);
    expect(e.remapIds({ 'doc-1': 'has space' })).toBe(false);
    expect(e.remapIds({ 'doc-1': 'doc-2' })).toBe(false);
  });
});

describe('block events', () => {
  it('reports created, updated, deleted, moved with positions', () => {
    const e = make([p('one', 'a'), p('two', 'b'), p('three', 'c')]);
    const all = collect(e);
    const created: any[] = [];
    e.on('block:created', (x) => created.push(x));
    caret(e, 'a', 3);
    e.commands.splitBlock();
    expect(all.at(-1)!.created).toHaveLength(1);
    expect(created[0]).toMatchObject({ type: 'paragraph', parentId: null, index: 1, afterId: 'a', origin: 'local' });
    const newId = created[0].id;
    // typing is an update of that block only
    caret(e, newId, 0);
    e.commands.insertText('x');
    expect(all.at(-1)!.updated.map((u) => [u.id, u.changes])).toEqual([[newId, ['content']]]);
    // type change
    e.commands.setBlockType('heading', { level: 2 }, ['b']);
    const u = all.at(-1)!.updated[0];
    expect(u).toMatchObject({ id: 'b', type: 'heading', typeBefore: 'paragraph', changes: ['type', 'attrs'] });
    // move
    e.update((tr) => void tr.move(['c'], 'root', 0));
    expect(all.at(-1)!.moved).toEqual([{ id: 'c', type: 'paragraph', from: { parentId: null, index: 3 }, to: { parentId: null, index: 0, afterId: null } }]);
    expect(all.at(-1)!.created).toEqual([]);
    expect(all.at(-1)!.deleted).toEqual([]);
    // delete
    e.update((tr) => void tr.remove('a'));
    expect(all.at(-1)!.deleted).toMatchObject([{ id: 'a', parentId: null, index: 1, json: { id: 'a', content: [{ text: 'one' }] }, ids: ['a'] }]);
    // created and deleted in one transaction: nothing to report
    const before = all.length;
    e.update((tr) => {
      tr.insert('root', 0, [p('tmp', 'tmp')]);
      tr.remove('tmp');
    });
    expect(all.length).toBe(before);
    // origin is passed through
    e.update((tr) => void tr.replaceText('b', 0, 0, 'R'), { origin: 'remote' });
    expect(all.at(-1)!.origin).toBe('remote');
  });

  it('check-list items fire completed / uncompleted; database cells are listed', () => {
    const e = make([{ id: 't', type: 'list', attrs: { kind: 'check', checked: false }, content: [{ text: 'task' }] }]);
    const done: string[] = [];
    e.on('block:completed', (x) => done.push('done:' + x.id));
    e.on('block:uncompleted', (x) => done.push('undone:' + x.id));
    caret(e, 't', 0);
    e.commands.toggleCheck();
    e.commands.toggleCheck();
    expect(done).toEqual(['done:t', 'undone:t']);

    e.commands.insertDatabase('table', { properties: [{ name: 'Name', type: 'title' }, { name: 'Done', type: 'checkbox' }], rows: [{ Name: 'Row' }], at: { after: 't' } });
    const db = e.doc.blocks.find((b) => b.type === 'database')!;
    const row = db.children![0];
    const doneProp = db.attrs.properties[1].id;
    const cells: any[] = [];
    e.on('block:updated', (x) => x.type === 'db_row' && cells.push(x.cells));
    e.commands.dbSetCell(row.id, doneProp, true);
    expect(cells).toEqual([[doneProp]]);
  });

  it('block:focus follows the caret', () => {
    const e = make([p('one', 'a'), p('two', 'b')]);
    const seen: any[] = [];
    e.on('block:focus', (x) => seen.push(x));
    caret(e, 'b', 1);
    caret(e, 'b', 2);
    e.setSelection(blockSel(['a']));
    expect(seen).toEqual([{ id: 'b', previous: 'a' }, { id: 'a', previous: 'b' }]);
    expect(e.activeBlockId).toBe('a');
  });

  it('no summary work without listeners', () => {
    const e = make([p('one', 'a')]);
    caret(e, 'a', 3);
    expect(() => e.commands.insertText('!')).not.toThrow();
  });
});

describe('createBlockSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('batches changes after a pause, retries failures, applies server ids', async () => {
    const e = make([p('one', 'a'), p('two', 'b')]);
    const batches: SyncBatch[] = [];
    let fail = 1;
    const statuses: string[] = [];
    const sync = createBlockSync(e, {
      delay: 500,
      onStatus: (s) => statuses.push(s),
      push: async (b) => {
        batches.push(JSON.parse(JSON.stringify(b)));
        if (fail-- > 0) throw new Error('offline');
        const tmp = b.upserted.find((x) => x.id !== 'a' && x.id !== 'b');
        return tmp ? { ids: { [tmp.id]: 'server-9' } } : undefined;
      },
    });
    caret(e, 'a', 3);
    e.commands.insertText('!');
    e.commands.splitBlock();
    e.commands.insertText('new');
    expect(sync.pending).toBe(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(batches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(batches).toHaveLength(1);
    const b1 = batches[0];
    expect(b1.upserted.map((x) => x.id)[0]).toBe('a');
    expect(b1.upserted[1]).toMatchObject({ type: 'paragraph', parentId: null, index: 1, afterId: 'a', content: [{ text: 'new' }] });
    expect(b1.order).toEqual([{ parentId: null, children: ['a', b1.upserted[1].id, 'b'] }]);
    expect(statuses).toContain('error');
    // retried after back-off; the server id is applied
    await vi.advanceTimersByTimeAsync(1100);
    expect(batches).toHaveLength(2);
    expect(e.doc.blocks.map((x) => x.id)).toEqual(['a', 'server-9', 'b']);
    expect(sync.status).toBe('idle');
    // delete is sent as an id; remote changes are not echoed
    e.update((tr) => void tr.remove('b'));
    applyBlockChanges(e, { upserted: [{ id: 'r1', type: 'paragraph', parentId: null, index: 0, afterId: null, content: [{ text: 'from server' }] }] });
    await sync.flush();
    expect(batches[2]).toEqual({ upserted: [], deleted: ['b'], order: [{ parentId: null, children: ['r1', 'a', 'server-9'] }] });
    expect(e.doc.blocks.map((x) => x.id)).toEqual(['r1', 'a', 'server-9']);
    sync.destroy();
  });

  it('applyBlockChanges creates, updates, moves, reorders and deletes', () => {
    const e = make([p('one', 'a'), p('two', 'b'), p('three', 'c')]);
    applyBlockChanges(e, {
      deleted: ['b'],
      upserted: [
        { id: 'a', type: 'heading', parentId: null, index: 0, afterId: null, attrs: { level: 1 }, content: [{ text: 'Title' }] },
        { id: 'n', type: 'paragraph', parentId: null, index: 1, afterId: 'a', content: [{ text: 'new' }] },
      ],
      order: [{ parentId: null, children: ['c', 'a', 'n'] }],
    });
    expect(e.doc.blocks.map((b) => [b.id, b.type, b.text])).toEqual([['c', 'paragraph', 'three'], ['a', 'heading', 'Title'], ['n', 'paragraph', 'new']]);
    checkInvariants(e);
    // not an undo step
    expect(e.history.canUndo()).toBe(false);
  });
});
