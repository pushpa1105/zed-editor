import { test, expect } from '@playwright/test';
import { open, root, json, sel, texts, setSel, expectInSync, noErrors, p, MOD, domText } from './util';

test.describe('typing and native input', () => {
  test('types, splits, joins and undoes with the DOM kept in sync', async ({ page }) => {
    await open(page, { content: [p('', 'a')] });
    await root(page).click();
    await page.keyboard.type('Hello world');
    await expectInSync(page);
    expect(await texts(page)).toBe('Hello world');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    expect(await texts(page)).toBe('Hello |world');
    await expectInSync(page);
    await page.keyboard.press('Backspace');
    expect(await texts(page)).toBe('Hello world');
    await page.keyboard.type('big ');
    expect(await texts(page)).toBe('Hello big world');
    await expectInSync(page);
    await page.keyboard.press(`${MOD}+z`);
    expect(await texts(page)).toBe('Hello world');
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press(`${MOD}+z`);
    expect(await texts(page)).toBe('Hello world');
    await expectInSync(page);
    await noErrors(page);
  });

  test('typing does not replace the block element or its text node', async ({ page }) => {
    await open(page, { content: [p('abc', 'a'), p('other', 'b')] });
    await setSel(page, 'a', 3);
    await page.evaluate(() => {
      const w = window as any;
      w.blockEl = document.querySelector('[data-zid="a"]');
      w.textNode = w.blockEl.querySelector('.z-content').firstChild;
      w.otherEl = document.querySelector('[data-zid="b"]');
      w.mutations = 0;
      new MutationObserver((list) => (w.mutations += list.length)).observe(w.otherEl, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    await page.keyboard.type('def');
    const res = await page.evaluate(() => {
      const w = window as any;
      const el = document.querySelector('[data-zid="a"]')!;
      return { sameBlock: el === w.blockEl, sameText: el.querySelector('.z-content')!.firstChild === w.textNode, data: w.textNode.data, otherMutations: w.mutations };
    });
    expect(res).toEqual({ sameBlock: true, sameText: true, data: 'abcdef', otherMutations: 0 });
  });

  test('backward selection across two blocks + toolbar button, then undo restores content and selection', async ({ page }) => {
    await open(page, { content: [p('alpha beta', 'a'), p('gamma delta', 'b')] });
    await setSel(page, 'b', 5, 'a', 6);
    const before = await json(page);
    await page.locator('#a .z-top [data-id="bold"]').click();
    const after = await json(page);
    expect(after[0].content).toEqual([{ text: 'alpha ' }, { text: 'beta', marks: { bold: true } }]);
    expect(after[1].content).toEqual([{ text: 'gamma', marks: { bold: true } }, { text: ' delta' }]);
    // selection is still the same backward range, in the model and in the DOM
    expect(await sel(page)).toEqual({ type: 'text', anchor: { id: 'b', offset: 5 }, focus: { id: 'a', offset: 6 } });
    expect(await page.evaluate(() => getSelection()!.toString().replace(/\s+/g, ' '))).toBe('beta gamma');
    await expect(page.locator('#a .z-top [data-id="bold"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#a strong')).toHaveCount(2);
    await page.keyboard.press(`${MOD}+z`);
    expect(await json(page)).toEqual(before);
    expect(await sel(page)).toEqual({ type: 'text', anchor: { id: 'b', offset: 5 }, focus: { id: 'a', offset: 6 } });
    const dom = await page.evaluate(() => {
      const s = getSelection()!;
      const r = s.getRangeAt(0);
      // backward: focus precedes anchor
      return { text: s.toString().replace(/\s+/g, ' '), backward: r.startContainer === s.focusNode && r.startOffset === s.focusOffset };
    });
    expect(dom).toEqual({ text: 'beta gamma', backward: true });
    await expect(page.locator('#a strong')).toHaveCount(0);
  });

  test('keyboard shortcuts and markdown typing shortcuts', async ({ page }) => {
    await open(page, { content: [p('', 'a')] });
    await root(page).click();
    await page.keyboard.type('# Title');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('two');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press(`${MOD}+b`);
    await page.keyboard.type('bold');
    await page.keyboard.press(`${MOD}+b`);
    await page.keyboard.type(' plain **md** `code` ');
    const j = await json(page);
    expect(j[0]).toMatchObject({ type: 'heading', attrs: { level: 1 }, content: [{ text: 'Title' }] });
    expect(j[1]).toMatchObject({ type: 'list', content: [{ text: 'one' }] });
    expect(j[1].children[0]).toMatchObject({ type: 'list', content: [{ text: 'two' }] });
    expect(j[2].type).toBe('paragraph');
    expect(j[2].content).toEqual([{ text: 'bold', marks: { bold: true } }, { text: ' plain ' }, { text: 'md', marks: { bold: true } }, { text: ' ' }, { text: 'code', marks: { code: true } }, { text: ' ' }]);
    await expect(page.locator('#a h1')).toHaveText('Title');
    await expectInSync(page);
    await noErrors(page);
  });

  test('checklist in block mode, switch to classic, edit, undo: checklist and mode survive', async ({ page }) => {
    await open(page, { content: [p('', 'a')], mode: 'block' });
    await root(page).click();
    await page.keyboard.type('[] buy milk');
    expect((await json(page))[0]).toMatchObject({ type: 'list', attrs: { kind: 'check', checked: false } });
    const scrollBefore = await page.evaluate(() => scrollY);
    const selBefore = await sel(page);
    const undoDepth = await page.evaluate(() => (window as any).z.editor.builtinHistory.undoStack.length);
    await page.evaluate(() => (window as any).z.setMode('classic'));
    expect(await page.evaluate(() => (window as any).z.editor.builtinHistory.undoStack.length)).toBe(undoDepth);
    expect(await sel(page)).toEqual(selBefore);
    expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
    await expect(page.locator('#a .zeditor')).toHaveAttribute('data-mode', 'classic');
    // still focused and editable: keep typing, then tick the box with the pointer
    await page.keyboard.type(' today');
    await page.locator('#a [data-z-check]').click();
    expect((await json(page))[0].attrs.checked).toBe(true);
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press(`${MOD}+z`);
    const j = await json(page);
    expect(j[0]).toMatchObject({ type: 'list', attrs: { kind: 'check', checked: false }, content: [{ text: 'buy milk' }] });
    expect(await page.evaluate(() => (window as any).z.editor.mode)).toBe('classic');
    await noErrors(page);
  });

  test('emoji, combining marks, Devanagari and mixed direction text', async ({ page }) => {
    await open(page, { content: [p('', 'a')] });
    await root(page).click();
    const text = 'a👨‍👩‍👧‍👦é नमस्ते שלום abc';
    await page.keyboard.insertText(text);
    expect(await texts(page)).toBe(text);
    await expectInSync(page);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Delete'); // the whole family emoji goes at once
    expect(await texts(page)).toBe('aé नमस्ते שלום abc');
    await page.keyboard.press('End');
    await page.keyboard.insertText('🇳🇵');
    await page.keyboard.press('Backspace');
    expect(await texts(page)).toBe('aé नमस्ते שלום abc');
    await expectInSync(page);
  });

  test('read-only mode blocks edits but allows selection and copy', async ({ page }) => {
    await open(page, { content: [p('locked text', 'a')], readOnly: true });
    await expect(root(page)).toHaveAttribute('contenteditable', 'false');
    await expect(root(page)).toHaveAttribute('aria-readonly', 'true');
    await root(page).click();
    await page.keyboard.type('x');
    await page.keyboard.press('Backspace');
    expect(await texts(page)).toBe('locked text');
    await expect(page.locator('#a .z-top [data-id="bold"]')).toBeDisabled();
    await page.evaluate(() => (window as any).z.setReadOnly(false));
    await setSel(page, 'a', 11);
    await page.keyboard.type('!');
    expect(await texts(page)).toBe('locked text!');
    void domText;
  });
});
