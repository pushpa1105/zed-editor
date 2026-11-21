// Pack the package and verify it the way a consumer would use it, in clean directories
// outside the workspace (so nothing resolves from the monorepo by accident).
//
//   1. npm pack
//   2. vanilla  : install ONLY the tarball -> no react / vue / yjs pulled in; the no-build HTML
//                 example runs from node_modules in a real browser
//   3. node     : ESM import of the headless entry in Node, SSR-safe import of every entry
//   4. types    : a TypeScript project type-checks imports from every public entry point
//   5. react    : the React example builds against the tarball
//   6. vue      : the Vue + Vuetify example builds against the tarball
//
// Usage: node scripts/pack-verify.mjs [--keep] [--skip-apps]
import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import { extname, join, resolve } from 'node:path';

const root = resolve('.');
const pkgDir = join(root, 'packages', 'zeditor');
const keep = process.argv.includes('--keep');
const skipApps = process.argv.includes('--skip-apps');
const work = mkdtempSync(join(os.tmpdir(), 'zeditor-consumer-'));
const report = { date: new Date().toISOString(), tarball: '', checks: [] };
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8', env: { ...process.env, npm_config_fund: 'false', npm_config_audit: 'false', npm_config_loglevel: 'error' } });
const check = async (name, fn) => {
  const t = Date.now();
  try {
    const detail = await fn();
    report.checks.push({ name, ok: true, ms: Date.now() - t, detail });
    console.log('  ok  ', name, detail ? '— ' + detail : '');
  } catch (e) {
    report.checks.push({ name, ok: false, ms: Date.now() - t, error: String(e.stdout || e.stderr || e.message || e).slice(-1500) });
    console.log('  FAIL', name, '\n', String(e.stdout || e.stderr || e.message || e).slice(-1500));
  }
};

console.log('work dir:', work);
// 1. pack
const packed = sh('npm pack --json', pkgDir);
const info = JSON.parse(packed.slice(packed.indexOf('[')))[0];
const tarball = join(pkgDir, info.filename);
report.tarball = info.filename;
report.files = info.files.length;
report.unpackedKB = Math.round(info.unpackedSize / 1024);
report.packedKB = Math.round(info.size / 1024);
console.log(`packed ${info.filename}: ${info.files.length} files, ${report.packedKB} kB packed, ${report.unpackedKB} kB unpacked`);
await check('tarball contents', () => {
  const files = info.files.map((f) => f.path);
  for (const need of ['dist/index.js', 'dist/index.d.ts', 'dist/core.js', 'dist/core.d.ts', 'dist/react.js', 'dist/react.d.ts', 'dist/vue.js', 'dist/vue.d.ts', 'dist/collab.js', 'dist/collab.d.ts', 'dist/code-highlight.js', 'dist/zeditor.browser.js', 'dist/zeditor.collab.browser.js', 'dist/style.css', 'README.md', 'LICENSE', 'package.json'])
    if (!files.includes(need)) throw new Error('missing from tarball: ' + need);
  const stray = files.filter((f) => /^(src|test|node_modules)\//.test(f) || /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f));
  if (stray.length) throw new Error('unexpected files: ' + stray.slice(0, 5).join(', '));
  return `${files.length} files`;
});

// 2. vanilla
const vanilla = join(work, 'vanilla');
mkdirSync(vanilla, { recursive: true });
writeFileSync(join(vanilla, 'package.json'), JSON.stringify({ name: 'consumer-vanilla', private: true }, null, 2));
await check('vanilla: install only the tarball', () => {
  sh(`npm install "${tarball}"`, vanilla);
  const mods = readdirSync(join(vanilla, 'node_modules')).filter((d) => !d.startsWith('.'));
  const bad = mods.filter((m) => ['react', 'react-dom', 'vue', 'yjs', 'y-protocols', 'vuetify'].includes(m));
  if (bad.length) throw new Error('a vanilla consumer got framework packages: ' + bad.join(', '));
  return 'node_modules: ' + mods.join(', ');
});
await check('vanilla: no-build HTML example runs from node_modules in Chromium', async () => {
  // lay the example out as a user would: page + node_modules side by side
  cpSync(join(root, 'examples', 'html', 'index.html'), join(vanilla, 'html', 'index.html'), { recursive: true });
  cpSync(join(root, 'examples', 'shared'), join(vanilla, 'shared'), { recursive: true });
  cpSync(join(vanilla, 'node_modules'), join(vanilla, 'html', 'node_modules'), { recursive: true });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.json': 'application/json' };
  const server = createServer((req, res) => {
    const file = join(vanilla, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const require = createRequire(join(pkgDir, 'package.json'));
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('requestfailed', (r) => errors.push('request failed: ' + r.url()));
    await page.goto(`http://127.0.0.1:${port}/html/index.html`);
    await page.waitForSelector('.z-root');
    await page.locator('[data-zid="p"] .z-content').click();
    await page.keyboard.type('packed ');
    await page.getByRole('button', { name: 'Blocks' }).click();
    const mode = await page.locator('.zeditor').getAttribute('data-mode');
    await page.getByRole('button', { name: 'Save JSON' }).click();
    const saved = await page.evaluate(() => localStorage.getItem('zeditor-html-example'));
    await page.getByRole('button', { name: 'Reload saved JSON' }).click();
    const styled = await page.evaluate(() => getComputedStyle(document.querySelector('.z-toolbar')).display);
    if (mode !== 'block') throw new Error('mode switch failed');
    if (!saved || !saved.includes('packed')) throw new Error('save failed');
    if (styled !== 'flex') throw new Error('stylesheet not applied');
    if (errors.length) throw new Error(errors.join('\n'));
    return 'mounted, typed, switched mode, saved and reloaded JSON, CSS applied, no console errors';
  } finally {
    await browser.close();
    server.close();
  }
});

// 3. node
await check('node: headless ESM import, transform, validate, serialize', () => {
  writeFileSync(
    join(vanilla, 'headless.mjs'),
    `import { createHeadlessEditor, toHTML, toMarkdown, renderToHTML, fromMarkdown } from '@z-packages/zeditor/core';
const e = createHeadlessEditor({ content: fromMarkdown(createHeadlessEditor(), '# Title\\n\\n- [x] done\\n\\n| a | b |\\n|---|---|\\n| 1 | 2 |') });
e.commands.selectAll();
e.commands.toggleMark('bold');
const json = e.getJSON();
if (json.blocks.length !== 3) throw new Error('unexpected block count');
if (e.validate(json).length) throw new Error('validation issues');
const html = toHTML(e);
if (!html.includes('<h1><strong>Title</strong></h1>') || !html.includes('<table>')) throw new Error('bad html: ' + html);
if (!renderToHTML(json, { ids: true }).includes('id="')) throw new Error('no ids');
if (!toMarkdown(e).includes('- [x] **done**')) throw new Error('bad markdown');
if (typeof document !== 'undefined') throw new Error('unexpected DOM');
console.log('ok ' + json.blocks.map((b) => b.type).join(','));`,
  );
  return sh('node headless.mjs', vanilla).trim();
});
await check('node: SSR-safe import of the DOM entry (no window access at import time)', () => {
  writeFileSync(join(vanilla, 'ssr.mjs'), `const m = await import('@z-packages/zeditor'); const c = await import('@z-packages/zeditor/code-highlight'); if (typeof m.createEditor !== 'function' || typeof c.codeHighlightExtension !== 'function') throw new Error('exports missing'); console.log('ok');`);
  return sh('node ssr.mjs', vanilla).trim();
});

// 4. types + framework entries
const typed = join(work, 'typed');
mkdirSync(join(typed, 'src'), { recursive: true });
writeFileSync(
  join(typed, 'package.json'),
  JSON.stringify({ name: 'consumer-typed', private: true, type: 'module', dependencies: { '@z-packages/zeditor': 'file:' + tarball.replace(/\\/g, '/'), react: '^19.0.0', 'react-dom': '^19.0.0', vue: '^3.5.0', yjs: '^13.6.0', 'y-protocols': '^1.0.6' }, devDependencies: { typescript: '^5.9.0', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' } }, null, 2),
);
writeFileSync(join(typed, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, jsx: 'react-jsx', lib: ['ES2022', 'DOM', 'DOM.Iterable'], skipLibCheck: false }, include: ['src'] }, null, 2));
writeFileSync(
  join(typed, 'src', 'index.tsx'),
  `import { createEditor, defineExtension, type Extension, type DocJSON, type EditorState, type NodeRenderer } from '@z-packages/zeditor';
import { createHeadlessEditor, toHTML, type Editor, type BlockJSON } from '@z-packages/zeditor/core';
import { ZEditor, useEditorState, type NodeViewProps } from '@z-packages/zeditor/react';
import { ZEditor as VueEditor, useEditorState as useVueState } from '@z-packages/zeditor/vue';
import { createCollab, connectSync, memoryHub, Y } from '@z-packages/zeditor/collab';
import { codeHighlightExtension } from '@z-packages/zeditor/code-highlight';
import '@z-packages/zeditor/style.css';

const ext: Extension = defineExtension({ name: 'x', commands: { hello: (editor: Editor) => editor.commands.insertText('hi') } });
const headless = createHeadlessEditor({ extensions: [ext, codeHighlightExtension()] });
headless.commands.toggleMark('bold');
headless.commands.insertTable(2, 2, { header: true });
// @ts-expect-error unknown alignment
headless.commands.setAlign('diagonal');
const doc: DocJSON = headless.getJSON();
const blocks: BlockJSON[] = doc.blocks;
const html: string = toHTML(headless);
const renderer: NodeRenderer = (block) => ({ dom: document.createElement('div') });
const z = createEditor({ element: document.body, renderers: { custom: renderer }, mode: 'block', features: { tables: false } });
const state: EditorState = z.getState();
const collab = createCollab(z.editor, { doc: new Y.Doc(), user: { id: 'u', name: 'U' } });
connectSync(collab.doc, collab.awareness, memoryHub().endpoint());
function View({ block, updateAttrs }: NodeViewProps) { return <button onClick={() => updateAttrs({ a: 1 })}>{block.type}</button>; }
export function App() { const bold = useEditorState(z, (s) => !!s.marks.bold); return <ZEditor mode="classic" nodeViews={{ custom: View }} aria-label={String(bold)} />; }
export { VueEditor, useVueState, blocks, html, state };
`,
);
writeFileSync(join(typed, 'src', 'css.d.ts'), `declare module '*.css';\n`);
await check('types: install tarball with peers', () => {
  sh('npm install', typed);
  return 'installed';
});
await check('types: a strict TypeScript project type-checks every public entry point', () => {
  // the aria-label prop is not part of ZEditorProps: remove it so the file is expected to be clean
  const f = join(typed, 'src', 'index.tsx');
  writeFileSync(f, readFileSync(f, 'utf8').replace(' aria-label={String(bold)}', ' className={String(bold)}'));
  sh('npx tsc -p tsconfig.json', typed);
  return 'tsc --strict passed (skipLibCheck off)';
});
await check('node: SSR-safe import of the React and Vue adapters; React renders on the server', () => {
  writeFileSync(
    join(typed, 'ssr.mjs'),
    `import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ZEditor } from '@z-packages/zeditor/react';
import * as vue from '@z-packages/zeditor/vue';
import * as collab from '@z-packages/zeditor/collab';
const html = renderToString(createElement(ZEditor, { className: 'host' }));
if (!html.includes('class="host"')) throw new Error('unexpected SSR output: ' + html);
if (typeof vue.ZEditor !== 'object' || typeof collab.createCollab !== 'function') throw new Error('exports missing');
console.log('ok ' + html);`,
  );
  return sh('node ssr.mjs', typed).trim();
});

// 5 / 6. example apps against the tarball
if (!skipApps)
  for (const app of ['react', 'vue-vuetify']) {
    const dir = join(work, 'apps', app);
    await check(`${app}: example builds against the tarball`, () => {
      cpSync(join(root, 'examples', app), dir, { recursive: true, filter: (src) => !/[\\/](node_modules|dist)([\\/]|$)/.test(src) });
      cpSync(join(root, 'examples', 'shared'), join(work, 'apps', 'shared'), { recursive: true });
      const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      pj.dependencies['@z-packages/zeditor'] = 'file:' + tarball.replace(/\\/g, '/');
      writeFileSync(join(dir, 'package.json'), JSON.stringify(pj, null, 2));
      sh('npm install', dir);
      if (pj.scripts.typecheck) sh('npm run typecheck', dir);
      sh('npm run build', dir);
      const assets = readdirSync(join(dir, 'dist', 'assets'));
      return 'built: ' + assets.join(', ');
    });
  }

report.ok = report.checks.every((c) => c.ok);
writeFileSync(join(root, 'docs', 'pack-verify.json'), JSON.stringify(report, null, 2));
rmSync(tarball, { force: true });
if (!keep) {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* Windows may hold files briefly */
  }
}
console.log(report.ok ? '\nPACK VERIFY: all checks passed' : '\nPACK VERIFY: FAILURES');
process.exit(report.ok ? 0 : 1);
