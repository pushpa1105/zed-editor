import { test, expect, Page } from '@playwright/test';
import { open, json, setSel, noErrors, p, MOD } from './util';

const TASKS = `
  o.content = [{ id: 'a', type: 'paragraph', content: [{ text: 'intro' }] }, Z.createDatabase(Z.createHeadlessEditor(), {
    title: 'Tasks',
    properties: [
      { name: 'Name', type: 'title' },
      { name: 'Status', type: 'select', options: [{ id: 'todo', name: 'To do', color: 'gray' }, { id: 'doing', name: 'Doing', color: 'blue' }, { id: 'done', name: 'Done', color: 'green' }] },
      { name: 'Points', type: 'number' },
      { name: 'Shipped', type: 'checkbox' },
    ],
    rows: [{ Name: 'Design', Status: 'Done', Points: 3, Shipped: true }, { Name: 'Build API', Status: 'Doing', Points: 8 }, { Name: 'Write docs', Status: 'To do', Points: 2 }],
  })];`;
const db = (page: Page) => page.locator('#a .z-database');
async function addView(page: Page, name: string) {
  await db(page).getByRole('button', { name: 'Add view' }).click();
  await page.getByRole('menu', { name: 'Add view' }).getByRole('menuitem', { name: new RegExp('^' + name) }).click();
}
async function typeInto(page: Page, target: import('@playwright/test').Locator, text: string, commit: string | null = 'Tab') {
  await target.click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type(text);
  if (commit) await page.keyboard.press(commit);
}
const visibleTitles = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('#a .z-db-row'))
      .filter((r) => !r.hidden)
      .sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top || x.getBoundingClientRect().left - y.getBoundingClientRect().left)
      .map((r) => (r.querySelector('.z-db-cell[data-type="title"] input') as HTMLInputElement).value),
  );
const model = (page: Page) =>
  page.evaluate(() => {
    const z = (window as any).z;
    const d = [...z.editor.doc.descendants()].find((b: any) => b.type === 'database');
    return { id: d.id, props: d.attrs.properties, views: d.attrs.views, rowIds: d.children.map((r: any) => r.id), rows: d.children.map((r: any) => r.attrs.cells) };
  });
const computed = (page: Page, propId: string) => page.locator(`#a .z-db-cell[data-prop="${propId}"] .z-db-computed`).allTextContents();

test.describe('databases: computed properties', () => {
  test('formula property: written in the settings, evaluated per row, errors shown, never editable', async ({ page }) => {
    await open(page, {}, TASKS);
    await db(page).getByRole('button', { name: 'Add property' }).click();
    await page.getByRole('menuitem', { name: /^Formula/ }).click();
    const menu = page.getByRole('dialog');
    await typeInto(page, menu.getByLabel('Formula'), 'prop("Points") * 2 + 1', null);
    await expect(menu.getByRole('status')).not.toHaveClass(/z-db-error/);
    await page.keyboard.press('Tab');
    const m = await model(page);
    const f = m.props[4];
    expect(f).toMatchObject({ type: 'formula', formula: 'prop("Points") * 2 + 1' });
    await expect.poll(() => computed(page, f.id)).toEqual(['7', '17', '5']);
    await page.keyboard.press('Escape');
    // follows the cells it reads
    await typeInto(page, page.locator('#a .z-db-row').nth(0).getByLabel('Points'), '10');
    await expect.poll(() => computed(page, f.id)).toEqual(['21', '17', '5']);
    // a broken formula is reported while typing and in the cells; it never throws
    await page.locator(`#a .z-db-colhead[data-prop="${f.id}"]`).click();
    await typeInto(page, page.getByRole('dialog').getByLabel('Formula'), 'nope(1)', null);
    await expect(page.getByRole('dialog').getByRole('status')).toHaveClass(/z-db-error/);
    await page.keyboard.press('Tab');
    await expect.poll(async () => (await computed(page, f.id))[0]).toContain('#ERR');
    // computed cells have no input and the command refuses to write them
    await expect(page.locator(`#a .z-db-cell[data-prop="${f.id}"] input`)).toHaveCount(0);
    expect(await page.evaluate(([row, prop]) => (window as any).z.commands.dbSetCell(row, prop, 'x'), [m.rowIds[0], f.id])).toBe(false);
    await noErrors(page);
  });

  test('relation picker links rows and a rollup summarizes them', async ({ page }) => {
    await open(page, {}, TASKS);
    let m = await model(page);
    await page.evaluate(([id, points]) => {
      const z = (window as any).z;
      z.commands.dbAddProperty(id, { type: 'relation', name: 'Blocks', relation: { database: id } });
      const rel = z.editor.storage.db.lastProperty;
      z.commands.dbAddProperty(id, { type: 'rollup', name: 'Blocked points', rollup: { relation: rel, target: points, calc: 'sum' } });
    }, [m.id, m.props[2].id]);
    m = await model(page);
    const [rel, roll] = [m.props[4], m.props[5]];
    const first = page.locator('#a .z-db-row').nth(0);
    await first.getByRole('button', { name: 'Blocks' }).click();
    const picker = page.getByRole('dialog', { name: 'Blocks' });
    await expect(picker.getByRole('option')).toHaveCount(2); // every row but itself
    await picker.getByRole('option', { name: 'Build API' }).click();
    await picker.getByRole('option', { name: 'Write docs' }).click();
    await expect(picker.getByRole('option', { name: 'Build API' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(first.locator('.z-db-rel')).toHaveText(['Build API', 'Write docs']);
    expect((await model(page)).rows[0][rel.id]).toEqual([m.rowIds[1], m.rowIds[2]]);
    await expect.poll(async () => (await computed(page, roll.id))[0]).toBe('10');
    // the rollup follows the related rows
    await typeInto(page, page.locator('#a .z-db-row').nth(1).getByLabel('Points', { exact: true }), '20');
    await expect.poll(async () => (await computed(page, roll.id))[0]).toBe('22');
    // deleting a related row drops it from the relation's display
    await page.evaluate((rid) => (window as any).z.commands.dbDeleteRow(rid), m.rowIds[2]);
    await expect(first.locator('.z-db-rel')).toHaveText(['Build API']);
    await expect.poll(async () => (await computed(page, roll.id))[0]).toBe('20');
    await noErrors(page);
  });
});

test.describe('databases: more views and layout', () => {
  test('calendar places rows on their day; timeline draws them as bars', async ({ page }) => {
    await open(page, {}, TASKS);
    await addView(page, 'Calendar');
    await expect(db(page)).toHaveAttribute('data-view', 'calendar');
    let m = await model(page);
    const date = m.props.find((x: any) => x.type === 'date'); // created with the view
    expect(date).toBeTruthy();
    expect(await visibleTitles(page)).toEqual([]); // nothing has a date yet
    await expect(page.locator('#a .z-db-hint')).toContainText('3 not shown');
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await page.evaluate(([row, prop, day]) => (window as any).z.commands.dbSetCell(row, prop, day), [m.rowIds[1], date.id, today]);
    await expect.poll(() => visibleTitles(page)).toEqual(['Build API']);
    // the card sits inside today's cell
    const inside = await page.evaluate(() => {
      const cell = document.querySelector('#a .z-db-day.z-db-todaycell')!.getBoundingClientRect();
      const card = Array.from(document.querySelectorAll<HTMLElement>('#a .z-db-row')).find((r) => !r.hidden)!.getBoundingClientRect();
      return card.left >= cell.left - 1 && card.right <= cell.right + 1 && card.top >= cell.top - 1 && card.bottom <= cell.bottom + 1;
    });
    expect(inside).toBe(true);
    // "+" on a day adds a row dated that day
    await page.locator('#a .z-db-day.z-db-todaycell').hover({ position: { x: 8, y: 8 } });
    await page.locator('#a .z-db-day.z-db-todaycell .z-db-dayadd').click();
    m = await model(page);
    expect(m.rows).toHaveLength(4);
    expect(m.rows[3][date.id]).toBe(today);
    // other months do not show it
    await db(page).getByRole('button', { name: 'Next month' }).click();
    await expect.poll(async () => (await visibleTitles(page)).length).toBe(0);
    await db(page).getByRole('button', { name: 'Today' }).click();
    await expect.poll(async () => (await visibleTitles(page)).length).toBe(2);

    await addView(page, 'Timeline');
    await expect(db(page)).toHaveAttribute('data-view', 'timeline');
    await expect(page.locator('#a .z-db-tlday')).toHaveCount(28);
    await expect.poll(async () => (await visibleTitles(page)).length).toBe(2);
    // bars start in today's column and are wide enough to read
    const bar = await page.evaluate(() => {
      const col = document.querySelector('#a .z-db-tlday.z-db-todaycell')!.getBoundingClientRect();
      const r = Array.from(document.querySelectorAll<HTMLElement>('#a .z-db-row')).find((x) => !x.hidden)!.getBoundingClientRect();
      return { dx: Math.abs(r.left - col.left), width: r.width };
    });
    expect(bar.dx).toBeLessThan(8);
    expect(bar.width).toBeGreaterThan(100);
    await noErrors(page);
  });

  test('table columns resize by the handle and reorder by dragging the header', async ({ page }) => {
    await open(page, {}, TASKS);
    const m = await model(page);
    const points = page.locator(`#a .z-db-colhead[data-prop="${m.props[2].id}"]`);
    const before = (await points.boundingBox())!;
    const handle = (await points.locator('.z-db-resize').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 40, handle.y + 4, { steps: 4 });
    await page.mouse.move(handle.x + handle.width / 2 + 70, handle.y + 4, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await model(page)).props[2].width).toBe(Math.round(before.width + 70));
    await expect.poll(async () => Math.round((await points.boundingBox())?.width ?? 0)).toBe(Math.round(before.width + 70));
    await expect(page.getByRole('dialog')).toHaveCount(0); // a drag is not a click
    // cells follow the header
    const cell = (await page.locator(`#a .z-db-row .z-db-cell[data-prop="${m.props[2].id}"]`).first().boundingBox())!;
    expect(Math.round(cell.width)).toBe(Math.round(before.width + 70));

    // drag "Shipped" in front of "Status"
    const shipped = (await page.locator(`#a .z-db-colhead[data-prop="${m.props[3].id}"]`).boundingBox())!;
    const status = (await page.locator(`#a .z-db-colhead[data-prop="${m.props[1].id}"]`).boundingBox())!;
    await page.mouse.move(shipped.x + 30, shipped.y + shipped.height / 2);
    await page.mouse.down();
    await page.mouse.move(shipped.x - 20, shipped.y + shipped.height / 2, { steps: 4 });
    await page.mouse.move(status.x + 10, status.y + status.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await model(page)).props.map((x: any) => x.name)).toEqual(['Name', 'Shipped', 'Status', 'Points']);
    await expect(page.locator('#a .z-db-colhead[data-prop] .z-db-colname')).toHaveText(['Name', 'Shipped', 'Status', 'Points']);
    // and from the menu, for keyboard users
    await page.locator(`#a .z-db-colhead[data-prop="${m.props[3].id}"]`).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Move right' }).click();
    await expect.poll(async () => (await model(page)).props.map((x: any) => x.name)).toEqual(['Name', 'Status', 'Shipped', 'Points']);
    await page.keyboard.press(`${MOD}+z`);
    await noErrors(page);
  });

  test('filters can match all or any', async ({ page }) => {
    await open(page, {}, TASKS);
    await db(page).getByRole('button', { name: 'Filter' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('button', { name: '+ Filter' }).click();
    await dlg.getByLabel('Property').selectOption({ label: 'Status' });
    await dlg.getByLabel('Condition').selectOption('is');
    await dlg.getByLabel('Filter value').fill('done');
    await dlg.getByLabel('Filter value').press('Tab');
    await expect(dlg.getByLabel('Match')).toHaveCount(0); // only offered with two or more filters
    await dlg.getByRole('button', { name: '+ Filter' }).click();
    await dlg.getByLabel('Property').nth(1).selectOption({ label: 'Points' });
    await dlg.getByLabel('Condition').nth(1).selectOption('gt');
    await dlg.getByLabel('Filter value').nth(1).fill('5');
    await dlg.getByLabel('Filter value').nth(1).press('Tab');
    await expect.poll(() => visibleTitles(page)).toEqual([]); // done AND > 5
    await dlg.getByLabel('Match').selectOption('or');
    await expect.poll(() => visibleTitles(page)).toEqual(['Design', 'Build API']); // done OR > 5
    expect((await model(page)).views[0].filterMode).toBe('or');
    await expect(db(page).locator('.z-db-badge')).toHaveText('2');
    await noErrors(page);
  });

  test('board lanes are full height and pack their cards independently', async ({ page }) => {
    await open(page, {}, TASKS);
    await addView(page, 'Board');
    const geo = await page.evaluate(() => {
      const lanes = Array.from(document.querySelectorAll<HTMLElement>('#a .z-db-lane')).map((l) => l.getBoundingClientRect());
      const cards = Array.from(document.querySelectorAll<HTMLElement>('#a .z-db-row')).filter((r) => !r.hidden).map((r) => r.getBoundingClientRect());
      return { heights: lanes.map((l) => Math.round(l.height)), tops: cards.map((c) => Math.round(c.top)), bottoms: cards.map((c) => c.bottom), laneBottom: lanes[0].bottom, scrollLeft: document.querySelector('#a .z-db-scroll')!.scrollLeft };
    });
    expect(new Set(geo.heights).size).toBe(1); // every lane is as tall as the tallest
    expect(new Set(geo.tops).size).toBe(1); // one card per lane, all at the top
    for (const b of geo.bottoms) expect(b).toBeLessThan(geo.laneBottom);
    expect(geo.scrollLeft).toBe(0);
    // the grouped property is not repeated on the cards
    await expect(page.locator('#a .z-db-row .z-db-grouped').first()).toBeHidden();
    await noErrors(page);
  });
});

test.describe('insert menu, sub-pages, synced copies', () => {
  test('toolbar Insert lists the slash items, filters them and runs one on the current block', async ({ page }) => {
    await open(page, { content: [p('hello', 'a'), p('', 'b')] });
    await setSel(page, 'b', 0);
    await page.locator('#a .z-tool-insert').click();
    const menu = page.locator('#a .z-insert-menu');
    await expect(menu).toBeVisible();
    await expect(page.locator('#a .z-tool-insert')).toHaveAttribute('aria-expanded', 'true');
    expect(await menu.getByRole('menuitem').count()).toBeGreaterThan(15);
    await page.keyboard.type('timel');
    await expect(menu.getByRole('menuitem')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(db(page)).toHaveAttribute('data-view', 'timeline');
    expect((await json(page)).map((b: any) => b.type)).toContain('database');
    expect((await json(page))[0].content[0].text).toBe('hello');
    // Escape closes without changing anything
    await page.locator('#a .z-tool-insert').click();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await noErrors(page);
  });

  test('sub-pages nest under their parent, show breadcrumbs and can move to the top level', async ({ page }) => {
    await open(page, { content: [p('one', 'a')] });
    await page.evaluate(() => {
      const z = (window as any).z;
      z.commands.enablePages();
      z.commands.addSubPage(undefined, 'Child');
      z.commands.addSubPage(undefined, 'Grandchild');
    });
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.getByRole('tab').nth(1)).toHaveAttribute('data-depth', '1');
    await expect(page.getByRole('tab').nth(2)).toHaveAttribute('data-depth', '2');
    const crumbs = page.locator('#a .z-breadcrumbs');
    await expect(crumbs).toBeVisible();
    await expect(crumbs.locator('.z-crumb')).toHaveText(['Page 1', 'Child', 'Grandchild']);
    await expect(crumbs.locator('.z-crumb[aria-current="page"]')).toHaveText('Grandchild');
    await crumbs.locator('.z-crumb', { hasText: 'Child' }).first().click();
    await expect(page.getByRole('tab', { selected: true })).toContainText('Child');
    await expect(crumbs.locator('.z-crumb')).toHaveText(['Page 1', 'Child']);
    // removing the middle page re-parents its child
    const ids = await page.evaluate(() => (window as any).z.getJSON().blocks.map((b: any) => b.id));
    await page.evaluate((id) => (window as any).z.commands.removePage(id), ids[1]);
    await expect(page.getByRole('tab')).toHaveCount(2);
    expect((await json(page))[1].attrs.parent).toBe(ids[0]);
    await page.evaluate((id) => (window as any).z.commands.setPageParent(id, null), ids[2]);
    await expect(page.getByRole('tab').nth(1)).toHaveAttribute('data-depth', '0');
    // a page can never become its own ancestor
    await page.evaluate(([a, b]) => (window as any).z.commands.setPageParent(b, a), [ids[0], ids[2]]);
    expect(await page.evaluate(([a, b]) => (window as any).z.commands.setPageParent(a, b), [ids[0], ids[2]])).toBe(false);
    await noErrors(page);
  });

  test('a synced copy mirrors its source, is not editable and jumps to the original', async ({ page }) => {
    await open(page, { content: [p('hello', 'a'), p('tail', 'b')] });
    await page.evaluate(() => (window as any).z.commands.insertSyncedCopy('a', { after: 'b' }));
    const body = page.locator('#a .z-synced-body');
    await expect(body).toHaveText('hello');
    await setSel(page, 'a', 5);
    await page.keyboard.type(' world');
    await expect(body).toHaveText('hello world');
    expect((await json(page)).map((b: any) => b.type)).toEqual(['paragraph', 'paragraph', 'synced']);
    await page.locator('#a .z-synced-go').click();
    expect(await page.evaluate(() => (window as any).z.editor.selection.focus.id)).toBe('a');
    // deleting the source leaves a marked, harmless placeholder
    await page.evaluate(() => (window as any).z.editor.update((tr: any) => tr.remove('a')));
    await expect(page.locator('#a .z-synced')).toHaveClass(/z-missing/);
    await noErrors(page);
  });
});
