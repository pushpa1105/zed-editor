import { test, expect, Page } from '@playwright/test';
import { open, noErrors, setSel } from './util';

const DOC = `o.content = [{ id: 'a', type: 'paragraph', content: [{ text: 'hello world' }] }];`;
const notice = (page: Page) => page.locator('#a .z-notice');

test.describe('no silent failures', () => {
  test('errors are shown as a dismissable notice, announced to screen readers', async ({ page }) => {
    await open(page, {}, DOC);
    await page.evaluate(() => (window as any).z.editor.emit('ui:error', { message: 'Something went wrong' }));
    await expect(notice(page)).toHaveText('Something went wrong');
    await expect(page.locator('#a .z-notices [role="alert"]')).toHaveText('Something went wrong');
    await notice(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice(page)).toHaveCount(0);
    // the same message twice does not stack
    await page.evaluate(() => {
      const e = (window as any).z.editor;
      e.emit('ui:notice', { message: 'Saved' });
      e.emit('ui:notice', { message: 'Saved' });
    });
    await expect(notice(page)).toHaveCount(1);
    await noErrors(page);
  });

  test('ui: { notices: false } leaves messages to the app', async ({ page }) => {
    await open(page, { ui: { notices: false } }, DOC);
    await page.evaluate(() => (window as any).z.editor.emit('ui:error', { message: 'x' }));
    await expect(page.locator('#a .z-notices')).toHaveCount(0);
  });

  test('Comment without a comments UI explains itself; with one it opens the prompt', async ({ page }) => {
    await open(page, {}, DOC);
    await setSel(page, 'a', 0, 'a', 5);
    page.on('console', () => {});
    await page.locator('#a .z-toolbar:not(.z-floating-toolbar) [data-id="comment"]').click();
    await expect(notice(page)).toContainText('Comments are not available');
    // an app that sets up comments gets the comment prompt instead
    await page.evaluate(() => {
      const Z = (window as any).Z;
      const z = (window as any).z;
      const comments = Z.createComments(z.editor, { user: { id: 'me', name: 'Me' } });
      const panel = document.createElement('div');
      document.body.append(panel);
      Z.createReviewPanel(z.editor, panel, { comments });
    });
    await setSel(page, 'a', 0, 'a', 5);
    await page.locator('#a .z-toolbar:not(.z-floating-toolbar) [data-id="comment"]').click();
    await expect(page.locator('.z-prompt')).toBeVisible();
  });

  test('dropping files without an upload handler says why nothing happened', async ({ page }) => {
    await open(page, {}, DOC);
    await page.evaluate(() => (window as any).z.editor.emit('ui:files', { files: [new File(['x'], 'a.png', { type: 'image/png' })] }));
    await expect(notice(page)).toContainText('uploads are not set up');
  });
});

test.describe('toolbar', () => {
  test('Find button opens the find panel; "insert" keeps its place in a custom toolbar', async ({ page }) => {
    await open(page, {}, DOC);
    await page.locator('#a .z-toolbar [data-id="find"]').click();
    await expect(page.locator('#a .z-find')).toBeVisible();
    await page.evaluate(() => (window as any).z.destroy());
    await open(page, { ui: { toolbar: ['bold', 'insert', 'italic'] } }, DOC);
    const ids = await page.locator('#a .z-toolbar:not(.z-floating-toolbar) > [data-id]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));
    expect(ids).toEqual(['bold', 'insert', 'italic']);
  });
});

const TASKS = `
  o.content = [{ id: 'a', type: 'paragraph', content: [{ text: 'intro' }] }, Z.createDatabase(Z.createHeadlessEditor(), {
    title: 'Tasks',
    properties: [
      { name: 'Name', type: 'title' },
      { name: 'Status', type: 'select', options: [{ id: 'todo', name: 'To do', color: 'gray' }, { id: 'doing', name: 'Doing', color: 'blue' }, { id: 'done', name: 'Done', color: 'green' }] },
    ],
    rows: [{ Name: 'One', Status: 'Done' }, { Name: 'Two', Status: 'To do' }, { Name: 'Three', Status: 'Done' }],
  })];`;

test.describe('database grouping', () => {
  test('a grouped table shows a folding section per group, rows ordered by group', async ({ page }) => {
    await open(page, {}, TASKS);
    const db = page.locator('#a .z-database');
    await db.getByRole('button', { name: 'Group' }).click();
    await page.getByRole('dialog').locator('select').selectOption({ label: 'Status' });
    await page.keyboard.press('Escape');
    const sections = db.locator('.z-db-section');
    // "To do", "Doing", "Done" (the empty "no value" section is left out)
    await expect(sections).toHaveCount(3);
    const order = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll<HTMLElement>('#a .z-db-body > *')).filter((e) => !e.hidden);
      els.sort((x, y) => Number(x.style.order || 0) - Number(y.style.order || 0));
      return els.map((e) => (e.querySelector('.z-db-cell[data-type="title"] input') as HTMLInputElement | null)?.value ?? '[' + e.textContent!.trim() + ']');
    });
    expect(order).toEqual(['[To do1]', 'Two', '[Doing0]', '[Done2]', 'One', 'Three']);
    // fold "Done"
    await sections.filter({ hasText: 'Done' }).click();
    await expect(db.locator('.z-db-row:not([hidden])')).toHaveCount(1);
    await expect(sections.filter({ hasText: 'Done' })).toHaveAttribute('aria-expanded', 'false');
    await noErrors(page);
  });

  test('boards always group (no "None"); calendars have no Group button', async ({ page }) => {
    await open(page, {}, TASKS);
    const db = page.locator('#a .z-database');
    await db.getByRole('button', { name: 'Add view' }).click();
    await page.getByRole('menu', { name: 'Add view' }).getByRole('menuitem', { name: /^Board/ }).click();
    await db.getByRole('button', { name: 'Group' }).click();
    const opts = await page.getByRole('dialog').locator('select').locator('option').allTextContents();
    expect(opts).toEqual(['Status']);
    await page.keyboard.press('Escape');
    await db.getByRole('button', { name: 'Add view' }).click();
    await page.getByRole('menu', { name: 'Add view' }).getByRole('menuitem', { name: /^Calendar/ }).click();
    await expect(db.getByRole('button', { name: 'Group' })).toHaveCount(0);
  });
});
