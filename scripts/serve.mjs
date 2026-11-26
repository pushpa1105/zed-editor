// Zero-dependency static server for the playground, the no-build example and browser tests.
// Usage: node scripts/serve.mjs [port] [folder]   (default 4173, the repository root)
//   node scripts/serve.mjs 4180 _site   serves the built documentation website (`pnpm site:serve`)
// The built package is exposed at the path a real install would have:
//   /node_modules/@z-packages/zeditor/...  ->  packages/zeditor/...
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const siteMode = Boolean(process.argv[3]);
const root = siteMode ? resolve(repoRoot, process.argv[3]) : repoRoot;
const port = Number(process.argv[2] || process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function mapPath(urlPath) {
  const m = /^(?:\/[^?]*)?\/node_modules\/@z-packages\/zeditor\/(.*)$/.exec(urlPath);
  if (m) return join(root, 'packages', 'zeditor', m[1]);
  const y = /^(?:\/[^?]*)?\/node_modules\/(yjs|y-protocols|lib0)\/(.*)$/.exec(urlPath);
  if (y) return join(root, 'packages', 'zeditor', 'node_modules', y[1], y[2]);
  return join(root, urlPath);
}

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath === '/' && !siteMode) {
      res.writeHead(302, { location: '/playground/' });
      return res.end();
    }
    let file = normalize(mapPath(urlPath));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    let st = await stat(file).catch(() => null);
    if (st?.isDirectory()) {
      if (!urlPath.endsWith('/')) {
        res.writeHead(302, { location: urlPath + '/' });
        return res.end();
      }
      file = join(file, 'index.html');
      st = await stat(file).catch(() => null);
    }
    if (!st) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found: ' + urlPath);
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e));
  }
});
server.listen(port, '127.0.0.1', () => console.log(siteMode ? `zeditor docs site: http://127.0.0.1:${port}/` : `zeditor dev server: http://127.0.0.1:${port}/  (playground, examples/html)`));
