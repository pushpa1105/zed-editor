import { test, expect, Page } from '@playwright/test';
import { open, root, json, setSel, noErrors, p, MOD } from './util';

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
/** Type into a control that lives inside the editable area with real key events (see docs/testing.md on `fill`). */
async function typeInto(page: Page, target: import('@playwright/test').Locator, text: string, commit: string | null = 'Tab') {
  await target.click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type(text);
  if (commit) await page.keyboard.press(commit);
}
/** titles of visible rows in visual order (rows are ordered with CSS `order`) */
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
    return { id: d.id, title: d.attrs.title, props: d.attrs.properties, views: d.attrs.views, view: d.attrs.view, rows: d.children.map((r: any) => r.attrs.cells) };
  });

test.describe('databases', () => {
  test('slash command creates a database; cells, options and rows are editable; undo works', async ({ page }) => {
    await open(page, { content: [p('', 'a')], mode: 'block' });
    await root(page).click();
    await page.keyboard.type('/database');
    await expect(page.locator('#a .z-typeahead .z-menu-item')).toHaveCount(4);
    await page.keyboard.press('Enter');
    await expect(db(page)).toBeVisible();
    await expect(db(page)).toHaveAttribute('data-view', 'table');
    await expect(page.locator('#a .z-db-row')).toHaveCount(3);
    // title, then cells: Enter moves down the column like a spreadsheet
    await typeInto(page, db(page).getByLabel('Untitled database'), 'Roadmap', 'Enter');
    const titles = page.locator('#a .z-db-cell[data-type="title"] input');
    await titles.nth(0).click();
    await page.keyboard.type('First');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second');
    await page.keyboard.press('Enter');
    let m = await model(page);
    expect(m.title).toBe('Roadmap');
    expect(m.rows.map((r: any) => r.title)).toEqual(['First', 'Second', undefined]);
    // pick a select option, then create a new one from the search box
    await page.locator('#a .z-db-row').nth(0).getByRole('button', { name: 'Status' }).click();
    await page.getByRole('option').filter({ hasText: 'In progress' }).click();
    await expect(page.locator('#a .z-db-row').nth(0).locator('.z-db-chip')).toHaveText('In progress');
    await page.locator('#a .z-db-row').nth(1).getByRole('button', { name: 'Status' }).click();
    await page.getByPlaceholder('Search or create…').fill('Blocked');
    await page.getByRole('button', { name: 'Create "Blocked"' }).click();
    await expect(page.locator('#a .z-db-row').nth(1).locator('.z-db-chip')).toHaveText('Blocked');
    m = await model(page);
    expect(m.props[1].options.map((o: any) => o.name)).toEqual(['To do', 'In progress', 'Done', 'Blocked']);
    // multi-select keeps the picker open
    await page.locator('#a .z-db-row').nth(0).getByRole('button', { name: 'Tags' }).click();
    await page.getByPlaceholder('Search or create…').fill('urgent');
    await page.keyboard.press('Enter');
    await page.getByPlaceholder('Search or create…').fill('ui');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.locator('#a .z-db-row').nth(0).locator('.z-db-cell[data-type="multi_select"] .z-db-chip')).toHaveText(['urgent', 'ui']);
    // rows
    await db(page).getByRole('button', { name: '+ New' }).click();
    await page.keyboard.type('Added');
    await page.keyboard.press('Tab');
    await expect(page.locator('#a .z-db-row')).toHaveCount(4);
    await page.locator('#a .z-db-row').nth(2).hover();
    await page.locator('#a .z-db-row').nth(2).getByRole('button', { name: 'Delete row' }).click();
    await expect(page.locator('#a .z-db-row')).toHaveCount(3);
    expect((await model(page)).rows.map((r: any) => r.title)).toEqual(['First', 'Second', 'Added']);
    // undo steps back through database edits like any other edit
    await page.evaluate(() => (window as any).z.focus());
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.locator('#a .z-db-row')).toHaveCount(4);
    await noErrors(page);
  });

  test('properties: add, rename, change type, hide, calculate', async ({ page }) => {
    await open(page, {}, TASKS);
    await db(page).getByRole('button', { name: 'Add property' }).click();
    await expect(page.locator('#a .z-db-colhead[data-prop]')).toHaveCount(5);
    await page.locator('#a .z-db-colhead[data-prop]').nth(4).click();
    const menu = page.getByRole('dialog');
    await menu.getByLabel('Rename').fill('Owner');
    await menu.getByLabel('Rename').press('Tab');
    await menu.getByLabel('Type').selectOption('person');
    let m = await model(page);
    expect(m.props[4]).toMatchObject({ name: 'Owner', type: 'person' });
    // calculation footer
    await page.locator('#a .z-db-colhead', { hasText: 'Points' }).click();
    await page.getByRole('dialog').getByLabel('Calculate').selectOption('sum');
    await page.keyboard.press('Escape');
    await expect(page.locator('#a .z-db-calccell[data-prop="' + m.props[2].id + '"]')).toHaveText('sum 13');
    // editing a number updates the footer
    await typeInto(page, page.locator('#a .z-db-row').nth(0).getByLabel('Points'), '10');
    await expect(page.locator('#a .z-db-calccell[data-prop="' + m.props[2].id + '"]')).toHaveText('sum 20');
    // checkbox
    await page.locator('#a .z-db-row').nth(1).getByRole('checkbox', { name: 'Shipped' }).click();
    expect((await model(page)).rows[1][m.props[3].id]).toBe(true);
    // hide a property in this view only
    await db(page).getByRole('button', { name: 'Properties' }).click();
    await page.getByRole('dialog').getByLabel('Shipped').uncheck();
    await page.keyboard.press('Escape');
    await expect(page.locator('#a .z-db-colhead[data-prop]')).toHaveCount(4);
    m = await model(page);
    expect(m.views[0].hidden).toEqual([m.props[3].id]);
    expect(m.rows[1][m.props[3].id]).toBe(true); // the data is still there
    await noErrors(page);
  });

  test('sort and filter change what is shown, not the document order', async ({ page }) => {
    await open(page, {}, TASKS);
    expect(await visibleTitles(page)).toEqual(['Design', 'Build API', 'Write docs']);
    await db(page).getByRole('button', { name: 'Sort' }).click();
    await page.getByRole('dialog').getByLabel('Sort', { exact: true }).selectOption({ label: 'Points' });
    await page.keyboard.press('Escape');
    await expect.poll(() => visibleTitles(page)).toEqual(['Write docs', 'Design', 'Build API']);
    await db(page).getByRole('button', { name: 'Sort' }).click();
    await page.getByRole('dialog').getByLabel('Direction').selectOption('desc');
    await page.keyboard.press('Escape');
    await expect.poll(() => visibleTitles(page)).toEqual(['Build API', 'Design', 'Write docs']);
    expect((await model(page)).rows.map((r: any) => r.title)).toEqual(['Design', 'Build API', 'Write docs']);
    await db(page).getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '+ Filter' }).click();
    await page.getByRole('dialog').getByLabel('Property').selectOption({ label: 'Status' });
    await page.getByRole('dialog').getByLabel('Condition').selectOption('is_not');
    await page.getByRole('dialog').getByLabel('Filter value').fill('done');
    await page.getByRole('dialog').getByLabel('Filter value').press('Tab');
    await page.keyboard.press('Escape');
    await expect.poll(() => visibleTitles(page)).toEqual(['Build API', 'Write docs']);
    await expect(page.locator('#a .z-db-count')).toHaveText('2 of 3');
    await expect(db(page).getByRole('button', { name: 'Filter' })).toHaveAttribute('aria-pressed', 'true');
    await noErrors(page);
  });

  test('views: board groups by status and dragging a card changes it; list and gallery render', async ({ page }) => {
    await open(page, {}, TASKS);
    await db(page).getByLabel('Add view').selectOption('board');
    await expect(db(page)).toHaveAttribute('data-view', 'board');
    await expect(page.locator('#a .z-db-group')).toHaveCount(4); // no value + 3 options
    const colOf = (title: string) =>
      page.evaluate((t) => {
        const row = Array.from(document.querySelectorAll<HTMLElement>('#a .z-db-row')).find((r) => (r.querySelector('.z-db-cell[data-type="title"] input') as HTMLInputElement).value === t)!;
        const x = row.getBoundingClientRect().left + 10;
        const heads = Array.from(document.querySelectorAll<HTMLElement>('#a .z-db-group'));
        return heads.find((hd) => x >= hd.getBoundingClientRect().left && x <= hd.getBoundingClientRect().right)?.innerText.split('\n')[0];
      }, title);
    expect(await colOf('Design')).toBe('Done');
    expect(await colOf('Write docs')).toBe('To do');
    // drag "Write docs" to the Done column
    const card = page.locator('#a .z-db-row', { has: page.locator('input[value="Write docs"]') }).first();
    const from = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('#a .z-db-row')).find((r) => (r.querySelector('.z-db-cell[data-type="title"] input') as HTMLInputElement).value === 'Write docs')!;
      const r = row.getBoundingClientRect();
      const done = Array.from(document.querySelectorAll<HTMLElement>('#a .z-db-group')).find((g) => g.innerText.startsWith('Done'))!.getBoundingClientRect();
      return { x: r.right - 6, y: r.top + 4, tx: done.left + done.width / 2, ty: r.top + 30 };
    });
    void card;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 10, { steps: 3 });
    await page.mouse.move(from.tx, from.ty, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => colOf('Write docs')).toBe('Done');
    const m = await model(page);
    expect(m.rows[2][m.props[1].id]).toBe('done');
    expect(m.views.map((v: any) => v.type)).toEqual(['table', 'board']);
    // the original table view is untouched and still selectable (keyboard: arrow + Enter)
    await db(page).getByRole('tab', { name: 'Table' }).click();
    await expect(db(page)).toHaveAttribute('data-view', 'table');
    await db(page).getByLabel('Add view').selectOption('gallery');
    await expect(db(page)).toHaveAttribute('data-view', 'gallery');
    await db(page).getByLabel('Add view').selectOption('list');
    await expect(db(page)).toHaveAttribute('data-view', 'list');
    expect(await visibleTitles(page)).toEqual(['Design', 'Build API', 'Write docs']);
    await expect(db(page).getByRole('tab')).toHaveCount(4);
    await noErrors(page);
  });

  test('a row opens as a page with ordinary editable content', async ({ page }) => {
    await open(page, { mode: 'block' }, TASKS);
    const row = page.locator('#a .z-db-row').nth(1);
    await expect(row.locator('.z-db-page')).toBeHidden();
    await row.hover();
    await row.getByRole('button', { name: 'Open' }).click();
    await expect(row.locator('.z-db-page')).toBeVisible();
    await page.keyboard.type('# Notes');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- [ ] ship it');
    const content = await page.evaluate(() => {
      const z = (window as any).z;
      const d = [...z.editor.doc.descendants()].find((b: any) => b.type === 'database');
      return d.children[1].children.map((b: any) => [b.type, b.text]);
    });
    expect(content[0]).toEqual(['heading', 'Notes']);
    expect(content[1][0]).toBe('list');
    await expect(row.locator('.z-db-page h1')).toHaveText('Notes');
    // close it again: the caret leaves the hidden content
    await row.getByRole('button', { name: 'Open' }).click();
    await expect(row.locator('.z-db-page')).toBeHidden();
    expect((await page.evaluate(() => (window as any).z.editor.selection)).type).toBe('block');
    await noErrors(page);
  });

  test('read-only databases cannot be edited', async ({ page }) => {
    await open(page, { readOnly: true }, TASKS);
    await expect(db(page).getByRole('button', { name: '+ New' })).toHaveCount(0);
    await expect(db(page).getByRole('button', { name: 'Filter' })).toHaveCount(0);
    await expect(page.locator('#a .z-db-row').first().getByLabel('Name')).toHaveAttribute('readonly', '');
    await expect(page.locator('#a .z-db-row').first().getByRole('checkbox')).toBeDisabled();
    const before = await model(page);
    await page.locator('#a .z-db-row').first().getByLabel('Name').click();
    await page.keyboard.type('x');
    expect(await model(page)).toEqual(before);
  });
});

test.describe('workspace blocks', () => {
  test('table of contents follows headings and navigates', async ({ page }) => {
    await open(page, { content: [{ id: 't', type: 'toc' }, { id: 'h1', type: 'heading', attrs: { level: 1 }, content: [{ text: 'Alpha' }] }, p('x', 'a'), { id: 'h2', type: 'heading', attrs: { level: 2 }, content: [{ text: 'Beta' }] }] });
    const toc = page.getByRole('navigation', { name: 'Table of contents' });
    await expect(toc.getByRole('link')).toHaveText(['Alpha', 'Beta']);
    await setSel(page, 'h2', 4);
    await page.keyboard.type(' two');
    await expect(toc.getByRole('link')).toHaveText(['Alpha', 'Beta two']);
    await toc.getByRole('link', { name: 'Alpha' }).click();
    expect(await page.evaluate(() => (window as any).z.editor.selection.focus.id)).toBe('h1');
    await expect(page.locator('#a [data-zid="h1"]')).toHaveClass(/z-flash/);
  });

  test('bookmark with a host preview, date chip, template button and toggle heading', async ({ page }) => {
    await open(page, { content: [p('', 'a')], mode: 'block' }, `o.linkPreview = async (url) => ({ title: 'Example Domain', description: 'For use in examples', site: 'example.com' });`);
    await root(page).click();
    await page.keyboard.type('/bookmark');
    await page.keyboard.press('Enter');
    await page.locator('.z-prompt input').fill('example.com/docs');
    await page.locator('.z-prompt input').press('Enter');
    const card = page.locator('#a .z-bookmark-card');
    await expect(card.locator('.z-bookmark-title')).toHaveText('Example Domain');
    await expect(card).toHaveAttribute('href', 'https://example.com/docs');
    await expect(card).toHaveAttribute('rel', /noopener/);
    // date chip
    await page.keyboard.type('Due /date');
    await page.keyboard.press('Enter');
    await expect(page.locator('#a .z-date')).toHaveText('@Today');
    await page.locator('#a .z-date').click();
    await page.getByRole('dialog').getByLabel('Change date').fill('2030-05-17');
    await page.getByRole('dialog').getByLabel('Change date').press('Enter');
    await expect(page.locator('#a .z-date')).toHaveAttribute('datetime', '2030-05-17');
    // template button
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.press('Enter');
    await page.keyboard.type('/template');
    await page.keyboard.press('Enter');
    const tpl = page.getByRole('button', { name: /Insert template/ });
    await tpl.click();
    await tpl.click();
    await expect(page.locator('#a .z-list[data-kind="check"]')).toHaveCount(2);
    // toggle heading
    await page.evaluate(() => (window as any).z.focus());
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.press('Enter');
    await page.keyboard.type('/toggle heading 2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Section');
    await expect(page.locator('#a .z-toggle[data-level="2"]')).toContainText('Section');
    const types = (await json(page)).map((b: any) => b.type);
    expect(types).toContain('bookmark');
    expect(types).toContain('template_button');
    await noErrors(page);
  });

  test('[[ links to a page of the document and follows renames', async ({ page }) => {
    await open(page, { content: [p('see ', 'a')] });
    await page.evaluate(() => {
      const z = (window as any).z;
      z.commands.enablePages();
      z.commands.addPage('Specs');
      z.commands.setActivePage(z.getState().pages[0].id);
    });
    await setSel(page, 'a', 4);
    await page.keyboard.type('[[spe');
    await expect(page.locator('#a .z-typeahead .z-menu-item')).toHaveText(/Specs/);
    await page.keyboard.press('Enter');
    const link = page.locator('#a .z-page-link');
    await expect(link).toHaveText('Specs');
    await page.evaluate(() => {
      const z = (window as any).z;
      z.commands.renamePage(z.getState().pages[1].id, 'Specification');
    });
    await expect(page.locator('#a .z-page-link')).toHaveText('Specification');
    await page.locator('#a .z-page-link').click();
    await expect(page.getByRole('tab', { selected: true })).toContainText('Specification');
    await noErrors(page);
  });
});
