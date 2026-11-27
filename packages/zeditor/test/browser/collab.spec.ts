import { test, expect, Page } from '@playwright/test';
import { MOD } from './util';

const txt = (page: Page, i: number) =>
  page.evaluate((i) => {
    const out: string[] = [];
    for (const b of (window as any).clients[i].z.editor.doc.descendants()) if (b.content) out.push(b.text);
    return out.join('|');
  }, i);
const doc = (page: Page, i: number) => page.evaluate((i) => (window as any).clients[i].z.getJSON().blocks, i);
const settle = (page: Page) => page.waitForTimeout(80);
async function caret(page: Page, i: number, id: string, offset: number, f = offset) {
  await page.evaluate(
    ([i, id, a, f]) => {
      const z = (window as any).clients[i].z;
      z.focus();
      z.editor.setSelection({ type: 'text', anchor: { id, offset: a }, focus: { id, offset: f } });
      z.view.syncSelectionToDOM(true);
    },
    [i, id, offset, f] as const,
  );
}

test.describe('two-client collaboration example', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/collab/');
    await page.waitForFunction(() => (window as any).ready === true);
  });

  test('second client receives the document; concurrent typing merges; DOM of both stays in sync', async ({ page }) => {
    expect(await doc(page, 1)).toEqual(await doc(page, 0));
    await caret(page, 0, 'p', 0);
    await page.keyboard.type('Ann: ');
    await caret(page, 1, 'p', 51);
    await page.keyboard.type(' (Bob)');
    await settle(page);
    expect(await txt(page, 0)).toBe('Shared notes|Ann: Edit this paragraph from both clients at once. (Bob)');
    expect(await doc(page, 1)).toEqual(await doc(page, 0));
    const dom = await page.evaluate(() => Array.from(document.querySelectorAll('.client')).map((c) => (c.querySelector('[data-zid="p"] .z-content') as HTMLElement).innerText));
    expect(dom[0]).toBe(dom[1]);
    expect(dom[0]).toBe('Ann: Edit this paragraph from both clients at once. (Bob)');
  });

  test('two people typing at the same caret position: their text does not interleave', async ({ page }) => {
    // Bob's caret sits at the same offset (no focus needed: he "types" through the command)
    await page.evaluate(() => (window as any).clients[1].z.editor.setSelection({ type: 'text', anchor: { id: 'p', offset: 4 }, focus: { id: 'p', offset: 4 } }));
    await caret(page, 0, 'p', 4);
    const ann = 'ANN';
    const bob = 'bob';
    for (let i = 0; i < 3; i++) {
      await page.keyboard.type(ann[i]); // real key events in Ann's editor
      await page.evaluate((ch) => (window as any).clients[1].z.commands.insertText(ch), bob[i]);
      await settle(page);
    }
    const text = await txt(page, 0);
    expect(text).toContain(ann);
    expect(text).toContain(bob);
    expect(text.length).toBe('Shared notes|Edit this paragraph from both clients at once.'.length + 6);
    expect(await doc(page, 1)).toEqual(await doc(page, 0));
    const dom = await page.evaluate(() => Array.from(document.querySelectorAll('.client')).map((c) => (c.querySelector('[data-zid="p"] .z-content') as HTMLElement).innerText));
    expect(dom[0]).toBe(dom[1]);
    expect(dom[0]).toBe(text.split('|')[1]);
    // Ann's native caret is right after her own text
    const caretOffset = await page.evaluate(() => (window as any).clients[0].z.editor.selection.focus.offset);
    expect(text.split('|')[1].slice(0, caretOffset).endsWith(ann)).toBe(true);
  });

  test('Enter by one person while the other types after the split point: nothing is duplicated or left behind', async ({ page }) => {
    // "Edit this paragraph from both clients at once." Bob's caret is before "at once."
    await page.evaluate(() => (window as any).clients[1].z.editor.setSelection({ type: 'text', anchor: { id: 'p', offset: 38 }, focus: { id: 'p', offset: 38 } }));
    await caret(page, 0, 'p', 19); // Ann: after "Edit this paragraph"
    // both act before either has heard of the other
    await page.evaluate(() => (window as any).clients.forEach((c: any) => c.sync.disconnect()));
    await page.keyboard.press('Enter');
    await page.keyboard.type('>');
    await page.evaluate(() => (window as any).clients[1].z.commands.insertText('all '));
    await page.evaluate(() => (window as any).clients.forEach((c: any) => c.sync.connect()));
    await settle(page);
    expect(await txt(page, 0)).toBe('Shared notes|Edit this paragraph|> from both clients all at once.');
    expect(await doc(page, 1)).toEqual(await doc(page, 0));
    // Bob's caret went with his text into the new paragraph, and he can keep typing there
    const bob = await page.evaluate(() => (window as any).clients[1].z.editor.selection.focus);
    expect(bob.id).not.toBe('p');
    await page.evaluate(() => (window as any).clients[1].z.commands.insertText('together '));
    await settle(page);
    expect(await txt(page, 0)).toBe('Shared notes|Edit this paragraph|> from both clients all together at once.');
    // both press Backspace / Delete to join the two paragraphs again: the text exists once
    const second = await page.evaluate(() => (window as any).clients[0].z.editor.doc.blocks[2].id);
    await page.evaluate(() => (window as any).clients.forEach((c: any) => c.sync.disconnect()));
    await caret(page, 0, second, 0);
    await page.keyboard.press('Backspace');
    await page.evaluate(() => {
      const z = (window as any).clients[1].z;
      z.editor.setSelection({ type: 'text', anchor: { id: 'p', offset: 19 }, focus: { id: 'p', offset: 19 } });
      z.commands.deleteForward();
    });
    await page.evaluate(() => (window as any).clients.forEach((c: any) => c.sync.connect()));
    await settle(page);
    expect(await txt(page, 0)).toBe('Shared notes|Edit this paragraph> from both clients all together at once.');
    expect(await doc(page, 1)).toEqual(await doc(page, 0));
    const dom = await page.evaluate(() => Array.from(document.querySelectorAll('.client')).map((c) => (c.querySelector('[data-zid="p"] .z-content') as HTMLElement).innerText));
    expect(dom[0]).toBe(dom[1]);
    expect(dom[0]).toBe('Edit this paragraph> from both clients all together at once.');
  });

  test('presence: names, remote caret and remote selection are rendered', async ({ page }) => {
    await expect(page.locator('.client').nth(0).locator('.peers')).toHaveText('with Bob');
    await caret(page, 1, 'p', 5, 9); // Bob selects "this"
    await settle(page);
    const ann = page.locator('.client').nth(0);
    await expect(ann.locator('.z-remote-caret')).toHaveCount(1);
    await expect(ann.locator('.z-remote-label')).toHaveText('Bob');
    const supported = await page.evaluate(() => !!(CSS as any).highlights);
    if (supported) expect(await page.evaluate(() => [...(CSS as any).highlights.keys()].some((k: string) => k.startsWith('z-remote-')))).toBe(true);
    // the caret is positioned inside Ann's editor, on the selected paragraph
    const pos = await page.evaluate(() => {
      const c = document.querySelectorAll('.client')[0];
      const caret = c.querySelector('.z-remote-caret')!.getBoundingClientRect();
      const para = c.querySelector('[data-zid="p"]')!.getBoundingClientRect();
      return caret.top >= para.top - 2 && caret.bottom <= para.bottom + 2 && caret.left > para.left;
    });
    expect(pos).toBe(true);
  });

  test('offline changes on both sides merge after reconnecting', async ({ page }) => {
    const bob = page.locator('.client').nth(1);
    await bob.getByRole('button', { name: 'Go offline' }).click();
    await expect(bob.locator('.dot')).toHaveClass(/off/);
    await expect(page.locator('.client').nth(0).locator('.peers')).toHaveText('alone');
    await caret(page, 1, 'p', 51);
    await page.keyboard.type(' Offline note.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second offline line');
    await caret(page, 0, 'h', 12);
    await page.keyboard.type(' (online edit)');
    await settle(page);
    expect(await txt(page, 0)).toBe('Shared notes (online edit)|Edit this paragraph from both clients at once.');
    expect(await txt(page, 1)).toBe('Shared notes|Edit this paragraph from both clients at once. Offline note.|Second offline line');
    await bob.getByRole('button', { name: 'Reconnect' }).click();
    await settle(page);
    const merged = 'Shared notes (online edit)|Edit this paragraph from both clients at once. Offline note.|Second offline line';
    expect(await txt(page, 0)).toBe(merged);
    expect(await txt(page, 1)).toBe(merged);
    expect(await doc(page, 1)).toEqual(await doc(page, 0));
    await expect(page.locator('.client').nth(0).locator('.peers')).toHaveText('with Bob');
  });

  test("undo reverts my edit and keeps the other author's independent edit", async ({ page }) => {
    await caret(page, 0, 'p', 0);
    await page.keyboard.type('AAA ');
    await settle(page);
    await caret(page, 1, 'h', 12);
    await page.keyboard.type(' BBB');
    await settle(page);
    expect(await txt(page, 0)).toBe('Shared notes BBB|AAA Edit this paragraph from both clients at once.');
    // Ann undoes with the keyboard in her editor
    await caret(page, 0, 'p', 4);
    await page.keyboard.press(`${MOD}+z`);
    await settle(page);
    expect(await txt(page, 0)).toBe('Shared notes BBB|Edit this paragraph from both clients at once.');
    expect(await txt(page, 1)).toBe('Shared notes BBB|Edit this paragraph from both clients at once.');
    await page.keyboard.press(`${MOD}+y`);
    await settle(page);
    expect(await txt(page, 1)).toBe('Shared notes BBB|AAA Edit this paragraph from both clients at once.');
  });

  test('structure edits (lists, table, move) replicate with both DOMs equal', async ({ page }) => {
    await caret(page, 0, 'p', 51);
    await page.keyboard.press('Enter');
    await page.keyboard.type('- item one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('item two');
    await page.evaluate(() => (window as any).clients[1].z.focus());
    await caret(page, 1, 'h', 0);
    await page.evaluate(() => (window as any).clients[1].z.commands.insertTable(2, 2));
    await page.keyboard.type('cell');
    await settle(page);
    expect(await doc(page, 1)).toEqual(await doc(page, 0));
    const shapes = await page.evaluate(() => Array.from(document.querySelectorAll('.client')).map((c) => [c.querySelectorAll('.z-list').length, c.querySelectorAll('.z-cell').length, (c.querySelector('.z-cell') as HTMLElement).innerText.trim()]));
    expect(shapes[0]).toEqual([2, 4, 'cell']);
    expect(shapes[1]).toEqual(shapes[0]);
  });
});
