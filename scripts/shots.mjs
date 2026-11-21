// Take screenshots of the playground and examples for visual review.
// Usage: node scripts/shots.mjs <outDir>   (needs the dev server on :4173 and `pnpm build`)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(resolve('packages/zeditor/package.json'));
const { chromium } = require('@playwright/test');
const out = resolve(process.argv[2] ?? 'shots');
mkdirSync(out, { recursive: true });
const base = 'http://127.0.0.1:4173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(base + '/playground/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.z-root');
await page.screenshot({ path: resolve(out, 'playground-classic.png') });
await page.selectOption('#mode', 'block');
await page.locator('[data-zid="l2"] > .z-content').click();
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.type('/');
await page.waitForTimeout(200);
await page.screenshot({ path: resolve(out, 'playground-block-slash.png') });
await page.keyboard.press('Escape');
await page.click('#pages');
await page.waitForTimeout(100);
await page.selectOption('#theme', 'dark');
await page.waitForTimeout(200);
await page.screenshot({ path: resolve(out, 'playground-dark-pages.png') });
await page.goto(base + '/examples/collab/');
await page.waitForFunction(() => window.ready === true);
await page.evaluate(() => {
  const z = window.clients[1].z;
  z.focus();
  z.editor.setSelection({ type: 'text', anchor: { id: 'p', offset: 5 }, focus: { id: 'p', offset: 19 } });
});
await page.waitForTimeout(200);
await page.screenshot({ path: resolve(out, 'collab.png') });
await page.goto(base + '/examples/vue-vuetify/dist/');
await page.waitForSelector('.z-root');
await page.screenshot({ path: resolve(out, 'vue.png') });
await browser.close();
console.log('errors:', JSON.stringify(errors));
