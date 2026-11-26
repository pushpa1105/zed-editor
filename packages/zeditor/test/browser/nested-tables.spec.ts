import { test, expect } from '@playwright/test';
import { open, noErrors, setSel } from './util';

const DOC = `o.content = [{ id: 'a', type: 'paragraph', content: [{ text: 'intro' }] }, (() => {
  return { id: 'outer', type: 'table', children: [
    { id: 'r1', type: 'table_row', children: [
      { id: 'c1', type: 'table_cell', children: [{ id: 'p1', type: 'paragraph', content: [{ text: 'left' }] }] },
      { id: 'c2', type: 'table_cell', children: [{ id: 'p2', type: 'paragraph', content: [{ text: 'right' }] }] } ] } ] };
})()];`;

test('a table inside a table cell: insert, type, Tab, tools act on the inner table', async ({ page }) => {
  await open(page, {}, DOC);
  await setSel(page, 'p2', 5);
  await page.locator('#a .z-toolbar [data-id="table"]').click();
  const inner = await page.evaluate(() => {
    const e = (window as any).z.editor;
    const t = [...e.doc.descendants(e.doc.get('outer'))].find((b: any) => b.type === 'table');
    return t?.id ?? null;
  });
  expect(inner).toBeTruthy();
  await page.keyboard.type('A');
  await page.keyboard.press('Tab');
  await page.keyboard.type('B');
  const texts = await page.evaluate((id) => {
    const e = (window as any).z.editor;
    return [...e.doc.descendants(e.doc.get(id))].filter((b: any) => b.content).map((b: any) => b.text).slice(0, 2);
  }, inner);
  expect(texts).toEqual(['A', 'B']);
  // the table tools work on the inner table, which is outlined
  await expect(page.locator(`#a [data-zid="${inner}"]`)).toHaveClass(/z-table-active/);
  await page.locator('#a .z-table-tools [data-cmd="addRow"]').first().click();
  const rows = await page.evaluate((id) => (window as any).z.editor.doc.get(id).children.length, inner);
  expect(rows).toBe(4);
  expect(await page.evaluate(() => (window as any).z.editor.doc.get('outer').children.length)).toBe(1);
  // the outer cell's own text is not covered by the tools bar
  const bar = (await page.locator('#a .z-table-tools').boundingBox())!;
  const p2 = (await page.locator('#a [data-zid="p2"]').boundingBox())!;
  expect(bar.y + bar.height <= p2.y || bar.y >= p2.y + p2.height).toBe(true);
  await noErrors(page);
});
