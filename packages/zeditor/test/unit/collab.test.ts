import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { make, p, resetIds, checkInvariants, caret, texts, mulberry } from './helpers';
import { createCollab, connectSync, memoryHub, yCommentStore, Collab, SyncHandle, Transport, persistDoc } from '../../src/collab';
import { Editor, createComments, createTable, textSel, blockSel } from '../../src/core';

beforeEach(resetIds);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

interface Client {
  e: Editor;
  c: Collab;
  s: SyncHandle;
  t: Transport;
  doc: Y.Doc;
}
function client(hub: ReturnType<typeof memoryHub>, name: string, opts: { seed?: boolean; content?: any[] } = {}): Client {
  const doc = new Y.Doc();
  const e = make(opts.content ?? [p('', 'seed')]);
  const c = createCollab(e, { doc, user: { id: name, name }, seed: opts.seed });
  const t = hub.endpoint();
  const s = connectSync(doc, c.awareness, t);
  t.connect();
  return { e, c, s, t, doc };
}
async function pair(content: any[] = [p('hello world', 'a')]) {
  const hub = memoryHub();
  const A = client(hub, 'ann', { seed: true, content });
  await flush();
  const B = client(hub, 'bob');
  await flush();
  return { hub, A, B };
}
const same = (A: Client, B: Client) => expect(B.e.getJSON().blocks).toEqual(A.e.getJSON().blocks);

describe('collaboration', () => {
  it('a second client receives the document; concurrent edits to one paragraph merge', async () => {
    const { A, B } = await pair();
    same(A, B);
    expect(texts(B.e)).toBe('hello world');
    caret(A.e, 'a', 0);
    caret(B.e, 'a', 11);
    A.e.commands.insertText('>> ');
    B.e.commands.insertText('!');
    await flush();
    expect(texts(A.e)).toBe('>> hello world!');
    same(A, B);
    // remote edits keep the local caret where the user left it
    expect(A.e.selection).toEqual(textSel('a', 3));
    expect(B.e.selection).toEqual(textSel('a', 15));
    checkInvariants(A.e);
    checkInvariants(B.e);
  });

  it('formatting, block structure, lists and tables replicate', async () => {
    const { A, B } = await pair([p('one two', 'a'), p('three', 'b')]);
    caret(A.e, 'a', 0, 'a', 3);
    A.e.commands.toggleMark('bold');
    caret(B.e, 'b', 5);
    B.e.commands.splitBlock();
    B.e.commands.insertText('four');
    B.e.commands.setBlockType('list', { kind: 'check', checked: true });
    await flush();
    same(A, B);
    expect(A.e.doc.get('a')!.content![0]).toEqual({ text: 'one', marks: { bold: true } });
    A.e.commands.insertBlocks([createTable(A.e, 2, 2, true, (r, c) => `${r}${c}`)], { after: 'b' });
    await flush();
    same(A, B);
    // B edits inside the table A created, A moves a block
    const cellPara = [...B.e.doc.descendants()].find((x) => x.text === '11')!;
    caret(B.e, cellPara.id, 2);
    B.e.commands.insertText('!');
    A.e.commands.moveBlocksTo(['a'], 'b', 'after');
    await flush();
    same(A, B);
    expect(texts(A.e)).toContain('11!');
    expect(A.e.doc.blocks.map((x) => x.id).slice(0, 2)).toEqual(['b', 'a']);
    checkInvariants(A.e);
    checkInvariants(B.e);
  });

  it('offline edits merge on reconnect', async () => {
    const { A, B } = await pair([p('shared', 'a'), p('second', 'b')]);
    B.t.disconnect();
    caret(B.e, 'b', 6);
    B.e.commands.insertText(' (offline B)');
    B.e.commands.splitBlock();
    B.e.commands.insertText('new block from B');
    caret(A.e, 'a', 6);
    A.e.commands.insertText(' (online A)');
    await flush();
    expect(texts(A.e)).toBe('shared (online A)|second');
    expect(B.s.connected).toBe(false);
    B.t.connect();
    await flush();
    same(A, B);
    expect(texts(A.e)).toBe('shared (online A)|second (offline B)|new block from B');
    expect(B.s.synced).toBe(true);
  });

  it("undo only reverts the local user's edits and keeps the other author's", async () => {
    const { A, B } = await pair([p('base', 'a')]);
    caret(A.e, 'a', 4);
    A.e.commands.insertText(' AAA');
    await flush();
    caret(B.e, 'a', 0);
    B.e.commands.insertText('BBB ');
    await flush();
    expect(texts(A.e)).toBe('BBB base AAA');
    expect(A.e.canUndo()).toBe(true);
    A.e.undo();
    await flush();
    expect(texts(A.e)).toBe('BBB base');
    same(A, B);
    A.e.redo();
    await flush();
    expect(texts(B.e)).toBe('BBB base AAA');
    // B's undo removes only B's text
    B.e.undo();
    await flush();
    expect(texts(A.e)).toBe('base AAA');
    same(A, B);
    expect(A.e.canUndo()).toBe(true);
  });

  it('presence: remote users and selections are visible and cleared on disconnect', async () => {
    const { A, B } = await pair();
    caret(B.e, 'a', 2, 'a', 5);
    await flush();
    const seen = A.c.remoteStates();
    expect(seen.length).toBe(1);
    expect(seen[0].user.name).toBe('bob');
    expect(seen[0].selection).toEqual(textSel('a', 2, 'a', 5));
    B.s.disconnect();
    await flush();
    expect(A.c.remoteStates()).toEqual([]);
    B.s.connect();
    await flush();
    expect(A.c.remoteStates().length).toBe(1);
  });

  it('comment threads are shared and their anchors survive remote edits', async () => {
    const { A, B } = await pair([p('some commented text', 'a')]);
    const ca = createComments(A.e, { user: { id: 'ann', name: 'Ann' }, store: yCommentStore(A.doc) });
    const cb = createComments(B.e, { user: { id: 'bob', name: 'Bob' }, store: yCommentStore(B.doc) });
    caret(A.e, 'a', 5, 'a', 14);
    const t = ca.addThread('please check')!;
    await flush();
    expect(cb.threads().map((x) => [x.quote, x.anchored])).toEqual([['commented', true]]);
    caret(B.e, 'a', 0);
    B.e.commands.insertText('XX ');
    cb.reply(t.id, 'done');
    await flush();
    expect(ca.anchors(t.id)).toEqual([{ id: 'a', from: 8, to: 17 }]);
    expect(ca.threads()[0].comments.map((c) => c.body)).toEqual(['please check', 'done']);
    same(A, B);
  });

  it('concurrent table shape edits converge and are repaired on the next local edit', async () => {
    const hub = memoryHub();
    const A = client(hub, 'ann', { seed: true, content: [p('x', 'a')] });
    await flush();
    A.e.commands.insertBlocks([createTable(A.e, 2, 2, false)], { after: 'a' });
    const B = client(hub, 'bob');
    await flush();
    same(A, B);
    const firstCell = (e: Editor) => [...e.doc.descendants()].find((x) => x.type === 'table_cell')!;
    const para = (e: Editor) => firstCell(e).children![0];
    B.t.disconnect();
    caret(A.e, para(A.e).id, 0);
    A.e.commands.addRow('after'); // 3 rows x 2 cols
    caret(B.e, para(B.e).id, 0);
    B.e.commands.addColumn('after'); // 2 rows x 3 cols
    B.t.connect();
    await flush();
    same(A, B);
    const table = [...A.e.doc.descendants()].find((x) => x.type === 'table')!;
    const widths = table.children!.map((r) => r.children!.length);
    expect(widths).toEqual([3, 2, 3]); // ragged: the new row predates the new column
    checkInvariants(A.e);
    caret(A.e, para(A.e).id, 0);
    A.e.commands.addColumn('before');
    await flush();
    same(A, B);
    expect([...B.e.doc.descendants()].find((x) => x.type === 'table')!.children!.map((r) => r.children!.length)).toEqual([4, 4, 4]);
  });

  it('deleting everything remotely keeps both documents valid and in sync', async () => {
    const { A, B } = await pair([p('one', 'a'), p('two', 'b')]);
    A.e.setSelection(blockSel(['a', 'b']));
    A.e.commands.deleteBlocks();
    await flush();
    same(A, B);
    checkInvariants(B.e);
    B.e.commands.insertText('still works');
    await flush();
    same(A, B);
    expect(texts(A.e)).toBe('still works');
  });

  it('persists the shared document for offline reloads', async () => {
    const store = new Map<string, Uint8Array>();
    const persistence = { load: () => store.get('k') ?? null, save: (s: Uint8Array) => void store.set('k', s) };
    const doc = new Y.Doc();
    const e = make([p('draft', 'a')]);
    const off = await persistDoc(doc, persistence, 0);
    const c = createCollab(e, { doc, user: { id: 'u', name: 'U' }, seed: true });
    caret(e, 'a', 5);
    e.commands.insertText(' kept offline');
    off();
    c.destroy();
    // "reload": a fresh doc and editor restore from the stored state
    const doc2 = new Y.Doc();
    const off2 = await persistDoc(doc2, persistence, 0);
    const e2 = make();
    createCollab(e2, { doc: doc2, user: { id: 'u', name: 'U' } });
    expect(texts(e2)).toBe('draft kept offline');
    off2();
  });

  it('read-only permission', async () => {
    const doc = new Y.Doc();
    const e = make([p('x', 'a')]);
    const c = createCollab(e, { doc, user: { id: 'v', name: 'Viewer' }, seed: true, permissions: { canEdit: () => false } });
    expect(e.readOnly).toBe(true);
    expect(e.commands.insertText('y')).toBe(false);
    c.destroy();
  });

  for (const seed of [11, 12, 13, 14]) {
    it(`randomized concurrent editing converges (seed ${seed})`, async () => {
      const r = mulberry(seed * 104729);
      const hub = memoryHub();
      const A = client(hub, 'ann', { seed: true, content: [p('alpha beta', 'a'), p('gamma', 'b'), { id: 'l', type: 'list', attrs: { kind: 'bullet' }, content: [{ text: 'item' }] }] });
      await flush();
      const B = client(hub, 'bob');
      const C = client(hub, 'cy');
      await flush();
      const clients = [A, B, C];
      const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
      const act = (cl: Client) => {
        const e = cl.e;
        const tb = [...e.doc.descendants()].filter((x) => x.content);
        const all = [...e.doc.descendants()];
        if (!tb.length) return;
        const b = pick(tb);
        const o = Math.floor(r() * (b.length + 1));
        const o2 = Math.min(b.length, o + Math.floor(r() * 4));
        e.setSelection(textSel(b.id, o, b.id, r() < 0.3 ? o2 : o));
        const ops = [
          () => e.commands.insertText(pick(['x', 'yz ', 'नम', '👍', ' '])),
          () => e.commands.insertText(pick(['a', 'b', 'c'])),
          () => e.commands.deleteBackward(),
          () => e.commands.splitBlock(),
          () => e.commands.toggleMark(pick(['bold', 'italic'])),
          () => e.commands.setBlockType(pick(['paragraph', 'heading', 'list', 'quote'])),
          () => e.commands.indent(),
          () => e.commands.outdent(),
          () => e.commands.moveBlocksTo([pick(all).id], pick(all).id, pick(['before', 'after'] as const)),
          () => e.commands.duplicateBlocks(),
          () => e.commands.deleteBlocks([pick(all).id]),
          () => e.commands.wrapIn('callout'),
          () => e.undo(),
          () => e.redo(),
        ];
        pick(ops)();
      };
      for (let round = 0; round < 60; round++) {
        if (r() < 0.15) {
          const cl = pick(clients.slice(1));
          if (cl.t.connected) cl.t.disconnect();
          else cl.t.connect();
        }
        for (const cl of clients) {
          const n = Math.floor(r() * 3);
          for (let i = 0; i < n; i++) act(cl);
        }
        if (r() < 0.6) await flush();
        for (const cl of clients) checkInvariants(cl.e);
      }
      for (const cl of clients) cl.t.connect();
      await flush();
      await flush();
      for (const cl of clients) checkInvariants(cl.e);
      // the shared state is identical...
      expect(Y.encodeStateVector(B.doc)).toEqual(Y.encodeStateVector(A.doc));
      // ...and every editor shows the same document
      const strip = (e: Editor) => JSON.stringify(e.getJSON().blocks);
      expect(strip(B.e)).toBe(strip(A.e));
      expect(strip(C.e)).toBe(strip(A.e));
    });
  }
});
