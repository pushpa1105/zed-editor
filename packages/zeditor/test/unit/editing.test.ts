import { describe, it, expect, beforeEach } from 'vitest';
import { make, p, texts, caret, resetIds, checkInvariants } from './helpers';
import { textSel, blockSel, isMarkActive } from '../../src/core';

beforeEach(resetIds);

describe('typing and deleting', () => {
  it('inserts text and groups typing into one undo entry', () => {
    const e = make();
    for (const ch of 'hello') e.commands.insertText(ch);
    expect(texts(e)).toBe('hello');
    expect(e.selection).toEqual(textSel('a', 5));
    e.undo();
    expect(texts(e)).toBe('');
    expect(e.selection).toEqual(textSel('a', 0));
    e.redo();
    expect(texts(e)).toBe('hello');
    expect(e.selection).toEqual(textSel('a', 5));
  });

  it('splits and joins blocks', () => {
    const e = make([p('hello world', 'a')]);
    caret(e, 'a', 5);
    e.commands.splitBlock();
    expect(texts(e)).toBe('hello| world');
    const second = e.doc.blocks[1].id;
    expect(e.selection).toEqual(textSel(second, 0));
    e.commands.deleteBackward();
    expect(texts(e)).toBe('hello world');
    expect(e.selection).toEqual(textSel('a', 5));
    e.undo();
    expect(texts(e)).toBe('hello| world');
    e.undo();
    expect(texts(e)).toBe('hello world');
    checkInvariants(e);
  });

  it('deletes a backward selection across blocks and restores it on undo', () => {
    const e = make([p('one two', 'a'), p('three four', 'b'), p('five', 'c')]);
    caret(e, 'b', 5, 'a', 4); // backward: anchor in b, focus in a
    e.commands.deleteSelection();
    expect(texts(e)).toBe('one  four|five');
    expect(e.selection).toEqual(textSel('a', 4));
    e.undo();
    expect(texts(e)).toBe('one two|three four|five');
    expect(e.selection).toEqual(textSel('b', 5, 'a', 4));
  });

  it('deletes emoji sequences as one unit and combining marks per code point', () => {
    const fam = '👨‍👩‍👧‍👦';
    const e = make([p('a' + fam + '🇳🇵', 'a')]);
    caret(e, 'a', e.doc.get('a')!.length);
    e.commands.deleteBackward();
    expect(texts(e)).toBe('a' + fam);
    e.commands.deleteBackward();
    expect(texts(e)).toBe('a');
    const e2 = make([p('é', 'a')]);
    caret(e2, 'a', 2);
    e2.commands.deleteBackward();
    expect(texts(e2)).toBe('e');
    // forward delete removes the whole grapheme cluster
    const e3 = make([p('क्षि!', 'a')]);
    caret(e3, 'a', 0);
    e3.commands.deleteForward();
    expect(texts(e3)).toBe('!');
    // backspace in Devanagari removes one code point, like native editing
    const e4 = make([p('क्षि', 'a')]);
    caret(e4, 'a', 4);
    e4.commands.deleteBackward();
    expect(texts(e4)).toBe('क्ष');
  });

  it('keeps mixed RTL/LTR text and offsets intact', () => {
    const e = make([p('abc שלום def', 'a')]);
    caret(e, 'a', 7);
    e.commands.insertText('X');
    expect(texts(e)).toBe('abc שלוXם def');
    e.undo();
    expect(texts(e)).toBe('abc שלום def');
  });
});

describe('marks', () => {
  it('formats a backward cross-block selection, and undo restores content and selection', () => {
    const e = make([p('alpha beta', 'a'), p('gamma delta', 'b')]);
    caret(e, 'b', 5, 'a', 6);
    const before = e.getJSON();
    e.commands.toggleMark('bold');
    expect(e.doc.get('a')!.content).toEqual([{ text: 'alpha ' }, { text: 'beta', marks: { bold: true } }]);
    expect(e.doc.get('b')!.content).toEqual([{ text: 'gamma', marks: { bold: true } }, { text: ' delta' }]);
    expect(e.selection).toEqual(textSel('b', 5, 'a', 6));
    expect(isMarkActive(e, 'bold')).toBe(true);
    e.undo();
    expect(e.getJSON()).toEqual(before);
    expect(e.selection).toEqual(textSel('b', 5, 'a', 6));
    e.redo();
    e.commands.toggleMark('bold');
    expect(e.getJSON()).toEqual(before);
  });

  it('stored marks apply to typed text', () => {
    const e = make();
    e.commands.toggleMark('italic');
    e.commands.insertText('x');
    e.commands.insertText('y');
    expect(e.doc.get('a')!.content).toEqual([{ text: 'xy', marks: { italic: true } }]);
  });

  it('links are not extended by typing at their end, and unsafe urls are rejected', () => {
    const e = make([p('go', 'a')]);
    caret(e, 'a', 0, 'a', 2);
    expect(e.commands.setLink('javascript:alert(1)')).toBe(false);
    expect(e.commands.setLink('https://example.com')).toBe(true);
    caret(e, 'a', 2);
    e.commands.insertText('!');
    expect(e.doc.get('a')!.content).toEqual([{ text: 'go', marks: { link: { href: 'https://example.com', title: '' } } }, { text: '!' }]);
    caret(e, 'a', 1);
    e.commands.unsetLink();
    expect(e.doc.get('a')!.content).toEqual([{ text: 'go!' }]);
  });
});

describe('blocks', () => {
  it('markdown shortcuts convert blocks and are separately undoable', () => {
    const e = make();
    for (const ch of '# ') e.commands.insertText(ch);
    expect(e.doc.blocks[0].type).toBe('heading');
    expect(texts(e)).toBe('');
    e.undo();
    expect(e.doc.blocks[0].type).toBe('paragraph');
    expect(texts(e)).toBe('# ');
    const e2 = make();
    for (const ch of 'a **b** ') e2.commands.insertText(ch);
    expect(e2.doc.get('a')!.content).toEqual([{ text: 'a ' }, { text: 'b', marks: { bold: true } }, { text: ' ' }]);
    const e3 = make();
    for (const ch of '[] ') e3.commands.insertText(ch);
    expect(e3.doc.blocks[0].attrs).toMatchObject({ kind: 'check', checked: false });
  });

  it('checklist created in block mode survives mode switch, edit and undo', () => {
    const e = make([p('', 'a')], { mode: 'block' });
    e.commands.setBlockType('list', { kind: 'check', checked: false });
    e.commands.insertText('task');
    e.cutHistory();
    const depth = (e as any).builtinHistory.undoStack.length;
    e.setMode('classic');
    expect((e as any).builtinHistory.undoStack.length).toBe(depth); // no undo entry for the switch
    expect(e.selection).toEqual(textSel('a', 4));
    e.commands.insertText('!');
    e.cutHistory();
    e.commands.toggleCheck();
    expect(e.doc.get('a')!.attrs.checked).toBe(true);
    e.undo();
    e.undo();
    expect(e.mode).toBe('classic');
    expect(e.doc.get('a')!.type).toBe('list');
    expect(e.doc.get('a')!.attrs).toMatchObject({ kind: 'check', checked: false });
    expect(texts(e)).toBe('task');
  });

  it('indents and outdents list items', () => {
    const li = (t: string, id: string) => ({ id, type: 'list', attrs: { kind: 'bullet' }, content: [{ text: t }] });
    const e = make([li('one', 'a'), li('two', 'b'), li('three', 'c')]);
    caret(e, 'b', 0);
    expect(e.commands.indent()).toBe(true);
    expect(e.doc.get('b')!.parent!.id).toBe('a');
    caret(e, 'c', 0);
    e.commands.indent();
    expect(e.doc.get('a')!.children!.map((x) => x.id)).toEqual(['b', 'c']);
    caret(e, 'b', 0);
    e.commands.outdent();
    // standard outliner behaviour: following siblings become children of the outdented item
    expect(e.doc.blocks.map((x) => x.id)).toEqual(['a', 'b']);
    expect(e.doc.get('b')!.children!.map((x) => x.id)).toEqual(['c']);
    checkInvariants(e);
    e.undo();
    expect(e.doc.get('a')!.children!.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('refuses to move a parent into its own descendant', () => {
    const e = make([
      { id: 'a', type: 'list', attrs: { kind: 'bullet' }, content: [{ text: 'p' }], children: [{ id: 'b', type: 'list', attrs: { kind: 'bullet' }, content: [{ text: 'c' }] }] },
      p('x', 'c'),
    ]);
    const before = e.getJSON();
    expect(e.commands.moveBlocksTo(['a'], 'b', 'inside')).toBe(false);
    expect(e.commands.moveBlocksTo(['a'], 'b', 'after')).toBe(false);
    expect(e.commands.moveBlocksTo(['a'], 'a', 'after')).toBe(false);
    expect(e.getJSON()).toEqual(before);
    expect(e.commands.moveBlocksTo(['a'], 'c', 'after')).toBe(true);
    expect(e.doc.blocks.map((x) => x.id)).toEqual(['c', 'a']);
    expect(e.doc.get('b')!.parent!.id).toBe('a');
    e.undo();
    expect(e.getJSON()).toEqual(before);
  });

  it('multi-block operations: duplicate, move, delete', () => {
    const e = make([p('1', 'a'), p('2', 'b'), p('3', 'c')]);
    e.setSelection(blockSel(['a', 'b']));
    e.commands.moveBlocksDown();
    expect(texts(e)).toBe('3|1|2');
    e.commands.duplicateBlocks();
    expect(texts(e)).toBe('3|1|2|1|2');
    e.commands.deleteBlocks();
    expect(texts(e)).toBe('3|1|2');
    e.undo();
    e.undo();
    e.undo();
    expect(texts(e)).toBe('1|2|3');
    checkInvariants(e);
  });

  it('typing over a block selection replaces it', () => {
    const e = make([p('1', 'a'), { id: 'd', type: 'divider' }, p('3', 'c')]);
    e.setSelection(blockSel(['d']));
    e.commands.insertText('x');
    expect(texts(e)).toBe('1|x|3');
    checkInvariants(e);
  });

  it('code block: enter keeps indentation, marks are stripped', () => {
    const e = make([{ id: 'a', type: 'paragraph', content: [{ text: '  if', marks: { bold: true } }] }]);
    caret(e, 'a', 4);
    e.commands.setBlockType('code');
    expect(e.doc.get('a')!.content).toEqual([{ text: '  if' }]);
    e.commands.splitBlock();
    expect(e.doc.get('a')!.text).toBe('  if\n  ');
    expect(e.doc.blocks.length).toBe(1);
  });

  it('wraps in callout and unwraps', () => {
    const e = make([p('1', 'a'), p('2', 'b')]);
    e.setSelection(blockSel(['a', 'b']));
    expect(e.commands.wrapIn('callout')).toBe(true);
    expect(e.doc.blocks.length).toBe(1);
    expect(e.doc.blocks[0].children!.map((x) => x.id)).toEqual(['a', 'b']);
    expect(e.commands.unwrap(e.doc.blocks[0].id)).toBe(true);
    expect(e.doc.blocks.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('transactions', () => {
  it('rolls back a transaction that throws', () => {
    const e = make([p('abc', 'a')]);
    const before = e.getJSON();
    expect(() =>
      e.update((tr) => {
        tr.replaceText('a', 0, 1, 'X');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(e.getJSON()).toEqual(before);
    expect(e.canUndo()).toBe(false);
  });
  it('enforces the character limit', () => {
    const e = make([p('abcd', 'a')], { characterLimit: 5 });
    caret(e, 'a', 4);
    expect(e.commands.insertText('e')).toBe(true);
    expect(e.commands.insertText('f')).toBe(false);
    expect(texts(e)).toBe('abcde');
    expect(e.commands.deleteBackward()).toBe(true);
  });
  it('maps the selection through remote-style edits', () => {
    const e = make([p('hello', 'a')]);
    caret(e, 'a', 3);
    e.update((tr) => void tr.replaceText('a', 0, 0, 'XX'), { origin: 'remote', history: false });
    expect(e.selection).toEqual(textSel('a', 5));
    e.update((tr) => void tr.remove('a'), { origin: 'remote', history: false });
    expect(e.selection?.type).toBe('text');
    checkInvariants(e);
  });
  it('read-only blocks commands', () => {
    const e = make([p('abc', 'a')], { readOnly: true });
    expect(e.commands.insertText('x')).toBe(false);
    expect(e.commands.toggleMark('bold')).toBe(false);
    expect(texts(e)).toBe('abc');
  });
});
