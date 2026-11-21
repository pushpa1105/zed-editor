import { test, expect, Page } from '@playwright/test';
import { MOD } from './util';

// These tests run against the *built* examples (pnpm build:examples), i.e. against the
// published entry points only.
const blocks = (page: Page) => page.evaluate(() => (window as any).__z.getJSON().blocks);
const errorsOf = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
};

test.describe('plain HTML example (no framework, no build)', () => {
  test('mounts, switches modes, saves and reloads JSON', async ({ page }) => {
    const errors = errorsOf(page);
    await page.goto('/examples/html/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const root = page.locator('.z-root');
    await expect(root).toBeVisible();
    await expect(page.locator('h1').nth(1)).toHaveText('Hello from plain HTML');
    await page.locator('[data-zid="p"] .z-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Edited.');
    await page.getByRole('button', { name: 'Blocks' }).click();
    await expect(page.locator('.zeditor')).toHaveAttribute('data-mode', 'block');
    // the caret survived the mode switch: typing continues in the same place
    await page.keyboard.type(' More.');
    await page.getByRole('button', { name: 'Save JSON' }).click();
    const saved = await blocks(page);
    expect(JSON.stringify(saved)).toContain('Edited. More.');
    await page.keyboard.type(' Unsaved');
    await page.getByRole('button', { name: 'Reload saved JSON' }).click();
    expect(await blocks(page)).toEqual(saved);
    // survives a page reload from localStorage
    await page.reload();
    await expect(page.locator('.z-root')).toContainText('Edited. More.');
    expect(await blocks(page)).toEqual(saved);
    expect(errors).toEqual([]);
  });
});

test.describe('React example', () => {
  test('Strict Mode mount, React-rendered issue chips, async suggestions, re-render safety', async ({ page }) => {
    const errors = errorsOf(page);
    await page.goto('/examples/react/dist/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('.zeditor')).toHaveCount(1); // no duplicate from the double mount
    await expect(page.locator('.z-root')).toHaveCount(1);
    await expect(page.locator('.issue-chip')).toHaveCount(2); // host-rendered through React portals
    await expect(page.locator('.issue-chip').first()).toContainText('ZED-102');
    // async suggestion menu on '#'
    await page.locator('[data-zid="sp1"] .z-content').click();
    await page.keyboard.press(`${MOD}+End`);
    await page.locator('[data-zid="sn1p"] .z-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' See #dark');
    const menu = page.locator('.z-typeahead');
    await expect(menu.locator('.z-menu-item')).toHaveCount(1);
    await expect(menu).toContainText('ZED-130');
    await page.keyboard.press('Enter');
    await expect(page.locator('.issue-chip')).toHaveCount(3);
    const before = await blocks(page);
    expect(JSON.stringify(before)).toContain('"key":"ZED-130"');
    // parent re-renders do not reset the document or the caret
    const sel = await page.evaluate(() => (window as any).__z.editor.selection);
    await page.getByRole('button', { name: /Re-render parent/ }).click();
    await page.getByRole('button', { name: /Re-render parent/ }).click();
    expect(await blocks(page)).toEqual(before);
    expect(await page.evaluate(() => (window as any).__z.editor.selection)).toEqual(sel);
    await expect(page.locator('.zeditor')).toHaveCount(1);
    // custom React control reading editor state
    await page.locator('[data-zid="sn1p"] .z-content').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    const bold = page.getByRole('button', { name: /custom React button/ });
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('summary')).toContainText('block: paragraph');
    // live `mode` prop
    await page.getByRole('button', { name: /Mode:/ }).click();
    await expect(page.locator('.zeditor')).toHaveAttribute('data-mode', 'classic');
    expect(await blocks(page)).not.toEqual(before); // bold applied, nothing else lost
    expect(errors).toEqual([]);
  });
});

test.describe('Vue 3 + Vuetify example', () => {
  test('Vuetify toolbar replaces the default one; custom notice block renders as a Vuetify alert', async ({ page }) => {
    const errors = errorsOf(page);
    await page.goto('/examples/vue-vuetify/dist/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('.zeditor')).toHaveCount(1);
    await expect(page.locator('.zeditor .z-toolbar:not(.z-floating-toolbar):not(.z-table-tools)')).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Formatting (Vuetify)' })).toBeVisible();
    // host-rendered notice: Vuetify alert with editable children inside
    const alert = page.locator('.notice-alert');
    await expect(alert).toHaveCount(1);
    await expect(alert).toHaveAttribute('data-tone', 'warning');
    await expect(alert.locator('[data-zid="sn1p"]')).toContainText('Back up your documents.');
    await alert.locator('[data-zid="sn1p"] .z-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Typed inside the alert.');
    expect(JSON.stringify(await blocks(page))).toContain('Typed inside the alert.');
    // attribute edits through Vuetify controls
    await alert.getByRole('button', { name: 'danger' }).click();
    await expect(alert).toHaveAttribute('data-tone', 'danger');
    expect((await blocks(page)).find((b: any) => b.type === 'notice').attrs.tone).toBe('danger');
    // formatting through the Vuetify toolbar keeps the selection
    await page.locator('[data-zid="sh1"] .z-content').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.locator('[data-mark="bold"]').click();
    expect((await blocks(page))[0].content).toEqual([{ text: 'Release notes', marks: { bold: true } }]);
    await expect(page.locator('[data-mark="bold"]')).toHaveClass(/v-btn--active/);
    await page.getByTestId('insert-notice').click();
    await expect(page.locator('.notice-alert')).toHaveCount(2);
    // mount / unmount cycle: one editor, state restored from the saved document, no errors
    const before = await blocks(page);
    await page.getByTestId('remount').click();
    await expect(page.locator('.zeditor')).toHaveCount(1);
    await expect(page.locator('.notice-alert')).toHaveCount(2);
    expect(await blocks(page)).toEqual(before);
    await page.getByTestId('remount').click();
    await expect(page.locator('.zeditor')).toHaveCount(1);
    await page.locator('[data-zid="sh1"] .z-content').click();
    await page.keyboard.type('X');
    expect(JSON.stringify(await blocks(page))).toContain('X');
    expect(errors).toEqual([]);
  });
});

test('the same saved document opens in all three integrations', async ({ page }) => {
  // author in React: add an issue reference
  await page.goto('/examples/react/dist/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('[data-zid="sn1p"] .z-content').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' #recon');
  await expect(page.locator('.z-typeahead .z-menu-item')).toHaveCount(1);
  await page.keyboard.press('Enter');
  const doc = await page.evaluate(() => (window as any).__z.getJSON());
  const text = JSON.stringify(doc.blocks);
  expect(text).toContain('"type":"notice"');
  expect((text.match(/"atom":"issue"/g) ?? []).length).toBe(3);

  for (const [url, issue, notice] of [
    ['/examples/vue-vuetify/dist/', '.issue-ref', '.notice-alert'], // default issue DOM, Vuetify notice
    ['/examples/html/', '.issue-ref', '[data-type="notice"]'], // default DOM for both
    ['/examples/react/dist/', '.issue-chip', '[data-type="notice"]'], // React issue chips
  ] as const) {
    await page.goto(url);
    await page.waitForFunction(() => !!(window as any).__z);
    const issues = await page.evaluate((d) => (window as any).__z.setJSON(d), doc);
    expect(issues).toEqual([]);
    await expect(page.locator(issue)).toHaveCount(3);
    await expect(page.locator(notice)).toHaveCount(1);
    // lossless: what comes back out is what went in
    expect(await page.evaluate(() => (window as any).__z.getJSON())).toEqual(doc);
  }
});
