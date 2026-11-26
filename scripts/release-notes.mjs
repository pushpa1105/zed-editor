// Prints the CHANGELOG.md section of one version (used as the GitHub release body), and
// optionally verifies that it matches the package version.
// Usage: node scripts/release-notes.mjs [version|vX.Y.Z] [--check]
//   --check   exit 1 unless the version equals packages/zeditor/package.json and has a section
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'packages', 'zeditor', 'package.json'), 'utf8'));
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const version = (arg ?? pkg.version).replace(/^v/, '');
const check = process.argv.includes('--check');
const log = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');

const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const m = new RegExp(`^## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^\\[[^\\]]+\\]: |(?![\\s\\S]))`, 'm').exec(log);
if (check) {
  const problems = [];
  if (version !== pkg.version) problems.push(`tag v${version} does not match packages/zeditor/package.json version ${pkg.version}`);
  if (!m || !m[1].trim()) problems.push(`CHANGELOG.md has no entries for ${version}`);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
}
if (!m) {
  console.error(`no CHANGELOG.md section for ${version}`);
  process.exit(1);
}
process.stdout.write(m[1].trim() + '\n');
