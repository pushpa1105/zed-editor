// Builds the documentation website (landing page, docs, playground, live examples) into _site/.
// The output is fully static and uses relative links only, so it works at any base path
// (e.g. https://<user>.github.io/<repo>/) — GitHub Pages deploys it from .github/workflows/pages.yml.
//
// Usage:  pnpm build && pnpm build:examples && pnpm site      (then `pnpm site:serve`)
// Env:    SITE_REPO=https://github.com/<owner>/<repo>  (defaults to package.json "repository")
//         SITE_BRANCH=main                             ("Edit this page" links)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Marked } from 'marked';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const out = join(root, '_site');
const pkgDir = join(root, 'packages', 'zeditor');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const version = pkg.version;
const repo = (process.env.SITE_REPO || pkg.repository?.url || 'https://github.com/pushpa1105/zed-editor').replace(/^git\+/, '').replace(/\.git$/, '');
const branch = process.env.SITE_BRANCH || 'main';
const dist = join(pkgDir, 'dist');

if (!existsSync(join(dist, 'zeditor.browser.js'))) {
  console.error('packages/zeditor/dist is missing — run `pnpm build` first.');
  process.exit(1);
}
const { tokenize } = await import(pathToFileURL(join(dist, 'code-highlight.js')).href);

// ---------------------------------------------------------------------------------------------
// Navigation: [slug, title, source file (repo-relative)]
const NAV = [
  { title: 'Start here', items: [
    ['getting-started', 'Getting started', 'packages/zeditor/README.md'],
    ['user-guide', 'User guide', 'docs/user-guide.md'],
  ] },
  { title: 'Guides', items: [
    ['commands', 'Commands & Editor API', 'docs/commands.md'],
    ['events-and-sync', 'Block IDs, events & sync', 'docs/events-and-sync.md'],
    ['databases', 'Databases & workspace blocks', 'docs/databases.md'],
    ['extensions', 'Writing extensions', 'docs/extensions.md'],
    ['serialization', 'Serialization, SSR & SEO', 'docs/serialization.md'],
    ['collaboration', 'Collaboration & review', 'docs/collaboration.md'],
    ['migration', 'Migrating content', 'docs/migration.md'],
  ] },
  { title: 'Reference', items: [
    ['api-reference', 'API reference', 'docs/api-reference.md'],
    ['architecture', 'Architecture', 'docs/architecture.md'],
    ['feature-matrix', 'Feature matrix', 'FEATURE_MATRIX.md'],
    ['benchmarks', 'Benchmarks', 'docs/benchmarks.md'],
    ['testing', 'Testing', 'docs/testing.md'],
  ] },
  { title: 'Project', items: [
    ['changelog', 'Changelog', 'CHANGELOG.md'],
    ['releasing', 'Releasing & updates', 'RELEASING.md'],
    ['contributing', 'Contributing', 'CONTRIBUTING.md'],
  ] },
];
const pages = NAV.flatMap((g) => g.items.map(([slug, title, src]) => ({ slug, title, src, group: g.title }))).filter((p) => existsSync(join(root, p.src)));
const bySrc = new Map(pages.map((p) => [p.src, p]));
bySrc.set('packages/zeditor', bySrc.get('packages/zeditor/README.md'));

// ---------------------------------------------------------------------------------------------
// helpers
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const stripTags = (h) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
// GitHub's heading slugger, so anchors written for github.com keep working here
const slugify = (text) => text.toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');

function highlight(code, lang) {
  const l = (lang || '').toLowerCase();
  const language = l === 'vue' || l === 'svelte' ? 'html' : l === 'jsonc' ? 'json' : l === 'mjs' || l === 'cjs' ? 'javascript' : l === 'yml' ? 'yaml' : l === 'console' || l === 'sh' || l === 'shell' ? 'bash' : l;
  let toks = [];
  try { toks = language ? tokenize(code, language) : []; } catch { toks = []; }
  let html = '', at = 0;
  for (const t of toks) {
    if (t.from < at) continue;
    html += esc(code.slice(at, t.from)) + `<span class="tok-${t.type}">${esc(code.slice(t.from, t.to))}</span>`;
    at = t.to;
  }
  return html + esc(code.slice(at));
}

/** Rewrite a markdown link found in `srcFile` for the page at `fromDir` (site-relative). */
function rewriteLink(href, srcFile, fromDir) {
  // absolute links to this website (used in the npm README) stay on the site being built
  const home = (pkg.homepage || '').replace(/\/?$/, '/');
  if (home.length > 1 && href.startsWith(home)) {
    const [p, hash] = href.slice(home.length).split('#');
    const target = p || 'index.html';
    const rel = posix.relative(fromDir, target) + (target.endsWith('/') ? '/' : '');
    return (rel || target) + (hash ? '#' + hash : '');
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//')) return href;
  const [path, hash] = href.split('#');
  const target = posix.normalize(posix.join(posix.dirname(srcFile), path)).replace(/\/$/, '');
  const page = bySrc.get(target);
  const h = hash ? '#' + hash : '';
  if (page) return posix.relative(fromDir, `docs/${page.slug}.html`) + h || `${page.slug}.html${h}`;
  if (target === 'README.md') return posix.relative(fromDir, 'index.html') + h;
  if (target === 'playground' || target === 'playground/index.html') return posix.relative(fromDir, 'playground') + '/';
  const isDir = existsSync(join(root, target)) && statSync(join(root, target)).isDirectory();
  return `${repo}/${isDir ? 'tree' : 'blob'}/${branch}/${target}${h}`;
}

function renderMarkdown(md, srcFile, fromDir) {
  const used = new Map();
  const headings = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const text = stripTags(html);
        let id = slugify(text) || 'section';
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id += '-' + n;
        headings.push({ depth, text, id });
        if (depth === 1) return `<h1 id="${id}">${html}</h1>\n`;
        return `<h${depth} id="${id}">${html}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
      },
      code({ text, lang }) {
        const l = (lang || '').split(/\s/)[0];
        return `<div class="code">${l ? `<span class="lang">${esc(l)}</span>` : ''}<button class="copy" type="button">Copy</button><pre><code>${highlight(text, l)}</code></pre></div>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const url = rewriteLink(href, srcFile, fromDir);
        const ext = /^https?:/.test(url) && !url.startsWith(repo + '/') ? ' rel="noopener"' : '';
        return `<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ''}${ext}>${inner}</a>`;
      },
      image({ href, title, text }) {
        const url = /^[a-z]+:/i.test(href) ? href : `${repo}/raw/${branch}/${posix.normalize(posix.join(posix.dirname(srcFile), href))}`;
        return `<img src="${esc(url)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy" />`;
      },
    },
  });
  let html = marked.parse(md);
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  return { html, headings };
}

// ---------------------------------------------------------------------------------------------
// layout
const ICON = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  moon: '<svg class="theme-dark-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  sun: '<svg class="theme-light-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  github: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
};

function shell({ title, description, base, body, current, bodyClass = '' }) {
  const nav = (href, label, key) => `<a href="${base}${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<!doctype html>
<html lang="en" data-base="${base}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:type" content="website" />
<meta name="theme-color" content="#5b4fe0" />
<link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml" />
<script>(()=>{let t;try{t=localStorage.getItem('zdocs-theme')}catch{}document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')})()</script>
<link rel="stylesheet" href="${base}assets/site.css?v=${version}" />
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <button class="icon-btn menu-btn" type="button" data-menu-toggle aria-label="Menu" aria-expanded="false">${ICON.menu}</button>
  <a class="brand" href="${base}index.html"><span class="logo" aria-hidden="true">z</span>zeditor</a>
  <a class="version" href="${base}docs/changelog.html" title="Changelog">v${esc(version)}</a>
  <nav class="top-nav" aria-label="Main">
    ${nav('docs/getting-started.html', 'Docs', 'docs')}
    ${nav('docs/api-reference.html', 'API', 'api')}
    ${nav('playground/', 'Playground', 'playground')}
    ${nav('index.html#examples', 'Examples', 'examples')}
  </nav>
  <span class="header-spacer"></span>
  <button class="search-btn" type="button" data-search-open aria-label="Search documentation">${ICON.search}<span>Search docs…</span><kbd>Ctrl K</kbd></button>
  <button class="icon-btn" type="button" data-theme-toggle aria-label="Toggle dark mode">${ICON.moon}${ICON.sun}</button>
  <a class="icon-btn" href="${repo}" aria-label="GitHub repository">${ICON.github}</a>
</header>
${body}
<dialog class="search-dialog" id="search" aria-label="Search documentation">
  <div class="search-input-row">${ICON.search}<input type="search" placeholder="Search docs" aria-label="Search" autocomplete="off" spellcheck="false" /><kbd>Esc</kbd></div>
  <ul class="search-results" role="listbox"></ul>
</dialog>
<script src="${base}assets/site.js?v=${version}" defer></script>
</body>
</html>
`;
}

function footer(base) {
  return `<footer class="site-footer"><div class="inner">
  <span>zeditor v${esc(version)} · MIT License</span>
  <nav aria-label="Footer">
    <a href="${base}docs/getting-started.html">Docs</a>
    <a href="${base}docs/changelog.html">Changelog</a>
    <a href="${base}playground/">Playground</a>
    <a href="https://www.npmjs.com/package/${pkg.name}">npm</a>
    <a href="${repo}">GitHub</a>
    <a href="${repo}/issues">Issues</a>
  </nav>
</div></footer>`;
}

// ---------------------------------------------------------------------------------------------
// build
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'docs'), { recursive: true });
cpSync(join(root, 'website', 'assets'), join(out, 'assets'), { recursive: true });
writeFileSync(join(out, '.nojekyll'), '');

const search = [];
const sidebar = (current) =>
  `<aside class="sidebar" aria-label="Documentation">${NAV.map((g) => {
    const items = g.items.filter(([, , src]) => bySrc.has(src));
    return items.length ? `<h2>${esc(g.title)}</h2><ul>${items.map(([slug, title]) => `<li><a href="${slug}.html"${slug === current ? ' aria-current="page"' : ''}>${esc(title)}</a></li>`).join('')}</ul>` : '';
  }).join('')}
  <div class="side-links"><h2>Try it</h2><ul>
    <li><a href="../playground/">Playground</a></li>
    <li><a href="../examples/html/">Plain HTML example</a></li>
    <li><a href="../examples/collab/">Collaboration example</a></li>
    ${existsSync(join(root, 'examples/react/dist/index.html')) ? '<li><a href="../examples/react/">React example</a></li>' : ''}
    ${existsSync(join(root, 'examples/vue-vuetify/dist/index.html')) ? '<li><a href="../examples/vue/">Vue + Vuetify example</a></li>' : ''}
  </ul></div></aside>`;

for (const [i, p] of pages.entries()) {
  const md = readFileSync(join(root, p.src), 'utf8').replace(/^\[!\[[^\n]*\n/gm, '');
  const { html, headings } = renderMarkdown(md, p.src, 'docs');
  const h1 = headings.find((h) => h.depth === 1)?.text ?? p.title;
  const toc = headings.filter((h) => h.depth === 2 || h.depth === 3);
  const firstPara = stripTags((/<p>([\s\S]*?)<\/p>/.exec(html) ?? [, ''])[1]).replace(/\s+/g, ' ').trim();
  const description = (firstPara || `${p.title} — zeditor documentation`).slice(0, 180);
  const prev = pages[i - 1], next = pages[i + 1];
  const body = `<div class="docs">
${sidebar(p.slug)}
<main class="content" id="main">
  <div class="breadcrumb">${esc(p.group)}</div>
  <article class="prose">${html}</article>
  <div class="page-foot">
    <div class="page-meta"><a href="${repo}/edit/${branch}/${p.src}">Edit this page on GitHub</a><span>zeditor v${esc(version)}</span></div>
    <nav class="pager" aria-label="Pages">
      ${prev ? `<a class="prev" href="${prev.slug}.html"><small>Previous</small>${esc(prev.title)}</a>` : ''}
      ${next ? `<a class="next" href="${next.slug}.html"><small>Next</small>${esc(next.title)}</a>` : ''}
    </nav>
  </div>
</main>
${toc.length > 1 ? `<nav class="toc" aria-label="On this page"><h2>On this page</h2><ul>${toc.map((h) => `<li><a class="lvl${h.depth}" href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ul></nav>` : '<div></div>'}
</div>`;
  const current = p.slug === 'api-reference' ? 'api' : 'docs';
  writeFileSync(join(out, 'docs', p.slug + '.html'), shell({ title: `${h1 === p.title ? p.title : `${p.title}`} · zeditor`, description, base: '../', body, current }));

  // search index: one entry per section
  const sections = html.split(/(?=<h[1-4] id=")/);
  for (const sec of sections) {
    const m = /^<h([1-4]) id="([^"]+)">([\s\S]*?)<\/h\1>/.exec(sec);
    const text = stripTags(sec.replace(/^<h[1-4][\s\S]*?<\/h[1-4]>/, '').replace(/<span class="lang">[\s\S]*?<\/span>|<button class="copy"[\s\S]*?<\/button>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!m) continue;
    const heading = stripTags(m[3].replace(/<a class="anchor"[\s\S]*?<\/a>/, ''));
    search.push({ p: p.title, h: heading, u: `docs/${p.slug}.html${m[1] === '1' ? '' : '#' + m[2]}`, x: text, d: Number(m[1]) - 1 });
  }
}
writeFileSync(join(out, 'search.json'), JSON.stringify(search));

// ---- the package, playground and examples ----
cpSync(dist, join(out, 'lib', 'zeditor', 'dist'), { recursive: true, filter: (s) => !s.endsWith('.map') && !s.endsWith('sizes.json') });
const libFor = (dir) => posix.relative(dir, 'lib/zeditor') + '/';
const backLink = (dir) => `<a href="${posix.relative(dir, 'index.html')}" style="position:fixed;z-index:9999;right:14px;bottom:14px;font:600 13px/1 system-ui,sans-serif;padding:9px 14px;border-radius:999px;background:#5b4fe0;color:#fff;text-decoration:none;box-shadow:0 6px 20px rgb(0 0 0/25%)">← zeditor docs</a>`;
function copyPage(src, dest) {
  const dir = posix.dirname(dest);
  let html = readFileSync(join(root, src), 'utf8').replace(/\.\/node_modules\/@z-packages\/zeditor\//g, './' + libFor(dir));
  html = html.replace(/<body([^>]*)>/, (m) => `${m}\n${backLink(dir)}`);
  mkdirSync(join(out, dir), { recursive: true });
  writeFileSync(join(out, dest), html);
}
copyPage('playground/index.html', 'playground/index.html');
copyPage('examples/html/index.html', 'examples/html/index.html');
copyPage('examples/collab/index.html', 'examples/collab/index.html');
cpSync(join(root, 'examples', 'shared'), join(out, 'examples', 'shared'), { recursive: true, filter: (s) => !s.endsWith('.d.ts') });
const built = [];
for (const [from, to, label] of [['examples/react/dist', 'examples/react', 'React'], ['examples/vue-vuetify/dist', 'examples/vue', 'Vue + Vuetify']]) {
  if (existsSync(join(root, from, 'index.html'))) {
    cpSync(join(root, from), join(out, to), { recursive: true });
    built.push(label);
  } else console.warn(`! ${from} not found — run \`pnpm build:examples\` to include the ${label} example`);
}

// ---- landing page ----
const sizes = existsSync(join(dist, 'sizes.json')) ? JSON.parse(readFileSync(join(dist, 'sizes.json'), 'utf8')) : null;
const code = (lang, text) => `<div class="code"><span class="lang">${lang}</span><button class="copy" type="button">Copy</button><pre><code>${highlight(text.trim(), lang)}</code></pre></div>`;
const quick = {
  install: `npm install ${pkg.name}`,
  html: `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/${pkg.name}@${version}/dist/style.css" />
<div id="editor"></div>
<script type="module">
  import { createEditor } from 'https://cdn.jsdelivr.net/npm/${pkg.name}@${version}/dist/zeditor.browser.js';

  const z = createEditor({ element: '#editor', placeholder: 'Write something…' });
  // z.setMode('block');  z.getJSON();  z.setJSON(saved);
</script>`,
  js: `import { createEditor } from '${pkg.name}';
import '${pkg.name}/style.css';

const z = createEditor({
  element: '#editor',
  mode: 'block',                      // or 'classic'
  ui: { toolbar: ['undo', 'redo', '|', 'bold', 'italic', 'link'] },
  autosave: { save: (doc) => api.save(doc) },
});`,
  react: `import { ZEditor } from '${pkg.name}/react';
import '${pkg.name}/style.css';

export function Notes() {
  return <ZEditor mode="block" placeholder="Type / for commands"
                  onChange={(editor) => save(editor.getJSON())} />;
}`,
  vue: `<script setup>
import { ZEditor } from '${pkg.name}/vue';
import '${pkg.name}/style.css';
</script>

<template>
  <ZEditor mode="classic" :options="{ placeholder: 'Write something…' }"
           @change="(editor) => save(editor.getJSON())" />
</template>`,
};
const features = [
  ['¶', 'Classic and Blocks modes', 'A toolbar editor and a Notion-style block editor on one engine. Switching keeps the document, caret and undo history.', 'docs/user-guide.html'],
  ['▦', 'Databases', 'Table, board, list, gallery, calendar and timeline views with typed properties, formulas, relations, rollups, filters and sorts.', 'docs/databases.html'],
  ['⇄', 'Real-time collaboration', 'Yjs binding with presence, offline recovery, comments, suggestions and version history.', 'docs/collaboration.html'],
  ['{}', 'Extensions all the way down', 'Every built-in feature is an extension. Add nodes, marks, commands, shortcuts, menus and renderers through the same API.', 'docs/extensions.html'],
  ['⟳', 'Backend sync & events', 'Stable block IDs, per-block events and a change feed that maps cleanly onto your API or database.', 'docs/events-and-sync.html'],
  ['</>', 'HTML, Markdown, JSON, SSR', 'Lossless JSON, clean HTML and Markdown import/export, and server-side rendering for SEO — no DOM required.', 'docs/serialization.html'],
  ['⚛', 'Vanilla, React and Vue 3', 'A single-file browser module for no-build pages, plus first-class React and Vue components and hooks.', 'docs/getting-started.html'],
  ['◐', 'Themeable or headless', 'CSS variables, dark mode, custom icons and labels — or render every control yourself from public state.', 'docs/commands.html'],
  ['♿', 'Accessible and fast', 'Native input and IME support, keyboard-first menus, screen-reader labels, tested in Chromium, Firefox and WebKit.', 'docs/benchmarks.html'],
];
const examples = [
  ['Playground', 'Every feature with toggles, themes, a custom toolbar, a document inspector, import/export, review and sample databases.', 'playground/'],
  ['Plain HTML', 'One HTML file, no framework and no build step: modes, save and reload JSON.', 'examples/html/'],
  ['Collaboration', 'Two clients side by side with presence and offline/reconnect. Add ?room=name to use two tabs.', 'examples/collab/'],
  ...(built.includes('React') ? [['React', 'React 19 in Strict Mode with a custom issue-reference node and an async # menu.', 'examples/react/']] : []),
  ...(built.includes('Vue + Vuetify') ? [['Vue 3 + Vuetify', 'A Vuetify toolbar driving the headless editor, plus a custom callout block.', 'examples/vue/']] : []),
];
const gz = sizes ? Object.entries(sizes).find(([k]) => /zeditor\.browser\.js$/.test(k))?.[1] : null;
const gzKb = gz && typeof gz === 'object' && gz.gzip ? `${(gz.gzip / 1024).toFixed(0)} kB` : null;

const landing = `<main id="main">
<section class="hero">
  <a class="eyebrow" href="docs/changelog.html">v${esc(version)} · Read the changelog →</a>
  <h1>The rich-text <span class="grad">and</span> block editor<br />for the web</h1>
  <p class="lead">One engine, two interfaces: a classic toolbar editor and a Notion-style block editor, with databases, real-time collaboration and zero runtime dependencies. For plain HTML, React and Vue&nbsp;3.</p>
  <div class="cta">
    <a class="btn primary" href="docs/getting-started.html">Get started</a>
    <a class="btn" href="playground/">Open the playground</a>
    <a class="btn" href="${repo}">${ICON.github.replace('<svg', '<svg width="18" height="18"')} GitHub</a>
  </div>
  <div class="install"><span class="prompt">$</span><span>${esc(quick.install)}</span><button class="copy" type="button" data-text="${esc(quick.install)}">Copy</button></div>
</section>

<div class="demo">
  <div class="demo-frame">
    <div class="demo-bar"><span class="dots"><i></i><i></i><i></i></span><span class="hint">Live editor — try typing, select text, or switch to Blocks and type “/”</span>
      <div class="seg" role="group" aria-label="Editor mode"><button type="button" data-mode="classic" aria-pressed="true">Classic</button><button type="button" data-mode="block" aria-pressed="false">Blocks</button></div>
    </div>
    <div id="demo"></div>
  </div>
  <p class="demo-note">This is the real package (<code>${esc(pkg.name)}@${esc(version)}</code>) running on this page.</p>
</div>

<section class="section">
  <h2>Everything a document editor needs</h2>
  <p class="sub">Written from scratch in TypeScript with zero runtime dependencies in the base bundle. No ProseMirror, Lexical, Slate or Quill underneath.</p>
  <div class="grid">${features.map(([ico, t, d, href]) => `<a class="card" href="${href}"><div class="ico" aria-hidden="true">${esc(ico)}</div><h3>${esc(t)}</h3><p>${esc(d)}</p></a>`).join('')}</div>
</section>

<div class="band"><section class="section">
  <h2>Quick start</h2>
  <p class="sub">Use it from a CDN with no build step, or install it from npm for your framework.</p>
  <div class="tabs">
    <div class="tablist" role="tablist" aria-label="Quick start">
      ${[['html', 'HTML (no build)'], ['js', 'JavaScript'], ['react', 'React'], ['vue', 'Vue 3']].map(([k, l], i) => `<button role="tab" id="tab-${k}" aria-controls="panel-${k}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${l}</button>`).join('')}
    </div>
    ${[['html', 'html'], ['js', 'javascript'], ['react', 'tsx'], ['vue', 'vue']].map(([k, lang], i) => `<div role="tabpanel" id="panel-${k}" aria-labelledby="tab-${k}"${i ? ' hidden' : ''}>${code(lang, quick[k])}</div>`).join('')}
    <p style="text-align:center;margin-top:18px"><a href="docs/getting-started.html">Read the full getting-started guide →</a></p>
  </div>
</section></div>

<section class="section" id="examples">
  <h2>Live examples</h2>
  <p class="sub">Each example runs the same build that is published to npm.</p>
  <div class="grid examples">${examples.map(([t, d, href]) => `<a class="card" href="${href}"><h3>${esc(t)}</h3><p>${esc(d)}</p><span class="go">Open →</span></a>`).join('')}</div>
</section>

<div class="band"><section class="section">
  <div class="stats">
    <div><b>0</b><span>runtime dependencies</span></div>
    ${gzKb ? `<div><b>${gzKb}</b><span>gzipped browser bundle</span></div>` : ''}
    <div><b>3</b><span>browsers tested on every change</span></div>
    <div><b>MIT</b><span>licensed</span></div>
  </div>
</section></div>
</main>
${footer('')}
<link rel="stylesheet" href="lib/zeditor/dist/style.css" />
<script type="module">
  import { createEditor } from './lib/zeditor/dist/zeditor.browser.js';
  const t = (text, marks) => (marks ? { text, marks } : { text });
  const p = (id, ...content) => ({ id, type: 'paragraph', content });
  const doc = { format: 'zeditor', version: 1, blocks: [
    { id: 'd1', type: 'heading', attrs: { level: 2 }, content: [t('Welcome to zeditor 👋')] },
    p('d2', t('This is a '), t('live', { bold: true }), t(' editor. Format text with the toolbar or shortcuts like '), t('Ctrl+B', { code: true }), t('. Markdown shortcuts work as you type: '), t('#', { code: true }), t(' for a heading, '), t('-', { code: true }), t(' for a list, '), t('[]', { code: true }), t(' for a to-do.')),
    { id: 'd3', type: 'list', attrs: { kind: 'check', checked: true }, content: [t('Classic and Blocks modes on one engine')] },
    { id: 'd4', type: 'list', attrs: { kind: 'check', checked: true }, content: [t('Tables, code, callouts, toggles, databases')] },
    { id: 'd5', type: 'list', attrs: { kind: 'check', checked: false }, content: [t('Switch to '), t('Blocks', { italic: true }), t(' above and type '), t('/', { code: true })] },
    { id: 'd6', type: 'callout', attrs: { tone: 'info', icon: '💡' }, children: [p('d6p', t('Everything here is saved as JSON and can be exported to HTML or Markdown.'))] },
    { id: 'd7', type: 'code', attrs: { language: 'javascript' }, content: [t("import { createEditor } from '${pkg.name}';\\ncreateEditor({ element: '#editor' });")] },
  ] };
  const theme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  let z;
  try {
    z = createEditor({ element: '#demo', content: doc, theme: theme(), maxHeight: '460px', ui: { statusBar: false } });
  } catch (e) {
    document.getElementById('demo').textContent = 'The live demo could not start: ' + e.message;
  }
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    z?.setMode(b.dataset.mode);
    document.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  document.addEventListener('zdocs:theme', () => document.querySelectorAll('#demo .zeditor').forEach((el) => (el.dataset.theme = theme())));
</script>`;
writeFileSync(join(out, 'index.html'), shell({ title: 'zeditor — rich-text and block editor for the web', description: pkg.description, base: '', body: landing, current: 'home' }));

// ---- 404 (GitHub Pages serves /404.html for unknown paths; use absolute-free links) ----
writeFileSync(join(out, '404.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found · zeditor</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f1115;color:#e7e9ee;text-align:center}a{color:#8b80ff}</style></head>
<body><div><h1>Page not found</h1><p>The page you were looking for does not exist.</p><p><a id="home" href="/">Go to the zeditor docs</a></p></div>
<script>const seg=location.pathname.split('/').filter(Boolean);if(location.hostname.endsWith('github.io')&&seg.length)document.getElementById('home').href='/'+seg[0]+'/';</script></body></html>`);

// ---- sitemap (only when the public URL is known) ----
const siteUrl = (process.env.SITE_URL || pkg.homepage || '').replace(/\/?$/, '/');
if (/^https?:\/\//.test(siteUrl)) {
  const urls = ['', 'playground/', ...pages.map((p) => `docs/${p.slug}.html`)];
  writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${siteUrl}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}sitemap.xml\n`);
}

const count = (d) => readdirSync(d).reduce((n, f) => n + (statSync(join(d, f)).isDirectory() ? count(join(d, f)) : 1), 0);
console.log(`site built: ${relative(root, out)}/ — ${pages.length} doc pages, ${search.length} search entries, examples: ${['html', 'collab', ...built].join(', ')}, ${count(out)} files`);
