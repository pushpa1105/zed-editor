// Prepares a release: bumps the package version and turns the "Unreleased" section of
// CHANGELOG.md into a dated version section. It does not publish — pushing the tag does that
// (.github/workflows/release.yml). See RELEASING.md.
//
// Usage:
//   node scripts/release.mjs <patch|minor|major|x.y.z[-pre.n]> [--preid beta] [--dry-run] [--commit]
//   pnpm release minor
//   pnpm release prerelease --preid beta      0.2.0 -> 0.2.1-beta.0 -> 0.2.1-beta.1
//
// --commit  also runs `git commit` and `git tag vX.Y.Z` (it never pushes).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const pkgPath = join(root, 'packages', 'zeditor', 'package.json');
const changelogPath = join(root, 'CHANGELOG.md');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const bump = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--preid');
const dry = flag('--dry-run');
const fail = (msg) => { console.error('release: ' + msg); process.exit(1); };

if (!bump) fail('usage: node scripts/release.mjs <patch|minor|major|prerelease|x.y.z> [--preid beta] [--dry-run] [--commit]');

const pkgText = readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(pkgText);
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const cur = SEMVER.exec(pkg.version);
if (!cur) fail(`current version "${pkg.version}" is not semver`);
const [maj, min, pat] = cur.slice(1, 4).map(Number);
const pre = cur[4];

let next;
if (bump === 'major') next = pre && min === 0 && pat === 0 ? `${maj}.0.0` : `${maj + 1}.0.0`;
else if (bump === 'minor') next = pre && pat === 0 ? `${maj}.${min}.0` : `${maj}.${min + 1}.0`;
else if (bump === 'patch') next = pre ? `${maj}.${min}.${pat}` : `${maj}.${min}.${pat + 1}`;
else if (bump === 'prerelease') {
  const id = opt('--preid') ?? 'beta';
  const m = pre && new RegExp(`^${id}\\.(\\d+)$`).exec(pre);
  next = m ? `${maj}.${min}.${pat}-${id}.${Number(m[1]) + 1}` : pre ? `${maj}.${min}.${pat}-${id}.0` : `${maj}.${min}.${pat + 1}-${id}.0`;
} else if (SEMVER.test(bump)) next = bump;
else fail(`unknown bump "${bump}"`);
if (next === pkg.version) fail(`version is already ${next}`);

// ---- changelog ----
let log = readFileSync(changelogPath, 'utf8');
const head = /^## \[Unreleased\][^\n]*\n/m.exec(log);
if (!head) fail('CHANGELOG.md has no "## [Unreleased]" section');
const start = head.index + head[0].length;
const endRel = log.slice(start).search(/^## \[/m);
const end = endRel < 0 ? log.length : start + endRel;
const unreleased = log.slice(start, end);
// drop empty "### Heading" groups
const groups = unreleased.split(/^(?=### )/m);
const kept = groups.filter((g) => !g.startsWith('### ') || g.replace(/^### [^\n]*\n/, '').trim());
const body = kept.join('').trim();
if (!/^\s*[-*] /m.test(body)) fail('the "Unreleased" section of CHANGELOG.md has no entries — describe the changes first');

const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; // local date
const template = '\n### Added\n\n### Changed\n\n### Fixed\n\n';
log = log.slice(0, start) + template + `## [${next}] - ${today}\n\n${body}\n\n` + log.slice(end);

// compare links at the bottom
const repo = (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
if (repo) {
  const prevTag = /^\[Unreleased\]: .*\/compare\/(\S+?)\.\.\.HEAD$/m.exec(log)?.[1] ?? `v${pkg.version}`;
  log = log.replace(/^\[Unreleased\]: .*$/m, `[Unreleased]: ${repo}/compare/v${next}...HEAD\n[${next}]: ${repo}/compare/${prevTag}...v${next}`);
}

console.log(`release: ${pkg.version} -> ${next}\n`);
console.log(`## [${next}] - ${today}\n\n${body}\n`);
if (dry) {
  console.log('(dry run: nothing written)');
  process.exit(0);
}
writeFileSync(pkgPath, pkgText.replace(/"version":\s*"[^"]+"/, `"version": "${next}"`));
writeFileSync(changelogPath, log);
console.log('updated packages/zeditor/package.json and CHANGELOG.md');

if (flag('--commit')) {
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'inherit' });
  git('add', pkgPath, changelogPath);
  git('commit', '-m', `release: v${next}`);
  git('tag', '-a', `v${next}`, '-m', `v${next}`);
  console.log(`\ncommitted and tagged v${next}. Publish with:\n  git push --follow-tags`);
} else {
  console.log(`\nnext steps:\n  pnpm check\n  git add -A && git commit -m "release: v${next}"\n  git tag -a v${next} -m v${next}\n  git push --follow-tags        # the Release workflow publishes to npm and creates the GitHub release`);
}
