import { test, expect, Page } from '@playwright/test';
import { open, noErrors } from './util';

const TASKS = `
  o.content = [{ id: 'a', type: 'paragraph', content: [{ text: 'intro' }] }, Z.createDatabase(Z.createHeadlessEditor(), {
    title: 'Tasks',
    properties: [
      { name: 'Name', type: 'title' },
      { name: 'Status', type: 'select', options: [{ id: 'todo', name: 'To do', color: 'gray' }, { id: 'doing', name: 'Doing', color: 'blue' }, { id: 'done', name: 'Done', color: 'green' }] },
      { name: 'Points', type: 'number' },
      { name: 'Due', type: 'date' },
    ],
    rows: [{ Name: 'Design', Status: 'Done', Points: 3 }, { Name: 'Build API', Status: 'Doing', Points: 8 }, { Name: 'Write docs', Status: 'To do', Points: 2 }],
  }), { id: 'b', type: 'paragraph', content: [{ text: 'after' }] }];`;
const db = (page: Page) => page.locator('#a .z-database');
const visibleTitles = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('#a .z-db-row'))
      .filter((r) => !r.hidden)
      .sort((x, y) => Number(x.style.order || 0) - Number(y.style.order || 0))
      .map((r) => (r.querySelector('.z-db-cell[data-type="title"] input') as HTMLInputElement).value),
  );
const model = (page: Page) =>
  page.evaluate(() => {
    const d = [...(window as any).z.editor.doc.descendants()].find((b: any) => b.type === 'database');
    return { props: d.attrs.properties, views: d.attrs.views, rowIds: d.children.map((r: any) => r.id), rows: d.children.map((r: any) => r.attrs.cells) };
  });
async function addView(page: Page, name: string) {
  await db(page).getByRole('button', { name: 'Add view' }).click();
  await page.getByRole('menu', { name: 'Add view' }).getByRole('menuitem', { name: new RegExp('^' + name) }).click();
}

test.describe('databases: block handle and scrolling', () => {
  test('the block handle sits next to the database title and stays while the pointer moves to it', async ({ page }) => {
    await open(page, { mode: 'block' }, TASKS);
    const box = (await db(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
    const handles = page.locator('#a .z-handles');
    await expect(handles).toBeVisible();
    const pos = async () => {
      const h = (await handles.boundingBox())!;
      const t = (await db(page).locator('.z-db-headrow').first().boundingBox())!;
      return { dy: Math.abs(h.y + h.height / 2 - (t.y + t.height / 2)), h };
    };
    const { dy, h } = await pos();
    expect(dy).toBeLessThan(16); // was at the top of the viewport (a hidden row page was measured)
    // walk across the editor's padding to the handle: it must not disappear
    await page.mouse.move(h.x + h.width - 6, h.y + h.height / 2, { steps: 10 });
    await expect(handles).toBeVisible();
    await page.locator('#a .z-handles .z-grip').click();
    await expect(page.locator('#a .z-block-menu')).toBeVisible();
    await noErrors(page);
  });

  test('the wheel over a database scrolls the page', async ({ page }) => {
    await open(page, {}, TASKS);
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.height = '2000px';
      document.body.append(spacer);
      window.scrollTo(0, 0);
    });
    const box = (await db(page).locator('.z-db-body').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 10);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  });
});

test.describe('databases: search, row menu, keyboard, dates', () => {
  test('quick search filters rows without changing the saved view', async ({ page }) => {
    await open(page, {}, TASKS);
    await db(page).getByRole('button', { name: 'Search' }).click();
    await page.keyboard.type('api');
    await expect.poll(() => visibleTitles(page)).toEqual(['Build API']);
    await expect(db(page).locator('.z-db-count')).toHaveText('1 of 3');
    // option names are searched too
    await page.keyboard.press('Control+a');
    await page.keyboard.type('to do');
    await expect.poll(() => visibleTitles(page)).toEqual(['Write docs']);
    expect((await model(page)).views[0].filters).toBeUndefined();
    await page.keyboard.press('Escape');
    await expect.poll(() => visibleTitles(page)).toEqual(['Design', 'Build API', 'Write docs']);
    await noErrors(page);
  });

  test('row menu: insert below, duplicate, delete; right click opens it too', async ({ page }) => {
    await open(page, {}, TASKS);
    const row = (i: number) => db(page).locator('.z-db-row').nth(i);
    await row(0).hover();
    await row(0).getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menu', { name: 'Row actions' }).getByRole('menuitem', { name: 'Insert below' }).click();
    let m = await model(page);
    expect(m.rows.map((r: any) => r.title ?? '')).toEqual(['Design', '', 'Build API', 'Write docs']);
    await row(2).locator('.z-db-cell[data-type="number"]').click({ button: 'right' });
    await page.getByRole('menu', { name: 'Row actions' }).getByRole('menuitem', { name: 'Duplicate row' }).click();
    m = await model(page);
    expect(m.rows.map((r: any) => r.title ?? '')).toEqual(['Design', '', 'Build API', 'Build API', 'Write docs']);
    await row(1).locator('.z-db-cell[data-type="select"]').click({ button: 'right' });
    await page.getByRole('menu', { name: 'Row actions' }).getByRole('menuitem', { name: 'Delete row' }).click();
    m = await model(page);
    expect(m.rows).toHaveLength(4);
    await noErrors(page);
  });

  test('arrow keys move between rows in the order the view shows them', async ({ page }) => {
    await open(page, {}, TASKS);
    const m = await model(page);
    const points = m.props.find((x: any) => x.name === 'Points').id;
    await page.evaluate(([dbId, p]) => (window as any).z.commands.dbSort(dbId, p, 'desc'), [await page.evaluate(() => [...(window as any).z.editor.doc.descendants()].find((b: any) => b.type === 'database').id), points]);
    await expect.poll(() => visibleTitles(page)).toEqual(['Build API', 'Design', 'Write docs']);
    await page.locator('#a .z-db-row input[aria-label="Name"]').nth(1).click(); // Build API (document order 1)
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).value)).toBe('Design');
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).value)).toBe('Write docs');
    await page.keyboard.press('ArrowUp');
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).value)).toBe('Design');
  });

  test('board can hide empty groups', async ({ page }) => {
    await open(page, {}, TASKS);
    await addView(page, 'Board');
    await expect(db(page).locator('.z-db-colhead.z-db-group')).toHaveCount(4); // no value + 3 options
    const dbId = await page.evaluate(() => [...(window as any).z.editor.doc.descendants()].find((b: any) => b.type === 'database').id);
    await page.evaluate((id) => {
      const z = (window as any).z;
      const d = z.editor.doc.get(id);
      const row = d.children.find((r: any) => r.attrs.cells.title === 'Write docs');
      z.commands.dbSetCell(row.id, d.attrs.properties[1].id, 'done');
    }, dbId);
    await expect(db(page).locator('.z-db-colhead.z-db-group')).toHaveCount(4);
    await db(page).getByRole('button', { name: 'Group' }).click();
    await page.getByRole('dialog').getByLabel('Hide empty groups').check();
    await expect(db(page).locator('.z-db-colhead.z-db-group')).toHaveCount(2); // "no value" and "To do" are empty now
    expect((await model(page)).views[1].hideEmptyGroups).toBe(true);
    await noErrors(page);
  });

  test('"New" always shows the new row: calendar and timeline date it today, boards put it in the first lane', async ({ page }) => {
    await open(page, {}, TASKS);
    for (const v of ['Calendar', 'Timeline', 'Board']) {
      await addView(page, v);
      const before = (await model(page)).rowIds.length;
      await db(page).locator('.z-db-newbtn').click();
      const m = await model(page);
      expect(m.rowIds.length).toBe(before + 1);
      const row = page.locator(`#a [data-zid="${m.rowIds.at(-1)}"]`);
      await expect(row).toBeVisible();
      await expect(row.locator('input[aria-label="Name"]')).toBeFocused();
      if (v === 'Board') expect(m.rows.at(-1)[m.props[1].id]).toBe('todo');
      await page.keyboard.press('Escape');
    }
    await noErrors(page);
  });

  test('dragging a calendar entry to another day changes its date; a click still edits it', async ({ page }) => {
    await open(page, {}, TASKS);
    const m = await model(page);
    const due = m.props.find((x: any) => x.name === 'Due').id;
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const now = new Date();
    const first = iso(new Date(now.getFullYear(), now.getMonth(), 10));
    const target = iso(new Date(now.getFullYear(), now.getMonth(), 20));
    await page.evaluate(([row, prop, day]) => (window as any).z.commands.dbSetCell(row, prop, day), [m.rowIds[0], due, first]);
    await addView(page, 'Calendar');
    const card = page.locator(`#a [data-zid="${m.rowIds[0]}"]`);
    await expect(card).toBeVisible();
    const a = (await card.boundingBox())!;
    const b = (await page.locator(`#a .z-db-day[data-date="${target}"]`).boundingBox())!;
    await page.mouse.move(a.x + 12, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await model(page)).rows[0][due]).toBe(target);
    await card.locator('input[aria-label="Name"]').click();
    await expect(card.locator('input[aria-label="Name"]')).toBeFocused();
    await noErrors(page);
  });
});
