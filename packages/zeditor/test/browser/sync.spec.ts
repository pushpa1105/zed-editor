import { test, expect } from '@playwright/test';
import { open, noErrors, setSel } from './util';

test('block events while typing; remapIds keeps the rendered editor editable', async ({ page }) => {
  await open(page, { mode: 'block' }, `o.content = [{ id: 'a', type: 'paragraph', content: [{ text: 'one' }] }, { id: 'b', type: 'paragraph', content: [{ text: 'two' }] }];`);
  await page.evaluate(() => {
    const z = (window as any).z;
    const log: string[] = ((window as any).log = []);
    for (const ev of ['block:created', 'block:updated', 'block:deleted', 'block:focus']) z.editor.on(ev, (x: any) => log.push(ev + ':' + x.id));
  });
  await setSel(page, 'a', 3);
  await page.keyboard.type('!');
  await page.keyboard.press('Enter');
  await page.keyboard.type('x');
  const log: string[] = await page.evaluate(() => (window as any).log);
  expect(log[0]).toBe('block:updated:a');
  expect(log.some((l) => l.startsWith('block:created:'))).toBe(true);
  expect(log.some((l) => l.startsWith('block:focus:') && !l.endsWith(':a'))).toBe(true);

  const ok = await page.evaluate(() => (window as any).z.editor.remapIds({ a: 'server-a', b: 'server-b' }));
  expect(ok).toBe(true);
  await expect(page.locator('#a [data-zid="server-a"]')).toHaveText('one!');
  await expect(page.locator('#a [data-zid="a"]')).toHaveCount(0);
  await setSel(page, 'server-b', 3);
  await page.keyboard.type('?');
  expect(await page.evaluate(() => (window as any).z.editor.doc.get('server-b').text)).toBe('two?');
  // undo across the rename
  await page.evaluate(() => (window as any).z.editor.commands.undo());
  expect(await page.evaluate(() => (window as any).z.editor.doc.get('server-b').text)).toBe('two');
  await noErrors(page);
});
