// Ad-hoc profiling helper: where does a keystroke spend its time on a large document?
// Usage: node scripts/profile.mjs [blocks]   (needs a build)
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { makeDoc } from './bench-doc.mjs';

const n = Number(process.argv[2] ?? 20000);
const require = createRequire(resolve('packages/zeditor/package.json'));
const { chromium } = require('@playwright/test');
const server = spawn(process.execPath, [resolve('scripts/serve.mjs'), '4178'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://127.0.0.1:4178/packages/zeditor/test/browser/harness.html');
  await page.waitForFunction(() => window.ready === true);
  await page.evaluate((b) => window.mount({ content: b, mode: 'block' }), makeDoc(n));
  const res = await page.evaluate(async (n) => {
    const z = window.z;
    const id = 'b' + (Math.floor(n / 2 / 200) * 200 + 1);
    z.focus();
    z.editor.setSelection({ type: 'text', anchor: { id, offset: 5 }, focus: { id, offset: 5 } }, { scroll: true });
    z.view.syncSelectionToDOM(true);
    const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    await frame();
    await frame();
    const time = async (label, fn, count = 40) => {
      const xs = [];
      for (let i = 0; i < count; i++) {
        const t = performance.now();
        fn(i);
        xs.push(performance.now() - t);
        await frame();
      }
      xs.sort((a, b) => a - b);
      return [label, +xs[Math.floor(xs.length / 2)].toFixed(2)];
    };
    const out = [];
    out.push(await time('command insertText (model + view sync)', () => z.commands.insertText('x')));
    const realSync = z.view.syncSelectionToDOM.bind(z.view);
    z.view.syncSelectionToDOM = () => {};
    out.push(await time('  ...without DOM selection sync', () => z.commands.insertText('x')));
    z.view.syncSelectionToDOM = realSync;
    const s = getSelection();
    out.push(await time('raw getSelection().collapse() to the same node', () => s.collapse(s.anchorNode, Math.max(0, s.anchorOffset - 1))));
    out.push(await time('raw textNode.data write + forced layout', () => {
      const t = s.anchorNode;
      t.data = t.data + 'y';
      document.body.offsetHeight;
    }));
    out.push(await time('emit update only', () => z.editor.emit('update')));
    z.view.root.classList.remove('z-large');
    await frame();
    await frame();
    out.push(await time('command insertText, content-visibility OFF', () => z.commands.insertText('x')));
    return out;
  }, n);
  console.log(`blocks: ${n}`);
  for (const [k, v] of res) console.log(String(v).padStart(8), 'ms ', k);
  await browser.close();
} finally {
  server.kill();
}
