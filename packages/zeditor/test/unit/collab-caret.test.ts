import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { make, p, resetIds, checkInvariants, caret, texts } from './helpers';
import { createCollab, connectSync, memoryHub, Collab, SyncHandle, Transport } from '../../src/collab';
import { Editor, createComments, textSel, applyBlockChanges } from '../../src/core';
import { yCommentStore } from '../../src/collab';

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
/** `swap` makes the second client the one whose characters Yjs orders first */
async function pair(content: any[], swap = false) {
  const hub = memoryHub();
  const A = client(hub, 'ann', { seed: true, content, clientID: swap ? 200 : 100 });
  await flush();
  const B = client(hub, 'bob', { clientID: swap ? 100 : 200 });
  await flush();
  return { hub, A, B };
}
const same = (A: Client, B: Client) => expect(B.e.getJSON().blocks).toEqual(A.e.getJSON().blocks);
/** every run typed by one user must stay contiguous */
const contiguous = (text: string, ...runs: string[]) => {
  for (const r of runs) expect(text, `"${r}" interleaved in "${text}"`).toContain(r);
};

describe('collaboration: two users at the same caret position', () => {
  for (const swap of [false, true]) {
    it(`typing in step does not interleave (order ${swap ? 'B<A' : 'A<B'})`, async () => {
      const { A, B } = await pair([p('hello world', 'a')], swap);
      caret(A.e, 'a', 5);
      caret(B.e, 'a', 5);
      for (let i = 0; i < 4; i++) {
        A.e.commands.insertText('ABCD'[i]);
        B.e.commands.insertText('wxyz'[i]);
        await flush();
      }
      same(A, B);
      contiguous(texts(A.e), 'ABCD', 'wxyz');
      expect(texts(A.e).length).toBe(19);
      checkInvariants(A.e);
      checkInvariants(B.e);
    });

    it(`typing with lag (several keys per round trip) does not interleave (order ${swap ? 'B<A' : 'A<B'})`, async () => {
      const { A, B } = await pair([p('hello world', 'a')], swap);
      caret(A.e, 'a', 5);
      caret(B.e, 'a', 5);
      const a = 'ABCDEFGH';
      const b = 'stuvwxyz';
      for (let i = 0; i < 8; i += 2) {
        A.e.commands.insertText(a[i]);
        A.e.commands.insertText(a[i + 1]);
        B.e.commands.insertText(b[i]);
        await flush();
        B.e.commands.insertText(b[i + 1]);
        await flush();
      }
      same(A, B);
      contiguous(texts(A.e), a, b);
    });

    it(`typing at the very start and in an empty paragraph (order ${swap ? 'B<A' : 'A<B'})`, async () => {
      const { A, B } = await pair([p('', 'a'), p('tail', 'b')], swap);
      for (const id of ['a', 'b']) {
        caret(A.e, id, 0);
        caret(B.e, id, 0);
        for (let i = 0; i < 3; i++) {
          A.e.commands.insertText('ABC'[i]);
          B.e.commands.insertText('xyz'[i]);
          await flush();
        }
        same(A, B);
        contiguous(A.e.doc.get(id)!.text, 'ABC', 'xyz');
      }
    });

    it(`three users, formatted text (order ${swap ? 'B<A' : 'A<B'})`, async () => {
      const hub = memoryHub();
      const A = client(hub, 'ann', { seed: true, clientID: swap ? 300 : 100, content: [{ id: 'a', type: 'paragraph', content: [{ text: 'bold', marks: { bold: true } }, { text: ' plain' }] }] });
      await flush();
      const B = client(hub, 'bob', { clientID: 200 });
      const C = client(hub, 'cy', { clientID: swap ? 100 : 300 });
      await flush();
      for (const cl of [A, B, C]) caret(cl.e, 'a', 4); // the bold / plain boundary
      for (let i = 0; i < 3; i++) {
        A.e.commands.insertText('ABC'[i]);
        B.e.commands.insertText('klm'[i]);
        C.e.commands.insertText('xyz'[i]);
        await flush();
      }
      same(A, B);
      same(A, C);
      contiguous(texts(A.e), 'ABC', 'klm', 'xyz');
      checkInvariants(A.e);
    });
  }

  it('a remote insertion before the caret still moves it; one at a selection edge does not grow the selection', async () => {
    const { A, B } = await pair([p('hello world', 'a')]);
    caret(A.e, 'a', 5);
    caret(B.e, 'a', 0);
    B.e.commands.insertText('>> ');
    await flush();
    expect(A.e.selection).toEqual(textSel('a', 8));
    // A selects "hello"; B types at both edges of it
    caret(A.e, 'a', 3, 'a', 8);
    caret(B.e, 'a', 3);
    B.e.commands.insertText('[');
    caret(B.e, 'a', 9);
    B.e.commands.insertText(']');
    await flush();
    expect(texts(A.e)).toBe('>> [hello] world');
    expect(A.e.selection).toEqual(textSel('a', 4, 'a', 9));
    // same for a backward selection
    caret(A.e, 'a', 9, 'a', 4);
    caret(B.e, 'a', 4);
    B.e.commands.insertText('(');
    caret(B.e, 'a', 10);
    B.e.commands.insertText(')');
    await flush();
    expect(texts(A.e)).toBe('>> [(hello)] world');
    expect(A.e.selection).toEqual(textSel('a', 10, 'a', 5));
  });

  it('pending formatting (Ctrl+B before typing) survives a remote edit', async () => {
    const { A, B } = await pair([p('hello world', 'a')]);
    caret(A.e, 'a', 5);
    A.e.commands.toggleMark('bold');
    caret(B.e, 'a', 11);
    B.e.commands.insertText('!');
    await flush();
    A.e.commands.insertText('X');
    await flush();
    same(A, B);
    expect(A.e.doc.get('a')!.content).toEqual([{ text: 'hello' }, { text: 'X', marks: { bold: true } }, { text: ' world!' }]);
  });

  it("the other user's caret is shown where it really is after my own edits", async () => {
    const { A, B } = await pair([p('hello world', 'a')]);
    caret(B.e, 'a', 11);
    await flush();
    expect(A.c.remoteStates()[0].selection).toEqual(textSel('a', 11));
    caret(A.e, 'a', 0);
    A.e.commands.insertText('>> ');
    // immediately, before any message from B comes back
    expect(A.c.remoteStates()[0].selection).toEqual(textSel('a', 14));
    await flush();
    expect(B.e.selection).toEqual(textSel('a', 14));
    expect(A.c.remoteStates()[0].selection).toEqual(textSel('a', 14));
    // B selects a word, A deletes text before it
    caret(B.e, 'a', 3, 'a', 8);
    await flush();
    caret(A.e, 'a', 0, 'a', 3);
    A.e.commands.deleteBackward();
    expect(A.c.remoteStates()[0].selection).toEqual(textSel('a', 0, 'a', 5));
    await flush();
    expect(A.c.remoteStates()[0].selection).toEqual(textSel('a', 0, 'a', 5));
    expect(B.e.selection).toEqual(textSel('a', 0, 'a', 5));
  });

  it('undo and redo put the caret back where the text now is, after other people typed before it', async () => {
    const { A, B } = await pair([p('base', 'a')]);
    caret(A.e, 'a', 4);
    A.e.commands.insertText(' AAA');
    await flush();
    caret(B.e, 'a', 0);
    B.e.commands.insertText('BBB ');
    await flush();
    expect(texts(A.e)).toBe('BBB base AAA');
    caret(A.e, 'a', 0);
    A.e.undo();
    expect(texts(A.e)).toBe('BBB base');
    expect(A.e.selection).toEqual(textSel('a', 8));
    A.e.redo();
    expect(texts(A.e)).toBe('BBB base AAA');
    expect(A.e.selection).toEqual(textSel('a', 12));
    await flush();
    same(A, B);
  });

  it('applyBlockChanges (server sync without Yjs) keeps the caret and the typing order', () => {
    const e = make([p('hello world', 'a')]);
    const server = (text: string) => applyBlockChanges(e, { upserted: [{ id: 'a', type: 'paragraph', parentId: null, index: 0, afterId: null, content: [{ text }] }] });
    caret(e, 'a', 5);
    server('>> hello world'); // someone typed before the caret
    expect(e.selection).toEqual(textSel('a', 8));
    server('>> hello world!'); // ...and after it
    expect(e.selection).toEqual(textSel('a', 8));
    server('>> helloX world!'); // ...and exactly at it
    expect(e.selection).toEqual(textSel('a', 8));
    e.commands.insertText('Y');
    expect(texts(e)).toBe('>> helloYX world!');
    server('helloYX world!');
    expect(e.selection).toEqual(textSel('a', 6));
    server('helloYX 👍 world!');
    expect(e.selection).toEqual(textSel('a', 6));
    server('helloYX 👎 world!'); // emoji that share a surrogate half
    expect(texts(e)).toBe('helloYX 👎 world!');
    server('helloYX 👎 world!');
    checkInvariants(e);
    // formatting-only change
    applyBlockChanges(e, { upserted: [{ id: 'a', type: 'paragraph', parentId: null, index: 0, afterId: null, content: [{ text: 'hello', marks: { bold: true } }, { text: 'YX 👎 world!' }] }] });
    expect(e.doc.get('a')!.content).toEqual([{ text: 'hello', marks: { bold: true } }, { text: 'YX 👎 world!' }]);
    expect(e.selection).toEqual(textSel('a', 6));
    checkInvariants(e);
  });

  it('two users formatting the same text do not duplicate it', async () => {
    const { A, B } = await pair([p('hello world', 'a')]);
    caret(A.e, 'a', 0, 'a', 5);
    caret(B.e, 'a', 0, 'a', 5);
    A.e.commands.toggleMark('bold');
    B.e.commands.toggleMark('bold');
    await flush();
    same(A, B);
    expect(A.e.doc.get('a')!.content).toEqual([{ text: 'hello', marks: { bold: true } }, { text: ' world' }]);
    // different marks on overlapping ranges both apply
    caret(A.e, 'a', 3, 'a', 8);
    caret(B.e, 'a', 6, 'a', 11);
    A.e.commands.toggleMark('italic');
    B.e.commands.toggleMark('code');
    await flush();
    same(A, B);
    expect(texts(A.e)).toBe('hello world');
    expect(A.e.doc.get('a')!.content).toEqual([
      { text: 'hel', marks: { bold: true } },
      { text: 'lo', marks: { bold: true, italic: true } },
      { text: ' ', marks: { italic: true } },
      { text: 'wo', marks: { italic: true, code: true } },
      { text: 'rld', marks: { code: true } },
    ]);
    checkInvariants(A.e);
  });

  it('text typed inside a word while someone else formats it stays in place and gets the format', async () => {
    const { A, B } = await pair([p('hello world', 'a')]);
    caret(A.e, 'a', 0, 'a', 5);
    caret(B.e, 'a', 3);
    A.e.commands.toggleMark('bold');
    B.e.commands.insertText('XY');
    await flush();
    same(A, B);
    expect(texts(A.e)).toBe('helXYlo world');
    expect(A.e.selection).toEqual(textSel('a', 0, 'a', 7));
    expect(B.e.selection).toEqual(textSel('a', 5));
    // and formatting is its own undo step that leaves the other user's text alone
    A.e.undo();
    await flush();
    same(A, B);
    expect(texts(B.e)).toBe('helXYlo world');
    expect(B.e.doc.get('a')!.content!.some((c) => c.marks?.bold && 'text' in c && c.text.includes('h'))).toBe(false);
  });

  it('two users commenting on the same text at once do not duplicate it', async () => {
    const { A, B } = await pair([p('some commented text', 'a')]);
    const ca = createComments(A.e, { user: { id: 'ann', name: 'Ann' }, store: yCommentStore(A.doc) });
    const cb = createComments(B.e, { user: { id: 'bob', name: 'Bob' }, store: yCommentStore(B.doc) });
    caret(A.e, 'a', 5, 'a', 14);
    caret(B.e, 'a', 0, 'a', 9);
    const ta = ca.addThread('one')!;
    const tb = cb.addThread('two')!;
    await flush();
    same(A, B);
    expect(texts(A.e)).toBe('some commented text');
    for (const c of [ca, cb]) {
      expect(c.anchors(ta.id)).toEqual([{ id: 'a', from: 5, to: 14 }]);
      expect(c.anchors(tb.id)).toEqual([{ id: 'a', from: 0, to: 9 }]);
    }
  });

  it('comment anchors do not swallow text another user types at their edges', async () => {
    const { A, B } = await pair([p('some commented text', 'a')]);
    const ca = createComments(A.e, { user: { id: 'ann', name: 'Ann' }, store: yCommentStore(A.doc) });
    caret(A.e, 'a', 5, 'a', 14);
    const t = ca.addThread('check')!;
    await flush();
    caret(B.e, 'a', 14);
    B.e.commands.insertText('!');
    caret(B.e, 'a', 5);
    B.e.commands.insertText('?');
    await flush();
    same(A, B);
    expect(texts(A.e)).toBe('some ?commented! text');
    expect(ca.anchors(t.id)).toEqual([{ id: 'a', from: 6, to: 15 }]);
  });
});
