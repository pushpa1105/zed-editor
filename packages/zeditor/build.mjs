// Build: ESM entry points with shared chunks (tree-shakeable), a single-file browser module,
// CSS, and type declarations.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const entries = ['index', 'core', 'react', 'vue', 'collab', 'code-highlight'].filter((e) => existsSync(join(root, 'src', e + '.ts')) || existsSync(join(root, 'src', e + '.tsx')));
const external = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'vue', 'yjs', 'y-protocols', 'y-protocols/awareness'];

await build({
  absWorkingDir: root,
  entryPoints: entries.map((e) => (existsSync(join(root, 'src', e + '.tsx')) ? `src/${e}.tsx` : `src/${e}.ts`)),
  outdir: 'dist',
  format: 'esm',
  bundle: true,
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  target: 'es2020',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  external,
  jsx: 'automatic',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
});

// single-file module for <script type="module"> without a build step
await build({
  absWorkingDir: root,
  entryPoints: ['src/browser.ts'],
  outfile: 'dist/zeditor.browser.js',
  format: 'esm',
  bundle: true,
  minify: true,
  target: 'es2020',
  platform: 'browser',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
});

await build({ absWorkingDir: root, entryPoints: ['src/style.css'], outfile: 'dist/style.css', bundle: true, minify: true, logLevel: 'warning' });

// type declarations
const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
if (!process.env.SKIP_TYPES) execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });

// size report
const sizes = {};
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css)$/.test(f)) {
      const buf = readFileSync(p);
      sizes[p.slice(dist.length + 1).replace(/\\/g, '/')] = { bytes: buf.length, gzip: gzipSync(buf).length };
    }
  }
};
walk(dist);
writeFileSync(join(dist, 'sizes.json'), JSON.stringify(sizes, null, 2));
const kb = (n) => (n / 1024).toFixed(1).padStart(7) + ' kB';
for (const [f, s] of Object.entries(sizes)) if (!f.startsWith('chunks/')) console.log(f.padEnd(28), kb(s.bytes), ' gzip', kb(s.gzip));
const chunks = Object.entries(sizes).filter(([f]) => f.startsWith('chunks/'));
if (chunks.length) console.log(`shared chunks (${chunks.length})`.padEnd(28), kb(chunks.reduce((a, [, s]) => a + s.bytes, 0)), ' gzip', kb(chunks.reduce((a, [, s]) => a + s.gzip, 0)));
