// Screenshots of the database views in the playground. Usage: node scripts/shots-db.mjs <outDir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const require = createRequire(resolve('packages/zeditor/package.json'));
const { chromium } = require('@playwright/test');
const out = resolve(process.argv[2] ?? 'shots');
mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, [resolve('scripts/serve.mjs'), '4177'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('http://127.0.0.1:4177/playground/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.z-database');
  const db = page.locator('.z-database');
  const frame = async (name) => {
    await page.evaluate(() => {
      const sc = document.querySelector('.z-scroll');
      const d = document.querySelector('.z-database');
      sc.scrollTop += d.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12;
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(out, name) });
  };
  const addView = async (name) => {
    await db.getByRole('button', { name: 'Add view' }).click();
    await page.getByRole('menu', { name: 'Add view' }).getByRole('menuitem', { name: new RegExp('^' + name) }).click();
  };
  await page.locator('.z-db-colhead', { hasText: 'Points' }).click();
  await page.getByRole('dialog').getByLabel('Calculate').selectOption('sum');
  await page.keyboard.press('Escape');
  await frame('db-table.png');
  await db.getByRole('button', { name: 'Add property' }).click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(out, 'db-add-property.png') });
  await page.keyboard.press('Escape');
  await addView('Board');
  await frame('db-board.png');
  await addView('Gallery');
  await frame('db-gallery.png');
  await addView('Calendar');
  await frame('db-calendar.png');
  await addView('Timeline');
  await frame('db-timeline.png');
  await page.locator('.z-tool-insert').click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(out, 'insert-menu.png') });
  await browser.close();
  console.log('errors:', JSON.stringify(errors));
} finally {
  server.kill();
}
