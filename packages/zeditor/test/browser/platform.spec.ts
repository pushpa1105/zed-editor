import { test, expect, Page } from '@playwright/test';
import { open, root, json, sel, texts, setSel, expectInSync, noErrors, p, MOD } from './util';

/**
 * Drive a composition the way an IME does: compositionstart, then the browser mutates the text
 * node for every intermediate string (insertCompositionText is not cancelable), then compositionend.
 * This exercises the editor's native-input reconciliation in every engine.
 */
async function compose(page: Page, steps: string[], commit: string) {
  await page.evaluate(
    ([steps, commit]) => {
      const rootEl = document.querySelector('#a .z-root')!;
      const s = getSelection()!;
      rootEl.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      let node = s.anchorNode!;
      let start = s.anchorOffset;
      if (node.nodeType !== 3) {
        // empty block: the browser creates a text node in place of the filler <br>
        const t = document.createTextNode('');
        const el = node as Element;
        el.insertBefore(t, el.childNodes[start] ?? null);
        node = t;
        start = 0;
      }
      const text = node as Text;
      let len = 0;
      const put = (str: string, type: string) => {
        rootEl.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: false, inputType: type, data: str, isComposing: true }));
        text.replaceData(start, len, str);
        len = str.length;
        s.collapse(text, start + len);
        rootEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type, data: str, isComposing: true }));
      };
      for (const step of steps as string[]) put(step, 'insertCompositionText');
      put(commit as string, 'insertCompositionText');
      rootEl.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: commit as string }));
    },
    [steps, commit] as const,
  );
}

test.describe('composition (IME) and dead keys', () => {
  test('composition updates the model without replacing the block or breaking later edits', async ({ page }) => {
    await open(page, { content: [p('ab', 'a')] });
    await setSel(page, 'a', 1);
    await page.evaluate(() => ((window as any).blockEl = document.querySelector('[data-zid="a"]')));
    await compose(page, ['ｎ', 'に', 'にｈ', 'にほ', 'にほｎ', 'にほん'], '日本');
    expect(await texts(page)).toBe('a日本b');
    expect(await sel(page)).toMatchObject({ focus: { id: 'a', offset: 3 } });
    expect(await page.evaluate(() => document.querySelector('[data-zid="a"]') === (window as any).blockEl)).toBe(true);
    await expectInSync(page);
    await page.keyboard.type('!');
    expect(await texts(page)).toBe('a日本!b');
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press(`${MOD}+z`);
    expect(await texts(page)).toBe('ab');
    await expectInSync(page);
    await noErrors(page);
  });

  test('composition in an empty block, inside bold text, and a dead-key sequence', async ({ page }) => {
    await open(page, { content: [p('', 'a'), { id: 'b', type: 'paragraph', content: [{ text: 'bold', marks: { bold: true } }] }] });
    await setSel(page, 'a', 0);
    await compose(page, ['ㅎ', '하', '한'], '한');
    expect(await texts(page)).toBe('한|bold');
    await expectInSync(page);
    await setSel(page, 'b', 2);
    await compose(page, ['´'], 'é'); // dead key: ´ then e
    const j = await json(page);
    expect(j[1].content).toEqual([{ text: 'boéld', marks: { bold: true } }]);
    await expectInSync(page);
    // Devanagari conjunct typed through composition
    await setSel(page, 'a', 1);
    await compose(page, ['क', 'क्', 'क्ष'], 'क्षि');
    expect(await texts(page)).toBe('한क्षि|boéld');
    await expectInSync(page);
    await noErrors(page);
  });

  test('real IME session through the browser (CDP)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Input.imeSetComposition is a Chromium DevTools command');
    await open(page, { content: [p('x', 'a')] });
    await setSel(page, 'a', 1);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'ｓ', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: 'す', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: 'すし', selectionStart: 2, selectionEnd: 2 });
    expect(await page.evaluate(() => (window as any).z.view.composing)).toBe(true);
    await cdp.send('Input.insertText', { text: '寿司' });
    await expect.poll(() => texts(page)).toBe('x寿司');
    expect(await page.evaluate(() => (window as any).z.view.composing)).toBe(false);
    await expectInSync(page);
    await page.keyboard.type('.');
    expect(await texts(page)).toBe('x寿司.');
    await noErrors(page);
  });
});

test.describe('accessibility and keyboard-only operation', () => {
  test('roles and accessible names', async ({ page }) => {
    await open(page, { content: [p('hello', 'a'), { id: 'c', type: 'list', attrs: { kind: 'check', checked: true }, content: [{ text: 'done' }] }], ui: { statusBar: true } });
    const r = root(page);
    await expect(r).toHaveAttribute('role', 'textbox');
    await expect(r).toHaveAttribute('aria-multiline', 'true');
    await expect(r).toHaveAttribute('aria-label', 'Rich text editor');
    const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
    await expect(toolbar).toBeVisible();
    // every control has a name
    const unnamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#a .z-top button, #a .z-top select, #a .z-top input'))
        .filter((el) => !(el.getAttribute('aria-label') || (el as HTMLElement).innerText.trim() || el.getAttribute('title')))
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
    await expect(page.getByRole('checkbox', { name: 'Toggle task' })).toHaveAttribute('aria-checked', 'true');
    await expect(toolbar.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
    // one tab stop for the whole toolbar (roving tabindex)
    expect(await page.evaluate(() => document.querySelectorAll('#a .z-top .z-toolbar .z-tool[tabindex="0"]').length)).toBe(1);
  });

  test('keyboard only: toolbar navigation, activation, focus returns to the text with the selection intact', async ({ page }) => {
    await open(page, { content: [p('hello world', 'a')] });
    await setSel(page, 'a', 0, 'a', 5);
    const active = () => page.evaluate(() => (document.activeElement as HTMLElement)?.getAttribute('data-id'));
    // Tab indents inside the editor; Escape then Shift+Tab leaves it (no keyboard trap)
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.activeElement === document.querySelector('#a .z-root'))).toBe(true);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.activeElement !== document.querySelector('#a .z-root'))).toBe(true);
    await page.evaluate(() => (window as any).z.focus());
    await page.keyboard.press('Alt+F10'); // from the text to the toolbar
    expect(await active()).toBe('blockType'); // first enabled control (undo / redo are disabled)
    await page.keyboard.press('End');
    expect(await active()).toBe('clear');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    expect(await active()).toBe('bold');
    await page.keyboard.press('Enter');
    // formatting applied to the selection the user left behind, and focus is back in the editor
    expect((await json(page))[0].content[0]).toEqual({ text: 'hello', marks: { bold: true } });
    expect(await page.evaluate(() => document.activeElement === document.querySelector('#a .z-root'))).toBe(true);
    expect(await sel(page)).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 5 } });
    await page.keyboard.type('X');
    expect(await texts(page)).toBe('X world');
  });

  test('keyboard only: color palette and link dialog open, trap Escape and restore focus', async ({ page }) => {
    await open(page, { content: [p('hello', 'a')] });
    await setSel(page, 'a', 0, 'a', 5);
    const color = page.locator('#a .z-top [data-id="color"]');
    await color.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Text color' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-id'))).toBe('color');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    expect((await json(page))[0].content[0].marks.color).toBeTruthy();
    // link dialog via shortcut; Escape returns to the editor
    await setSel(page, 'a', 0, 'a', 5);
    await page.keyboard.press(`${MOD}+k`);
    await expect(page.getByRole('dialog', { name: 'Link' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.querySelector('#a .z-root'))).toBe(true);
  });

  test('keyboard only in block mode: select blocks, move, reach an image, delete', async ({ page }) => {
    await open(page, { mode: 'block', content: [p('one', 'a'), { id: 'img', type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', alt: 'dot' } }, p('two', 'b')] });
    await setSel(page, 'a', 3);
    await page.keyboard.press('ArrowDown'); // from the end of "one" onto the image
    expect(await sel(page)).toEqual({ type: 'block', ids: ['img'], anchor: 'img' });
    await expect(page.locator('[data-zid="img"]')).toHaveClass(/z-selected/);
    await page.keyboard.press('Alt+ArrowDown'); // move the image below "two"
    expect((await json(page)).map((b: any) => b.id)).toEqual(['a', 'b', 'img']);
    await page.keyboard.press('Backspace');
    expect((await json(page)).map((b: any) => b.id)).toEqual(['a', 'b']);
    // Escape turns a caret into a block selection; Shift+Arrow extends it; typing replaces
    await setSel(page, 'a', 1);
    await page.keyboard.press('Escape');
    expect((await sel(page)).type).toBe('block');
    await page.keyboard.press('Shift+ArrowDown');
    expect((await sel(page)).ids).toEqual(['a', 'b']);
    await page.keyboard.press('Enter');
    await page.keyboard.type('after');
    expect(await texts(page)).toBe('one|two|after');
    await noErrors(page);
  });
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test('controls that need no hover: block handle, action menu, checkbox, floating toolbar', async ({ page }) => {
    await open(page, { mode: 'block', content: [p('tap me', 'a'), { id: 'c', type: 'list', attrs: { kind: 'check', checked: false }, content: [{ text: 'task' }] }] });
    await page.locator('[data-zid="a"] .z-content').tap();
    const grip = page.locator('#a .z-grip');
    await expect(grip).toBeVisible(); // shown for the block with the caret, no hover involved
    await grip.tap();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Duplicate' }).tap();
    expect(await texts(page)).toBe('tap me|tap me|task');
    await page.locator('#a [data-z-check]').tap();
    expect((await json(page))[2].attrs.checked).toBe(true);
    await setSel(page, 'a', 0, 'a', 3);
    await expect(page.locator('#a .z-floating-toolbar')).toBeVisible();
    await page.locator('#a .z-floating-toolbar [data-id="bold"]').tap();
    expect((await json(page))[0].content[0]).toEqual({ text: 'tap', marks: { bold: true } });
  });
});

test.describe('instances and lifecycle', () => {
  test('multiple editors on one page are independent', async ({ page }) => {
    await open(page, { content: [p('first', 'a')], mode: 'classic' });
    await page.evaluate(() => (window as any).mount({ content: [{ id: 'a', type: 'paragraph', content: [{ text: 'second' }] }], mode: 'block', features: { tables: false }, ui: { toolbar: ['bold', 'italic'] }, labels: { 'mark.bold': 'Fett' }, theme: 'dark' }, '#b'));
    await expect(page.locator('.zeditor')).toHaveCount(2);
    await expect(page.locator('#b .z-top .z-tool')).toHaveCount(2);
    await expect(page.locator('#b .z-top [data-id="bold"]')).toHaveAttribute('aria-label', 'Fett');
    await expect(page.locator('#a .z-top [data-id="bold"]')).toHaveAttribute('aria-label', 'Bold');
    await expect(page.locator('#b .zeditor')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#b .z-root').click();
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.type(' B');
    await page.locator('#a .z-root').click();
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.type(' A');
    const both = await page.evaluate(() => [(window as any).z.getJSON().blocks[0].content[0].text, (window as any).z2.getJSON().blocks[0].content[0].text]);
    expect(both).toEqual(['first A', 'second B']);
    // undo is per editor
    await page.keyboard.press(`${MOD}+z`);
    expect(await page.evaluate(() => [(window as any).z.getJSON().blocks[0].content[0].text, (window as any).z2.getJSON().blocks[0].content[0].text])).toEqual(['first', 'second B']);
    // features are per editor
    expect(await page.evaluate(() => [typeof (window as any).z.commands.insertTable, typeof (window as any).z2.commands.insertTable])).toEqual(['function', 'undefined']);
    await noErrors(page);
  });

  test('destroy removes DOM and every listener it added', async ({ page }) => {
    await page.goto('/packages/zeditor/test/browser/harness.html');
    await page.waitForFunction(() => (window as any).ready === true);
    const leaks = await page.evaluate(() => {
      const w = window as any;
      const live = new Map<string, number>();
      for (const [name, target] of [['document', document], ['window', window]] as const) {
        const add = target.addEventListener.bind(target);
        const remove = target.removeEventListener.bind(target);
        (target as any).addEventListener = (type: string, fn: any, opts: any) => {
          live.set(name + ':' + type, (live.get(name + ':' + type) ?? 0) + 1);
          add(type, fn, opts);
        };
        (target as any).removeEventListener = (type: string, fn: any, opts: any) => {
          live.set(name + ':' + type, (live.get(name + ':' + type) ?? 0) - 1);
          remove(type, fn, opts);
        };
      }
      for (let i = 0; i < 3; i++) {
        const z = w.mount({ mode: 'block', ui: { statusBar: true }, content: [{ id: 'a', type: 'paragraph', content: [{ text: 'x' }] }], autosave: { save: async () => {} }, upload: async () => ({ url: 'https://x.example/a.png' }) });
        z.focus();
        z.commands.insertText('y');
        z.commands.insertTable(2, 2);
        const editor = z.editor;
        z.destroy();
        if (editor.listenerCount() !== 0) return 'editor listeners left: ' + editor.listenerCount();
        if (!editor.destroyed) return 'editor not destroyed';
      }
      const left = [...live.entries()].filter(([, n]) => n !== 0);
      return { left, dom: document.querySelectorAll('.zeditor, .z-menu, .z-popover, .z-handles, .z-drop-indicator, .z-col-handles').length, a: document.getElementById('a')!.innerHTML };
    });
    expect(leaks).toEqual({ left: [], dom: 0, a: '' });
  });

  test('a document that needs a missing extension: edit around it, save, reinstall, recover', async ({ page }) => {
    await page.goto('/packages/zeditor/test/browser/harness.html');
    await page.waitForFunction(() => (window as any).ready === true);
    const original = await page.evaluate(() => (window as any).shared.SHARED_DOCUMENT);
    // 1. open WITHOUT the extensions that define `issue` and `notice`
    await page.evaluate((d) => (window as any).mount({ content: d }), original);
    await expect(page.locator('#a .z-unknown')).toHaveCount(1);
    await expect(page.locator('#a .z-unknown')).toContainText('notice');
    await expect(page.locator('#a .z-atom-unknown')).toHaveCount(2);
    // 2. edit the surrounding text
    await page.locator('[data-zid="sh1"] .z-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' (edited)');
    await page.locator('[data-zid="sp1"] .z-content').click();
    await page.keyboard.press('Home');
    await page.keyboard.type('Note: ');
    // the unknown block cannot be typed into, but can be selected and moved
    await page.locator('#a .z-unknown').click();
    expect((await sel(page)).type).toBe('block');
    await page.keyboard.press('Alt+ArrowUp');
    const saved = await page.evaluate(() => (window as any).z.getJSON());
    expect(saved.blocks.map((b: any) => b.type)).toEqual(['heading', 'notice', 'paragraph']);
    expect(saved.blocks[1]).toEqual(original.blocks[2]); // custom block data untouched
    expect(JSON.stringify(saved.blocks[2])).toContain('"atom":"issue","attrs":{"key":"ZED-102"');
    // 3. reinstall the extensions and open the saved document
    await page.evaluate((d) => {
      const w = window as any;
      w.z.destroy();
      w.mount({ content: d, extensions: [w.shared.issueRefExtension(), w.shared.calloutExtension()] });
    }, saved);
    await expect(page.locator('#a .z-unknown')).toHaveCount(0);
    await expect(page.locator('#a [data-type="notice"]')).toHaveCount(1);
    await expect(page.locator('#a .issue-ref')).toHaveCount(2);
    await expect(page.locator('#a [data-type="notice"] [data-zid="sn1p"]')).toContainText('This text is editable');
    await expect(page.locator('[data-zid="sh1"]')).toHaveText('Release notes (edited)');
    await noErrors(page);
  });

  test('a host renderer that throws falls back to the default and the editor keeps working', async ({ page }) => {
    await open(page, { content: [p('before', 'a'), p('broken', 'b')] }, `o.renderers = { paragraph: (block) => { if (block.id === 'b') throw new Error('renderer exploded'); return window.Z.nodeRenderers.paragraph(block, { editor: null }); } };`);
    await expect(page.locator('#a [data-zid="b"]')).toHaveText('broken');
    await setSel(page, 'b', 6);
    await page.keyboard.type(' but editable');
    expect(await texts(page)).toBe('before|broken but editable');
  });

  test('dropping an image file uploads it at the drop position', async ({ page }) => {
    await open(page, { content: [p('first', 'a'), p('second', 'b')] }, `o.upload = async (file) => ({ url: 'https://cdn.example/' + file.name });`);
    const dropped = await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'dropped.png', { type: 'image/png' }));
      const target = document.querySelector('#a [data-zid="b"] .z-content')!;
      const r = target.getBoundingClientRect();
      const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 });
      const ok = !!ev.dataTransfer && ev.dataTransfer.files.length === 1;
      if (ok) target.dispatchEvent(ev);
      return ok;
    });
    test.skip(!dropped, 'this engine does not let scripts attach files to a synthetic DragEvent');
    await expect(page.locator('#a .z-image img')).toHaveAttribute('src', 'https://cdn.example/dropped.png');
    const j = await json(page);
    // inserted after the block it was dropped on; an empty paragraph follows so typing can continue
    expect(j.map((b: any) => b.type)).toEqual(['paragraph', 'paragraph', 'image', 'paragraph']);
    await noErrors(page);
  });

  test('autosave status, draft recovery after a "crash", and block links', async ({ page }) => {
    await open(page, { content: [p('start', 'a'), p('target block', 'deep')], ui: { statusBar: true } }, `
      window.saves = [];
      o.autosave = { debounce: 50, retryDelays: [60000], draftKey: 'draft-test', save: (doc) => new Promise((resolve, reject) => window.saves.push({ doc, resolve, reject })) };`);
    const status = page.locator('#a .z-status-save');
    await setSel(page, 'a', 5);
    await page.keyboard.type(' typing');
    await expect(status).toHaveText('Saving…');
    await page.keyboard.type(' more'); // edit while the save is in flight
    await page.evaluate(() => (window as any).saves[0].resolve());
    await expect(status).not.toHaveText('Saved'); // the late response must not hide newer edits
    await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(2);
    await page.evaluate(() => (window as any).saves[1].reject(new Error('offline')));
    await expect(status).toHaveText('Save failed');
    // "crash": a new editor with the last server state finds the local draft
    const recovered = await page.evaluate(() => {
      const w = window as any;
      const z2 = w.mount({ content: [{ id: 'a', type: 'paragraph', content: [{ text: 'start' }] }], autosave: { draftKey: 'draft-test', save: async () => {} } }, '#b');
      const had = !!z2.autosave.getDraft();
      z2.autosave.recoverDraft();
      return [had, z2.getJSON().blocks[0].content[0].text];
    });
    expect(recovered).toEqual([true, 'start typing more']);
    // direct link to a block
    const ok = await page.evaluate(() => (window as any).Z.revealBlock((window as any).z.editor, 'deep'));
    expect(ok).toBe(true);
    await expect(page.locator('#a [data-zid="deep"]')).toHaveClass(/z-flash/);
  });
});
