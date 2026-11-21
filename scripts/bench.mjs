// Reproducible benchmarks. Usage: node scripts/bench.mjs [--blocks 1000,5000,20000] [--json out.json]
//
// Measures, on generated documents of a given size (seeded PRNG, so the content is identical
// between runs):
//   model   headless engine cost per operation (Node, no DOM)
//   browser end-to-end latency in Chromium: from dispatching the input event until the DOM
//           is updated and a frame has been produced (keydown -> rAF), for typing, paste,
//           selection changes and block moves
// and reports bundle sizes from packages/zeditor/dist/sizes.json.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const sizes = arg('blocks', '1000,5000,20000').split(',').map(Number);
const pkg = resolve('packages/zeditor');
const require = createRequire(resolve(pkg, 'package.json'));
const core = await import(pathToFileURL(resolve(pkg, 'dist/core.js')).href);

import { makeDoc } from './bench-doc.mjs';
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), max: +s[s.length - 1].toFixed(3), n: s.length };
};

const results = { date: new Date().toISOString(), hardware: { cpu: os.cpus()[0].model.trim(), cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()} ${os.arch()}`, node: process.version }, model: {}, browser: {}, bundles: {} };

/* ------------------------------------------------------------------ model (Node) */
for (const n of sizes) {
  const blocks = makeDoc(n);
  const t0 = performance.now();
  const editor = core.createHeadlessEditor({ content: blocks });
  const load = performance.now() - t0;
  const mid = 'b' + Math.floor(n / 2 / 200) * 200; // a paragraph in the middle
  const midBlock = editor.doc.get(mid).content ? mid : 'b' + (Math.floor(n / 2 / 200) * 200 + 1);
  editor.setSelection(core.textSel(midBlock, 5));
  const type = [];
  for (let i = 0; i < 300; i++) {
    const t = performance.now();
    editor.commands.insertText('x');
    type.push(performance.now() - t);
  }
  const split = [];
  for (let i = 0; i < 100; i++) {
    const t = performance.now();
    editor.commands.splitBlock();
    split.push(performance.now() - t);
  }
  const move = [];
  for (let i = 0; i < 100; i++) {
    const t = performance.now();
    editor.commands.moveBlocksTo(['b' + (i * 2 + 1)], 'b' + (n - 2 - i * 2), 'after');
    move.push(performance.now() - t);
  }
  let t = performance.now();
  const json = JSON.stringify(editor.getJSON());
  const serialize = performance.now() - t;
  t = performance.now();
  const html = core.toHTML(editor);
  const toHtml = performance.now() - t;
  t = performance.now();
  core.htmlToBlocks(editor.schema, html);
  const fromHtml = performance.now() - t;
  t = performance.now();
  let undone = 0;
  while (editor.canUndo() && undone < 100) {
    editor.undo();
    undone++;
  }
  const undo = (performance.now() - t) / Math.max(1, undone);
  results.model[n] = { loadMs: +load.toFixed(1), typeMs: stats(type), splitBlockMs: stats(split), moveBlockMs: stats(move), serializeJsonMs: +serialize.toFixed(1), jsonKB: Math.round(json.length / 1024), toHtmlMs: +toHtml.toFixed(1), importHtmlMs: +fromHtml.toFixed(1), undoMs: +undo.toFixed(3) };
  editor.destroy();
}

/* ------------------------------------------------------------------ browser (Chromium) */
const server = spawn(process.execPath, [resolve('scripts/serve.mjs'), '4179'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
try {
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch();
  results.hardware.browser = 'Chromium ' + browser.version() + ' (headless)';
  for (const n of sizes) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto('http://127.0.0.1:4179/packages/zeditor/test/browser/harness.html');
    await page.waitForFunction(() => window.ready === true);
    const blocks = makeDoc(n);
    const mount = await page.evaluate((b) => {
      const t = performance.now();
      window.mount({ content: b, mode: 'block' });
      return performance.now() - t;
    }, blocks);
    // latency of one operation: run it, then wait for the next frame
    const measure = (fnSrc, count) =>
      page.evaluate(
        async ([src, count]) => {
          const fn = new Function('z', 'i', src);
          const out = [];
          const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
          await frame();
          for (let i = 0; i < count; i++) {
            const t = performance.now();
            fn(window.z, i);
            const sync = performance.now() - t; // handler + DOM patch
            await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // style, layout, paint
            out.push([sync, performance.now() - t]);
          }
          return out;
        },
        [fnSrc, count],
      );
    const split2 = (rows) => ({ handlerMs: stats(rows.map((r) => r[0])), toNextFrameMs: stats(rows.map((r) => r[1])) });
    const midIndex = Math.floor(n / 2 / 200) * 200 + 1;
    await page.evaluate((id) => {
      const z = window.z;
      z.focus();
      const b = z.editor.doc.get(id);
      z.editor.setSelection({ type: 'text', anchor: { id: b.content ? id : 'b3', offset: 5 }, focus: { id: b.content ? id : 'b3', offset: 5 } }, { scroll: true });
      z.view.syncSelectionToDOM(true);
    }, 'b' + midIndex);
    // typing: the real beforeinput path
    const typing = await measure(`z.view.root.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true, cancelable: true }));`, 100);
    const selection = await measure(`const id = 'b' + (1 + (i * 37) % 150); const b = z.editor.doc.get(id); if (b && b.content) { z.editor.setSelection({ type: 'text', anchor: { id, offset: 0 }, focus: { id, offset: Math.min(8, b.length) } }); z.view.syncSelectionToDOM(true); }`, 60);
    const moves = await measure(`z.commands.moveBlocksTo(['b' + (i * 2 + 1)], 'b' + (i * 2 + 5), 'after');`, 40);
    const html = '<h2>Pasted</h2>' + Array.from({ length: 200 }, (_, i) => `<p>Pasted paragraph ${i} with <b>bold</b> and <a href="https://example.com/${i}">a link</a>.</p>`).join('');
    const paste = await measure(`window.Z.pasteData(z.editor, { text: '', html: ${JSON.stringify(html)}, files: [] });`, 5);
    results.browser[n] = { mountMs: +mount.toFixed(1), typing: split2(typing), selectionChange: split2(selection), moveBlock: split2(moves), paste200Paragraphs: split2(paste), domNodes: await page.evaluate(() => document.querySelectorAll('#a *').length) };
    await page.close();
  }
  await browser.close();
} finally {
  server.kill();
}

/* ------------------------------------------------------------------ bundles */
const sz = JSON.parse(readFileSync(resolve(pkg, 'dist/sizes.json'), 'utf8'));
const esbuild = require('esbuild');
async function consumerSize(code) {
  // what an application bundler ships for a given import, minified, with peer deps external
  const r = await esbuild.build({ stdin: { contents: code, resolveDir: resolve(pkg, 'dist'), loader: 'js' }, bundle: true, minify: true, format: 'esm', write: false, external: ['react', 'react-dom', 'react/jsx-runtime', 'vue', 'yjs', 'y-protocols', 'y-protocols/*'], logLevel: 'silent' });
  const buf = Buffer.from(r.outputFiles[0].contents);
  const { gzipSync } = await import('node:zlib');
  return { minKB: +(buf.length / 1024).toFixed(1), gzipKB: +(gzipSync(buf).length / 1024).toFixed(1) };
}
results.bundles = {
  'headless core (createHeadlessEditor + serializers)': await consumerSize(`import { createHeadlessEditor, toHTML, toMarkdown } from './core.js'; console.log(createHeadlessEditor, toHTML, toMarkdown);`),
  'base editor with default UI (createEditor)': await consumerSize(`import { createEditor } from './index.js'; console.log(createEditor);`),
  'style.css': { minKB: +(sz['style.css'].bytes / 1024).toFixed(1), gzipKB: +(sz['style.css'].gzip / 1024).toFixed(1) },
  'optional: code-highlight (added on top of base)': await consumerSize(`import { codeHighlightExtension } from './code-highlight.js'; console.log(codeHighlightExtension);`),
  'optional: react adapter (added on top of base, react external)': await (async () => {
    const a = await consumerSize(`import { ZEditor } from './react.js'; console.log(ZEditor);`);
    const b = await consumerSize(`import { createEditor } from './index.js'; console.log(createEditor);`);
    return { minKB: +(a.minKB - b.minKB).toFixed(1), gzipKB: +(a.gzipKB - b.gzipKB).toFixed(1) };
  })(),
  'optional: vue adapter (added on top of base, vue external)': await (async () => {
    const a = await consumerSize(`import { ZEditor } from './vue.js'; console.log(ZEditor);`);
    const b = await consumerSize(`import { createEditor } from './index.js'; console.log(createEditor);`);
    return { minKB: +(a.minKB - b.minKB).toFixed(1), gzipKB: +(a.gzipKB - b.gzipKB).toFixed(1) };
  })(),
  'optional: collab (yjs + y-protocols external)': await consumerSize(`import { createCollab, connectSync } from './collab.js'; console.log(createCollab, connectSync);`),
  'no-build file: zeditor.browser.js (editor + UI + highlighting)': { minKB: +(sz['zeditor.browser.js'].bytes / 1024).toFixed(1), gzipKB: +(sz['zeditor.browser.js'].gzip / 1024).toFixed(1) },
  'no-build file: zeditor.collab.browser.js (includes Yjs)': { minKB: +(sz['zeditor.collab.browser.js'].bytes / 1024).toFixed(1), gzipKB: +(sz['zeditor.collab.browser.js'].gzip / 1024).toFixed(1) },
};

const outFile = arg('json', 'docs/benchmarks.json');
writeFileSync(outFile, JSON.stringify(results, null, 2));

/* ------------------------------------------------------------------ markdown report */
const hw = results.hardware;
const ms = (s) => `${s.median} / ${s.p95}`;
const md = [];
md.push('# Benchmarks', '');
md.push(`_Generated by \`pnpm bench\` on ${results.date.slice(0, 10)}. Re-run it to reproduce; documents are generated from a fixed seed (\`scripts/bench-doc.mjs\`)._`, '');
md.push('## Environment', '');
md.push(`- CPU: ${hw.cpu} (${hw.cores} logical cores), ${hw.memoryGB} GB RAM`, `- OS: ${hw.os}`, `- Node ${hw.node}; ${hw.browser}`, '');
md.push('## Documents', '');
md.push('Each document is a mix of paragraphs with formatted runs (~70 %), list items (~20 %), headings (~10 %) and a 3×3 table every 200 blocks.', '');
md.push('| Blocks | JSON size | DOM elements |', '| ---: | ---: | ---: |');
for (const n of sizes) md.push(`| ${n.toLocaleString('en')} | ${results.model[n].jsonKB.toLocaleString('en')} kB | ${results.browser[n]?.domNodes.toLocaleString('en') ?? '–'} |`);
md.push('', '## Engine only (Node, no DOM)', '', 'Milliseconds per operation, median / p95 where sampled.', '');
md.push('| Blocks | Load + validate | Type a character | Split block | Move block | Undo step | Serialize JSON | Export HTML | Import that HTML |', '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const n of sizes) {
  const m = results.model[n];
  md.push(`| ${n.toLocaleString('en')} | ${m.loadMs} | ${ms(m.typeMs)} | ${ms(m.splitBlockMs)} | ${ms(m.moveBlockMs)} | ${m.undoMs} | ${m.serializeJsonMs} | ${m.toHtmlMs} | ${m.importHtmlMs} |`);
}
md.push('', '## In the browser (Chromium, headless)', '');
md.push('Two numbers per operation, each as median / p95 in milliseconds:', '', '- **handler** — synchronous time of the input handler: model update, DOM patch, selection sync (includes any layout the browser is forced to do synchronously).', '- **to next frame** — from dispatching the input until the next animation frame has run, i.e. including style, layout and paint. At 60 Hz the floor is ~16.7 ms.', '');
md.push('| Blocks | Mount | Typing: handler | Typing: to next frame | Selection change: handler | to next frame | Move block: handler | to next frame | Paste 200 paragraphs (HTML): handler | to next frame |', '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const n of sizes) {
  const b = results.browser[n];
  if (!b) continue;
  md.push(`| ${n.toLocaleString('en')} | ${b.mountMs} | ${ms(b.typing.handlerMs)} | ${ms(b.typing.toNextFrameMs)} | ${ms(b.selectionChange.handlerMs)} | ${ms(b.selectionChange.toNextFrameMs)} | ${ms(b.moveBlock.handlerMs)} | ${ms(b.moveBlock.toNextFrameMs)} | ${ms(b.paste200Paragraphs.handlerMs)} | ${ms(b.paste200Paragraphs.toNextFrameMs)} |`);
}
md.push(
  '',
  'Typing is dispatched as a real `beforeinput` event. Selection changes jump between blocks; moves relocate a top-level block; the paste goes through the HTML importer.',
  '',
  '### Reading the numbers',
  '',
  '- The editor\'s own work per keystroke is independent of document size (engine column: ~0.02 ms; with the view attached ~0.6 ms measured with `scripts/profile.mjs` at 20,000 blocks). Only the touched block is re-rendered and its text node is updated in place.',
  '- What grows with size is the **browser\'s layout** of one very large flat document, which the selection API forces synchronously. Up to roughly 5,000 blocks (≈ a 300-page document) typing stays within a single frame; at 20,000 blocks it takes about three frames.',
  '- Mitigations in place: `content-visibility: auto` on top-level blocks above 400 blocks, caret measurements batched per frame, decorations painted with the Highlight API instead of DOM changes.',
  '- For very long documents use **pages**: in the default tabs view only the active page is laid out, so latency depends on the page, not the document.',
  '- There is no virtualized rendering: every block of the visible page is in the DOM.',
  '',
  '## Bundle sizes',
  '',
  'Minified and gzipped, as an application bundler would ship them (esbuild, peer dependencies external). "Added" rows are the increase over the base editor.',
  '',
  '| Import | Minified | Gzipped |',
  '| --- | ---: | ---: |',
);
for (const [k, v] of Object.entries(results.bundles)) md.push(`| ${k} | ${v.minKB} kB | ${v.gzipKB} kB |`);
md.push('', 'The base bundle has no runtime dependencies. React, Vue, Yjs and y-protocols are optional peer dependencies and are never bundled into the ESM entry points.', '');
writeFileSync('docs/benchmarks.md', md.join('\n'));
console.log(md.join('\n'));
