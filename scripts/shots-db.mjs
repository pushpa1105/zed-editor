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
  await db.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('.z-database').scrollIntoView({ block: 'start' }));
  await page.evaluate(() => document.querySelector('.z-scroll').scrollBy(0, -160));
  await page.locator('.z-db-colhead', { hasText: 'Points' }).click();
  await page.getByRole('dialog').getByLabel('Calculate').selectOption('sum');
  await page.keyboard.press('Escape');
  await page.locator('.z-db-row').nth(1).hover();
  await page.locator('.z-db-row').nth(1).getByRole('button', { name: 'Open' }).click();
  await page.keyboard.type('Each row is a page: this text lives inside the row.');
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(out, 'db-table.png') });
  await db.getByLabel('Add view').selectOption('board');
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(out, 'db-board.png') });
  await db.getByLabel('Add view').selectOption('gallery');
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(out, 'db-gallery.png') });
  await browser.close();
  console.log('errors:', JSON.stringify(errors));
} finally {
  server.kill();
}
