// Screenshots of the documentation website and a broken-link / console-error check.
// Usage: pnpm site && node scripts/shots-site.mjs <outDir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const require = createRequire(resolve('packages/zeditor/package.json'));
const { chromium } = require('@playwright/test');
const out = resolve(process.argv[2] ?? 'shots-site');
mkdirSync(out, { recursive: true });
const port = 4181;
const server = spawn(process.execPath, [resolve('scripts/serve.mjs'), String(port), '_site'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const base = `http://127.0.0.1:${port}/`;
let failed = false;
try {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(`${page.url()}: ${e}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
    page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  };
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(desk);
  for (const theme of ['light', 'dark']) {
    await desk.goto(base);
    await desk.evaluate((t) => localStorage.setItem('zdocs-theme', t), theme);
    await desk.reload();
    await desk.waitForSelector('#demo .zeditor');
    await desk.screenshot({ path: resolve(out, `home-${theme}.png`) });
    await desk.screenshot({ path: resolve(out, `home-${theme}-full.png`), fullPage: true });
    await desk.goto(base + 'docs/getting-started.html');
    await desk.screenshot({ path: resolve(out, `docs-${theme}.png`) });
  }
  await desk.goto(base + 'docs/user-guide.html#8-tables');
  await desk.screenshot({ path: resolve(out, 'docs-anchor.png') });
  await desk.goto(base + 'docs/api-reference.html');
  await desk.keyboard.press('Control+k');
  await desk.keyboard.type('insertDatabase');
  await desk.waitForTimeout(300);
  await desk.screenshot({ path: resolve(out, 'search.png') });
  await desk.keyboard.press('Escape');

  // every local link on every doc page resolves
  const pages = ['', 'docs/getting-started.html'];
  const seen = new Set();
  const links = new Set();
  while (pages.length) {
    const u = pages.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    await desk.goto(base + u);
    const hrefs = await desk.$$eval('a[href]', (as) => as.map((a) => a.href));
    for (const h of hrefs) {
      if (!h.startsWith(base)) continue;
      const rel = h.slice(base.length).split('#')[0];
      links.add(rel);
      if (rel.startsWith('docs/') && !seen.has(rel)) pages.push(rel);
    }
  }
  for (const l of links) {
    const r = await desk.request.get(base + l);
    if (!r.ok()) errors.push(`broken link: /${l} (${r.status()})`);
  }
  for (const ex of ['playground/', 'examples/html/', 'examples/collab/', 'examples/react/', 'examples/vue/']) {
    await desk.goto(base + ex);
    await desk.waitForSelector('.zeditor', { timeout: 10000 }).catch(() => errors.push(`${ex}: editor did not render`));
    await desk.waitForTimeout(300);
    await desk.screenshot({ path: resolve(out, `ex-${ex.replace(/\W+/g, '-')}.png`) });
  }

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  watch(mobile);
  await mobile.goto(base);
  await mobile.waitForSelector('#demo .zeditor');
  await mobile.screenshot({ path: resolve(out, 'mobile-home.png') });
  await mobile.goto(base + 'docs/databases.html');
  await mobile.click('[data-menu-toggle]');
  await mobile.waitForTimeout(300);
  await mobile.screenshot({ path: resolve(out, 'mobile-nav.png') });
  await browser.close();
  console.log(`checked ${seen.size} pages, ${links.size} local links`);
  if (errors.length) {
    failed = true;
    console.error([...new Set(errors)].join('\n'));
  } else console.log('no console errors, failed requests or broken links');
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
