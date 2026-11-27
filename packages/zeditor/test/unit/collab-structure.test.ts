import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { make, p, resetIds, checkInvariants, caret, texts } from './helpers';
import { createCollab, connectSync, memoryHub, sharedBlocks, yCommentStore, Collab, SyncHandle, Transport } from '../../src/collab';
import { Editor, createComments, textSel } from '../../src/core';

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
function client(hub: ReturnType<typeof memoryHub>, name: string, opts: { seed?: boolean; content?: any[]; clientID?: number } = {}): Client {
  const doc = new Y.Doc();
  if (opts.clientID) doc.clientID = opts.clientID;
  const e = make(opts.content ?? [p('', 'seed')]);
  const c = createCollab(e, { doc, user: { id: name, name }, seed: opts.seed });
  const t = hub.endpoint();
  const s = connectSync(doc, c.awareness, t);
  t.connect();
  return { e, c, s, t, doc };
}
/** `swap` gives the second client the lower Yjs client id, which reverses how ties are ordered */
async function pair(content: any[], swap = false) {
  const hub = memoryHub();
  const A = client(hub, 'ann', { seed: true, content, clientID: swap ? 200 : 100 });
  await flush();
  const B = client(hub, 'bob', { clientID: swap ? 100 : 200 });
  await flush();
  return { hub, A, B };
}
/** both editors show the same document, it is what the shared document holds, and nothing is out of step */
const settled = (...clients: Client[]) => {
  for (const cl of clients) {
    expect((cl.c as any)._verify()).toBe(null);
    checkInvariants(cl.e);
    expect(cl.e.getJSON().blocks).toEqual(clients[0].e.getJSON().blocks);
    expect(sharedBlocks(cl.doc, cl.e)).toEqual(cl.e.getJSON().blocks);
  }
};
const blockTexts = (e: Editor) => [...e.doc.descendants()].filter((b) => b.content).map((b) => b.text);

describe('collaboration: splitting and joining paragraphs', () => {
  for (const swap of [false, true]) {
    const order = swap ? 'B<A' : 'A<B';

    it(`both press Enter at the same place: the tail is not duplicated (${order})`, async () => {
      const { A, B } = await pair([p('hello world', 'a')], swap);
      caret(A.e, 'a', 5);
      caret(B.e, 'a', 5);
      A.e.commands.splitBlock();
      B.e.commands.splitBlock();
      await flush();
      settled(A, B);
      // two Enters: three paragraphs, the text exists once
      expect(blockTexts(A.e).slice().sort()).toEqual(['', ' world', 'hello']);
      expect(blockTexts(A.e)[0]).toBe('hello');
      A.e.commands.insertText('A');
      B.e.commands.insertText('B');
      await flush();
      settled(A, B);
      expect(texts(A.e).replace(/\|/g, '').length).toBe(13);
    });

    it(`Enter at two different places of one paragraph (${order})`, async () => {
      const { A, B } = await pair([p('hello world', 'a')], swap);
      caret(A.e, 'a', 5);
      caret(B.e, 'a', 8);
      A.e.commands.splitBlock();
      B.e.commands.splitBlock();
      await flush();
      settled(A, B);
      expect(blockTexts(A.e)).toEqual(['hello', ' wo', 'rld']);
    });

    it(`text typed after the split point follows the tail into the new paragraph, and so does the caret (${order})`, async () => {
      const { A, B } = await pair([p('hello world', 'a')], swap);
      caret(A.e, 'a', 5);
      caret(B.e, 'a', 9);
      A.e.commands.splitBlock();
      B.e.commands.insertText('X');
      await flush();
      settled(A, B);
      expect(blockTexts(A.e)).toEqual(['hello', ' worXld']);
      const tail = A.e.doc.blocks[1].id;
      expect(B.e.selection).toEqual(textSel(tail, 5));
      B.e.commands.insertText('Y');
      await flush();
      settled(A, B);
      expect(blockTexts(A.e)).toEqual(['hello', ' worXYld']);
    });

    it(`text typed in a paragraph that someone else joins to the previous one is kept (${order})`, async () => {
      const { A, B } = await pair([p('hello', 'a'), p('world', 'b')], swap);
      caret(A.e, 'b', 0);
      caret(B.e, 'b', 3);
      A.e.commands.deleteBackward();
      B.e.commands.insertText('X');
      await flush();
      settled(A, B);
      expect(blockTexts(A.e)).toEqual(['helloworXld']);
      expect(B.e.selection).toEqual(textSel('a', 9));
      expect(A.e.selection).toEqual(textSel('a', 5));
    });

    it(`both join the same two paragraphs: the text is not duplicated (${order})`, async () => {
      const { A, B } = await pair([p('hello', 'a'), p('world', 'b'), p('end', 'c')], swap);
      caret(A.e, 'b', 0);
      caret(B.e, 'a', 5);
      A.e.commands.deleteBackward(); // Backspace at the start of b
      B.e.commands.deleteForward(); // Delete at the end of a
      await flush();
      settled(A, B);
      expect(blockTexts(A.e)).toEqual(['helloworld', 'end']);
    });

    it(`one joins a paragraph while the other splits it (${order})`, async () => {
      const { A, B } = await pair([p('hello', 'a'), p('world', 'b')], swap);
      caret(A.e, 'b', 0);
      caret(B.e, 'b', 2);
      A.e.commands.deleteBackward();
      B.e.commands.splitBlock();
      await flush();
      settled(A, B);
      expect(blockTexts(A.e)).toEqual(['hellowo', 'rld']);
    });

    it(`a range deleted across paragraphs while the other types in what remains (${order})`, async () => {
      const { A, B } = await pair([p('one two', 'a'), p('three four', 'b')], swap);
      caret(A.e, 'a', 3, 'b', 6); // " two" + "three "
      caret(B.e, 'b', 10);
      A.e.commands.deleteBackward();
      B.e.commands.insertText('!');
      await flush();
      settled(A, B);
      expect(blockTexts(A.e)).toEqual(['onefour!']);
    });

    it(`typing at the end of a paragraph while someone adds a paragraph after it (${order})`, async () => {
      const { A, B } = await pair([p('first', 'a'), p('last', 'c')], swap);
      B.t.disconnect();
      caret(A.e, 'a', 5);
      A.e.commands.insertText(' and more');
      caret(B.e, 'c', 0);
      B.e.commands.splitBlock(); // Enter at the start of the next paragraph
      B.e.commands.insertBlocks([p('pasted', 'n')], { after: 'a' });
      B.t.connect();
      await flush();
      settled(A, B);
      expect(blockTexts(A.e)[0]).toBe('first and more');
      expect(blockTexts(A.e)).toContain('pasted');
      expect(blockTexts(A.e)).toContain('last');
    });
  }

  it('undoing a split after someone typed in the new paragraph keeps their text', async () => {
    const { A, B } = await pair([p('hello world', 'a')]);
    caret(A.e, 'a', 5);
    A.e.commands.splitBlock();
    await flush();
    const tail = B.e.doc.blocks[1].id;
    caret(B.e, tail, 6);
    B.e.commands.insertText('!');
    await flush();
    expect(blockTexts(A.e)).toEqual(['hello', ' world!']);
    A.e.undo();
    await flush();
    settled(A, B);
    expect(blockTexts(A.e)).toEqual(['hello world!']);
    A.e.redo();
    await flush();
    settled(A, B);
    expect(blockTexts(A.e)).toEqual(['hello', ' world!']);
  });

  it('a split list item with children, nested blocks and tables keep working', async () => {
    const { A, B } = await pair([
      { id: 'l', type: 'list', attrs: { kind: 'bullet' }, content: [{ text: 'parent item' }], children: [{ id: 'k', type: 'list', attrs: { kind: 'bullet' }, content: [{ text: 'child' }] }] },
      p('after', 'z'),
    ]);
    caret(A.e, 'l', 6);
    caret(B.e, 'k', 5);
    A.e.commands.splitBlock();
    B.e.commands.insertText('!');
    await flush();
    settled(A, B);
    expect(blockTexts(A.e).slice().sort()).toEqual([' item', 'after', 'child!', 'parent']);
    caret(B.e, 'z', 0);
    B.e.commands.deleteBackward();
    await flush();
    settled(A, B);
    expect(texts(A.e)).not.toContain('|after');
  });
});

describe('collaboration: moving blocks', () => {
  it('text typed in a block while someone else moves it is kept', async () => {
    const { A, B } = await pair([p('one', 'a'), p('two', 'b'), p('three', 'c')]);
    caret(B.e, 'a', 3);
    A.e.commands.moveBlocksTo(['a'], 'c', 'after');
    B.e.commands.insertText('!');
    await flush();
    settled(A, B);
    expect(blockTexts(A.e)).toEqual(['two', 'three', 'one!']);
    expect(B.e.selection).toEqual(textSel('a', 4));
  });

  for (const swap of [false, true])
    it(`two users moving the same block leave one block, not two (${swap ? 'B<A' : 'A<B'})`, async () => {
      const { A, B } = await pair([p('one', 'a'), p('two', 'b'), p('three', 'c'), p('four', 'd')], swap);
      A.e.commands.moveBlocksTo(['a'], 'c', 'after');
      B.e.commands.moveBlocksTo(['a'], 'd', 'after');
      await flush();
      settled(A, B);
      expect(blockTexts(A.e).slice().sort()).toEqual(['four', 'one', 'three', 'two']);
      expect(A.e.doc.blocks.filter((b) => b.id === 'a').length).toBe(1);
      // and the block is still editable by both
      caret(A.e, 'a', 3);
      A.e.commands.insertText('!');
      await flush();
      settled(A, B);
      expect(B.e.doc.get('a')!.text).toBe('one!');
    });

  it('a container moved while someone types in a paragraph inside it', async () => {
    const { A, B } = await pair([{ id: 'q', type: 'callout', children: [p('inside', 'i')] }, p('below', 'z')]);
    caret(B.e, 'i', 6);
    A.e.commands.moveBlocksTo(['q'], 'z', 'after');
    B.e.commands.insertText('!');
    await flush();
    settled(A, B);
    expect(blockTexts(A.e)).toEqual(['below', 'inside!']);
  });
});

describe('collaboration: comments on overlapping text', () => {
  for (const swap of [false, true])
    it(`two threads anchored to overlapping text at the same moment both keep their whole range (${swap ? 'B<A' : 'A<B'})`, async () => {
      const { A, B } = await pair([p('some commented text', 'a')], swap);
      const ca = createComments(A.e, { user: { id: 'ann', name: 'Ann' }, store: yCommentStore(A.doc) });
      const cb = createComments(B.e, { user: { id: 'bob', name: 'Bob' }, store: yCommentStore(B.doc) });
      caret(A.e, 'a', 5, 'a', 14);
      caret(B.e, 'a', 0, 'a', 9);
      const ta = ca.addThread('one')!;
      const tb = cb.addThread('two')!;
      await flush();
      settled(A, B);
      expect(texts(A.e)).toBe('some commented text');
      for (const c of [ca, cb]) {
        expect(c.anchors(ta.id)).toEqual([{ id: 'a', from: 5, to: 14 }]);
        expect(c.anchors(tb.id)).toEqual([{ id: 'a', from: 0, to: 9 }]);
      }
      // removing one leaves the other untouched, also when done concurrently with an edit
      ca.removeThread(ta.id);
      caret(B.e, 'a', 7);
      B.e.commands.insertText('X');
      await flush();
      settled(A, B);
      expect(ca.anchors(ta.id)).toEqual([]);
      expect(ca.anchors(tb.id)).toEqual([{ id: 'a', from: 0, to: 10 }]);
    });
});

describe('collaboration: shared document format', () => {
  it('reads a document written with one Y.Text per block and moves its text into the flow', async () => {
    const doc = new Y.Doc();
    const blocks = doc.getArray<Y.Map<any>>('blocks');
    const legacy = (id: string, text: string, bold = false) => {
      const m = new Y.Map<any>();
      m.set('id', id);
      m.set('type', 'paragraph');
      m.set('attrs', {});
      const t = new Y.Text();
      m.set('text', t);
      m.set('children', new Y.Array());
      blocks.push([m]);
      t.insert(0, text, bold ? { bold: true } : {});
    };
    legacy('a', 'old text');
    legacy('b', 'bold', true);
    const e = make();
    expect(sharedBlocks(doc, e).map((b) => b.content)).toEqual([[{ text: 'old text' }], [{ text: 'bold', marks: { bold: true } }]]);
    const c = createCollab(e, { doc, user: { id: 'u', name: 'U' } });
    expect(e.getJSON().blocks.map((b) => b.content)).toEqual([[{ text: 'old text' }], [{ text: 'bold', marks: { bold: true } }]]);
    caret(e, 'a', 8);
    e.commands.insertText('!');
    e.commands.splitBlock();
    e.commands.insertText('new');
    expect((c as any)._verify()).toBe(null);
    expect(sharedBlocks(doc, e)).toEqual(e.getJSON().blocks);
    expect(texts(e)).toBe('old text!|new|bold');
    // a second client reads the migrated document
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc));
    const e2 = make();
    createCollab(e2, { doc: doc2, user: { id: 'v', name: 'V' } });
    expect(e2.getJSON().blocks).toEqual(e.getJSON().blocks);
  });

  it('a block deleted while someone types in it is gone on both sides', async () => {
    const { A, B } = await pair([p('one', 'a'), p('two', 'b'), p('three', 'c')]);
    caret(B.e, 'b', 3);
    A.e.commands.deleteBlocks(['b']);
    B.e.commands.insertText('!');
    await flush();
    settled(A, B);
    expect(blockTexts(A.e)).toEqual(['one', 'three']);
  });
});
