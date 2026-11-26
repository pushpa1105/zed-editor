// Fails when something public is not documented:
// - docs/api-reference.md is out of date (regenerate with `pnpm docs:api`);
// - a command is missing from docs/commands.md;
// - an event the package emits, a toolbar item id, or an option of createEditor / Editor is not
//   mentioned in any doc.
// Usage: node scripts/docs-check.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const read = (p) => readFileSync(p, 'utf8');
const docs = readdirSync('docs').filter((f) => f.endsWith('.md'));
const all = [...docs.map((f) => read(join('docs', f))), read('packages/zeditor/README.md'), read('README.md')].join('\n');
const commandsDoc = read('docs/commands.md');
const src = 'packages/zeditor/src';
const problems = [];

// 1. API reference up to date
try {
  execFileSync(process.execPath, ['scripts/api-docs.mjs', '--check'], { stdio: 'pipe' });
} catch (e) {
  problems.push(String(e.stdout || '') + String(e.stderr || ''));
}

// 2. every typed command is in docs/commands.md
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f)) files.push(p);
  }
};
walk(src);
const commands = new Set();
for (const f of files) {
  const s = read(f);
  for (const m of s.matchAll(/interface Commands \{([\s\S]*?)\n {0,2}\}/g)) for (const c of m[1].matchAll(/^\s+([a-zA-Z]\w*)\(/gm)) commands.add(c[1]);
}
const missingCmds = [...commands].filter((c) => c !== 'constructor' && !commandsDoc.includes('`' + c + '(') && !new RegExp('[`/ ]' + c + '\\(').test(commandsDoc));
if (missingCmds.length) problems.push('commands missing from docs/commands.md: ' + missingCmds.join(', '));

// 3. events
const events = new Set();
for (const f of files) for (const m of read(f).matchAll(/emit\(\s*'([\w:.-]+)'/g)) events.add(m[1]);
const missingEvents = [...events].filter((e) => !all.includes('`' + e + '`') && !all.includes('`@' + e + '`') && !all.includes('`' + e + ' '));
if (missingEvents.length) problems.push('events not documented: ' + missingEvents.join(', '));

// 4. toolbar item ids
const ids = new Set();
for (const f of files) for (const m of read(f).matchAll(/\{\s*id:\s*'([\w-]+)',\s*group:/g)) ids.add(m[1]);
const missingIds = [...ids].filter((i) => !all.includes('`' + i + '`'));
if (missingIds.length) problems.push('toolbar items not documented: ' + missingIds.join(', '));

// 5. options
const idx = read(join(src, 'index.ts'));
const opt = idx.slice(idx.indexOf('export interface CreateEditorOptions'), idx.indexOf('export interface ZEditor'));
const ed = read(join(src, 'core/editor.ts'));
const eo = ed.slice(ed.indexOf('export interface EditorOptions'), ed.indexOf('export interface UpdateOptions'));
const names = [...opt.matchAll(/^\s{2,8}([a-zA-Z]\w*)\??:/gm), ...eo.matchAll(/^\s{2}([a-zA-Z]\w*)\??:/gm)].map((m) => m[1]);
const guide = read('docs/user-guide.md') + read('docs/commands.md') + read('docs/events-and-sync.md') + read('packages/zeditor/README.md');
const missingOpts = [...new Set(names)].filter((n) => !guide.includes('`' + n + '`') && !new RegExp('\\b' + n + ':').test(guide));
if (missingOpts.length) problems.push('options not explained in the guides: ' + missingOpts.join(', '));

if (problems.length) {
  console.error('Documentation check failed:\n- ' + problems.join('\n- '));
  process.exitCode = 1;
} else console.log(`Documentation check passed: ${commands.size} commands, ${events.size} events, ${ids.size} toolbar items, ${new Set(names).size} options, API reference up to date.`);
