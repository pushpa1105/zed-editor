import { test, expect } from '@playwright/test';
import { open, root, json, sel, texts, setSel, expectInSync, noErrors, p, MOD } from './util';

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.describe('block mode', () => {
  test('slash menu: searchable, keyboard driven, inserts and converts', async ({ page }) => {
    await open(page, { content: [p('', 'a')], mode: 'block' });
    await root(page).click();
    await page.keyboard.type('/');
    const menu = page.locator('#a .z-typeahead');
    await expect(menu).toBeVisible();
    await expect(root(page)).toHaveAttribute('aria-activedescendant', /z-ta-/);
    await page.keyboard.type('head');
    // items whose title starts with the query rank first (toggle headings and the outline also match)
    await expect(menu.locator('.z-menu-item .z-menu-title').nth(0)).toHaveText('Heading 1');
    await expect(menu.locator('.z-menu-item .z-menu-title').nth(1)).toHaveText('Heading 2');
    await expect(menu.locator('.z-menu-item .z-menu-title').nth(2)).toHaveText('Heading 3');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    expect((await json(page))[0]).toMatchObject({ type: 'heading', attrs: { level: 2 }, content: [] });
    await page.keyboard.type('Plan');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/table');
    await page.keyboard.press('Enter');
    const j = await json(page);
    expect(j.map((b: any) => b.type)).toEqual(['heading', 'table']);
    // caret is inside the first cell
    await page.keyboard.type('x');
    expect(await texts(page)).toMatch(/^Plan\|x\|/);
    // Escape dismisses the menu and leaves the slash as text
    await page.keyboard.press('Tab');
    await page.keyboard.type('/zzz');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    expect(await texts(page)).toContain('/zzz');
    await noErrors(page);
  });

  test('placeholder of an empty document starts after the checkbox / bullet, not on top of it', async ({ page }) => {
    for (const kind of ['check', 'bullet', 'ordered']) {
      await open(page, { content: [{ id: 'a', type: 'list', attrs: kind === 'check' ? { kind, checked: false } : { kind } }], mode: 'block', placeholder: 'Write, or type / for commands' });
      await root(page).click();
      const m = await page.evaluate(() => {
        const content = document.querySelector('#a .z-list .z-content') as HTMLElement;
        const marker = document.querySelector('#a .z-list > .z-marker') as HTMLElement;
        const before = getComputedStyle(content, '::before');
        return { text: before.content, hintLeft: content.getBoundingClientRect().left, markerRight: marker.getBoundingClientRect().right, onRoot: getComputedStyle(document.querySelector('#a .z-root')!, '::before').content };
      });
      expect(m.text).toBe('"Write, or type / for commands"');
      expect(m.onRoot).toBe('none');
      expect(m.hintLeft).toBeGreaterThanOrEqual(m.markerRight);
    }
    // typing removes it
    await page.keyboard.type('x');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('#a .z-list .z-content')!, '::before').content)).toBe('none');
    await noErrors(page);
  });

  test('an empty to-do, list item, heading or quote that holds the caret says what it is', async ({ page }) => {
    await open(page, {
      content: [p('text', 'a'), { id: 'c', type: 'list', attrs: { kind: 'check', checked: false } }, { id: 'b', type: 'list', attrs: { kind: 'bullet' } }, { id: 'h', type: 'heading', attrs: { level: 2 } }, { id: 'q', type: 'quote' }],
      mode: 'block',
    });
    const hint = (id: string) => page.evaluate((id) => getComputedStyle(document.querySelector(`#a [data-zid="${id}"] .z-content`)!, '::before').content, id);
    for (const [id, text] of [['c', 'To-do'], ['b', 'List'], ['h', 'Heading'], ['q', 'Quote']]) {
      await setSel(page, id, 0);
      expect(await hint(id)).toBe(`"${text}"`);
    }
    // only the block with the caret, and only while it is empty
    expect(await hint('c')).toBe('none');
    await page.keyboard.type('x');
    expect(await hint('q')).toBe('none');
    await noErrors(page);
  });

  test('the "+" button: a dismissed menu takes its slash back; a typed slash stays', async ({ page }) => {
    await open(page, { content: [p('one', 'a'), p('two', 'b')], mode: 'block' });
    await setSel(page, 'a', 0);
    const menu = page.locator('#a .z-typeahead');
    const plus = page.locator('.z-handles .z-handle-btn').first();
    await page.locator('#a [data-zid="a"]').hover();
    await plus.click();
    await expect(menu).toBeVisible();
    expect(await texts(page)).toBe('one|/|two');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    expect(await texts(page)).toBe('one||two');
    // moving the caret away does the same
    await plus.click();
    await expect(menu).toBeVisible();
    await setSel(page, 'b', 1);
    await expect(menu).toBeHidden();
    expect(await texts(page)).toBe('one||two');
    // a query typed after it makes it the user's text
    await setSel(page, 'a', 0);
    await plus.click();
    await page.keyboard.type('zzz');
    await page.keyboard.press('Escape');
    expect(await texts(page)).toContain('/zzz');
    // choosing an item still works
    await setSel(page, 'b', 0);
    await plus.click();
    await page.keyboard.type('head');
    await page.keyboard.press('Enter');
    expect((await json(page)).some((b: any) => b.type === 'heading')).toBe(true);
    await noErrors(page);
  });

  test('slash menu is not shown in classic mode', async ({ page }) => {
    await open(page, { content: [p('', 'a')], mode: 'classic' });
    await root(page).click();
    await page.keyboard.type('/head');
    await expect(page.locator('#a .z-typeahead')).toBeHidden();
    expect(await texts(page)).toBe('/head');
  });

  test('block handle menu: duplicate, turn into, delete; keyboard reordering', async ({ page }) => {
    await open(page, { content: [p('one', 'a'), p('two', 'b'), p('three', 'c')], mode: 'block' });
    await setSel(page, 'b', 0);
    const grip = page.locator('#a .z-grip');
    await expect(grip).toBeVisible(); // visible without hovering: follows the selection
    await grip.click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    expect(await texts(page)).toBe('one|two|two|three');
    await setSel(page, 'a', 1);
    await page.keyboard.press('Alt+ArrowDown');
    expect(await texts(page)).toBe('two|one|two|three');
    await page.keyboard.press(`${MOD}+z`);
    expect(await texts(page)).toBe('one|two|two|three');
    await grip.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await grip.click();
    await page.getByRole('menuitem', { name: 'Heading 2' }).click();
    expect((await json(page))[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    await grip.click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    expect(await texts(page)).toBe('two|two|three');
    await noErrors(page);
  });

  test('drag a block with its nested child; cannot drop a parent into its own descendant', async ({ page }) => {
    const li = (t: string, id: string, children?: any[]) => ({ id, type: 'list', attrs: { kind: 'bullet' }, content: [{ text: t }], children });
    await open(page, { content: [li('parent', 'a', [li('child', 'a1')]), p('middle', 'b'), p('last', 'c')], mode: 'block' });
    const drag = async (from: string, to: string, dy: number) => {
      await page.locator(`[data-zid="${from}"] > .z-content`).hover();
      const g = (await page.locator('#a .z-grip').boundingBox())!;
      const t = (await page.locator(`[data-zid="${to}"] > .z-content`).boundingBox())!;
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(g.x + 20, g.y + 20, { steps: 3 });
      await page.mouse.move(t.x + 10, t.y + t.height / 2 + dy, { steps: 6 });
      await page.mouse.up();
    };
    const before = await json(page);
    // invalid: parent onto its own child
    await drag('a', 'a1', 6);
    expect(await json(page)).toEqual(before);
    // valid: parent (with child) below "last"
    await drag('a', 'c', 8);
    const j = await json(page);
    expect(j.map((b: any) => b.id)).toEqual(['b', 'c', 'a']);
    expect(j[2].children[0].id).toBe('a1');
    await page.keyboard.press(`${MOD}+z`);
    expect(await json(page)).toEqual(before);
    await noErrors(page);
  });

  test('reorder a block holding a comment and an image: anchor, image identity and undo', async ({ page }) => {
    await open(
      page,
      {
        mode: 'block',
        content: [
          p('intro', 'x'),
          { id: 't', type: 'toggle', attrs: { open: true }, content: [{ text: 'Section' }], children: [p('commented text here', 'a'), { id: 'img', type: 'image', attrs: { src: IMG, alt: 'dot' } }] },
          p('outro', 'y'),
        ],
      },
    );
    await page.evaluate(() => {
      const w = window as any;
      w.comments = w.Z.createComments(w.z.editor, { user: { id: 'u', name: 'U' } });
      w.imgEl = document.querySelector('[data-zid="img"] img');
    });
    await setSel(page, 'a', 0, 'a', 9);
    const thread = await page.evaluate(() => (window as any).comments.addThread('note').id);
    await expect(page.locator('#a .z-comment')).toHaveText('commented');
    const before = await json(page);
    await setSel(page, 't', 0);
    await page.keyboard.press('Alt+ArrowUp');
    expect((await json(page)).map((b: any) => b.id)).toEqual(['t', 'x', 'y']);
    const state = await page.evaluate((id) => {
      const w = window as any;
      return { anchors: w.comments.anchors(id), sameImg: document.querySelector('[data-zid="img"] img') === w.imgEl, anchored: w.comments.threads()[0].anchored };
    }, thread);
    expect(state).toEqual({ anchors: [{ id: 'a', from: 0, to: 9 }], sameImg: true, anchored: true });
    await expect(page.locator('#a .z-comment')).toHaveText('commented');
    await page.keyboard.press(`${MOD}+z`);
    expect(await json(page)).toEqual(before);
    expect(await page.evaluate(() => document.querySelector('[data-zid="img"] img') === (window as any).imgEl)).toBe(true);
    expect(await page.evaluate((id) => (window as any).comments.anchors(id), thread)).toEqual([{ id: 'a', from: 0, to: 9 }]);
    await noErrors(page);
  });

  test('floating toolbar appears for a selection in block mode', async ({ page }) => {
    await open(page, { content: [p('select me please', 'a')], mode: 'block' });
    await setSel(page, 'a', 0, 'a', 6);
    const ft = page.locator('#a .z-floating-toolbar');
    await expect(ft).toBeVisible();
    await ft.locator('[data-id="italic"]').click();
    expect((await json(page))[0].content[0]).toEqual({ text: 'select', marks: { italic: true } });
    expect(await sel(page)).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 6 } });
  });

  test('nesting with Tab, collapsible toggle, columns and callout', async ({ page }) => {
    await open(page, { content: [p('first', 'a'), p('second', 'b')], mode: 'block' });
    await setSel(page, 'b', 0);
    await page.keyboard.press('Tab');
    expect((await json(page))[0].children[0].id).toBe('b');
    await page.keyboard.press('Shift+Tab');
    expect((await json(page)).map((b: any) => b.id)).toEqual(['a', 'b']);
    await setSel(page, 'b', 6);
    await page.keyboard.press('Enter');
    await page.keyboard.type('/toggle');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Details');
    await page.keyboard.press('Enter');
    await page.keyboard.type('hidden body');
    let j = await json(page);
    expect(j[2]).toMatchObject({ type: 'toggle', content: [{ text: 'Details' }] });
    expect(j[2].children[0].content).toEqual([{ text: 'hidden body' }]);
    await page.locator('#a [data-z-toggle]').click();
    await expect(page.locator('[data-zid="' + j[2].children[0].id + '"]')).toBeHidden();
    // the caret was moved out of the hidden content
    expect((await sel(page)).focus.id).toBe(j[2].id);
    await page.locator('#a [data-z-toggle]').click();
    await page.keyboard.press('End');
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/2 col');
    await page.keyboard.press('Enter');
    await page.keyboard.type('left');
    j = await json(page);
    const cols = j.find((b: any) => b.type === 'columns');
    expect(cols.children.length).toBe(2);
    expect(cols.children[0].children[0].content).toEqual([{ text: 'left' }]);
    await expectInSync(page);
    await noErrors(page);
  });
});

test.describe('pages', () => {
  test('page tabs: add, switch, rename, page break, keyboard navigation', async ({ page }) => {
    await open(page, { content: [p('one', 'a'), p('two', 'b')] });
    const bar = page.locator('#a .z-pages-bar');
    await expect(bar).toBeHidden();
    await page.evaluate(() => (window as any).z.commands.enablePages());
    await expect(bar).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(1);
    await setSel(page, 'a', 3);
    await page.keyboard.press(`${MOD}+Shift+Enter`); // page break splits the page after the caret block
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('tab', { selected: true })).toContainText('Page 2');
    await expect(page.locator('[data-zid="a"]')).toBeHidden();
    await expect(page.locator('[data-zid="b"]')).toBeVisible();
    await page.keyboard.type('X');
    expect(await texts(page)).toBe('one|Xtwo');
    await page.getByRole('tab').first().click();
    await expect(page.locator('[data-zid="a"]')).toBeVisible();
    await expect(page.locator('[data-zid="b"]')).toBeHidden();
    // keyboard: arrow to the next tab, activate, rename with F2
    await page.getByRole('tab').first().focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { selected: true })).toContainText('Page 2');
    await page.getByRole('tab', { selected: true }).focus();
    await page.keyboard.press('F2');
    await page.keyboard.type('Appendix');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { selected: true })).toContainText('Appendix');
    await page.getByRole('button', { name: 'Add page' }).click();
    await expect(page.getByRole('tab')).toHaveCount(3);
    await page.keyboard.type('third page');
    expect(await texts(page)).toBe('one|Xtwo|third page');
    // "all pages" view shows every page as a sheet
    await page.locator('#a .z-page-view').click();
    await expect(page.locator('[data-zid="a"]')).toBeVisible();
    await expect(page.locator('[data-zid="b"]')).toBeVisible();
    // undo walks back through page edits and the visible page follows the caret
    await page.evaluate(() => (window as any).z.focus());
    for (let i = 0; i < 12; i++) await page.keyboard.press(`${MOD}+z`);
    expect((await json(page)).map((b: any) => b.type)).toEqual(['paragraph', 'paragraph']);
    await expect(bar).toBeHidden();
    await noErrors(page);
  });
});
