// Generates docs/api-reference.md from the TypeScript sources: every export of every entry
// point, with its signature and doc comment. Run `pnpm docs:api` after changing the public API;
// `pnpm docs:check` fails when the file is out of date or anything public is undocumented.
//
// Usage: node scripts/api-docs.mjs [--check]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const require = createRequire(resolve('packages/zeditor/package.json'));
const ts = require('typescript');

const pkg = resolve('packages/zeditor');
const ENTRIES = [
  ['@buffmomo/zeditor/core', 'src/core.ts', 'Headless core: document model, commands, extensions, serializers, databases, sync. Works in Node.js.'],
  ['@buffmomo/zeditor', 'src/index.ts', 'Browser entry: everything in `/core`, plus `createEditor`, the view and the default UI parts. Only the exports that are not in `/core` are listed here.'],
  ['@buffmomo/zeditor/react', 'src/react.tsx', 'React adapter.'],
  ['@buffmomo/zeditor/vue', 'src/vue.ts', 'Vue 3 adapter.'],
  ['@buffmomo/zeditor/collab', 'src/collab.ts', 'Real-time collaboration (Yjs).'],
  ['@buffmomo/zeditor/code-highlight', 'src/code-highlight.ts', 'Syntax highlighting for code blocks.'],
].filter(([, f]) => existsSync(resolve(pkg, f)));

const program = ts.createProgram(
  ENTRIES.map(([, f]) => resolve(pkg, f)),
  { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, allowJs: false, noEmit: true },
);
const checker = program.getTypeChecker();

const KIND_ORDER = ['function', 'class', 'const', 'interface', 'type', 'enum'];
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const docOf = (sym) => clean(ts.displayPartsToString(sym.getDocumentationComment(checker)) || '');
const md = (s) => s.replace(/\|/g, '\\|');

function kindOf(decl) {
  if (ts.isFunctionDeclaration(decl)) return 'function';
  if (ts.isClassDeclaration(decl)) return 'class';
  if (ts.isInterfaceDeclaration(decl)) return 'interface';
  if (ts.isTypeAliasDeclaration(decl)) return 'type';
  if (ts.isEnumDeclaration(decl)) return 'enum';
  if (ts.isVariableDeclaration(decl)) {
    const init = decl.initializer;
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return 'function';
    return 'const';
  }
  return 'const';
}
function signature(sym, decl, kind) {
  const name = sym.getName();
  if (kind === 'function') {
    const type = checker.getTypeOfSymbolAtLocation(sym, decl);
    const sigs = type.getCallSignatures();
    if (sigs.length) return sigs.map((s) => `${name}${checker.signatureToString(s, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrowStyleSignature).replace(/^\((.*)\) => /, '($1): ')}`).join('\n');
  }
  if (kind === 'const') {
    const type = checker.getTypeOfSymbolAtLocation(sym, decl);
    let t = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
    if (t.length > 300) t = t.slice(0, 300) + ' …';
    return `const ${name}: ${t}`;
  }
  if (kind === 'type') {
    let t = clean(decl.getText());
    if (t.length > 400) t = t.slice(0, 400) + ' …';
    return t.replace(/^export\s+/, '');
  }
  if (kind === 'class') return `class ${name}`;
  return `interface ${name}`;
}
/** members of interfaces / classes with their doc comments */
function members(sym, decl, kind) {
  if (kind !== 'interface' && kind !== 'class') return [];
  const type = kind === 'class' ? checker.getDeclaredTypeOfSymbol(sym) : checker.getDeclaredTypeOfSymbol(sym);
  const out = [];
  for (const m of checker.getPropertiesOfType(type)) {
    const d = m.valueDeclaration ?? m.declarations?.[0];
    if (!d) continue;
    const mods = ts.canHaveModifiers(d) ? ts.getModifiers(d) ?? [] : [];
    if (mods.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword)) continue;
    if (m.getName().startsWith('#')) continue;
    let t;
    if (ts.isMethodDeclaration(d) || ts.isMethodSignature(d)) {
      const sigs = checker.getTypeOfSymbolAtLocation(m, d).getCallSignatures();
      t = sigs.map((s) => checker.signatureToString(s, undefined, ts.TypeFormatFlags.NoTruncation)).join(' / ');
      t = `${m.getName()}${t}`;
    } else if (ts.isGetAccessorDeclaration(d)) {
      t = `get ${m.getName()}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(m, d), undefined, ts.TypeFormatFlags.NoTruncation)}`;
    } else {
      const opt = m.flags & ts.SymbolFlags.Optional ? '?' : '';
      t = `${m.getName()}${opt}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(m, d), undefined, ts.TypeFormatFlags.NoTruncation)}`;
    }
    if (t.length > 260) t = t.slice(0, 260) + ' …';
    out.push({ t, doc: docOf(m) });
  }
  return out;
}

const seen = new Map(); // symbol name -> entry where it was first listed
const sections = [];
const allNames = new Set();
for (const [spec, file, blurb] of ENTRIES) {
  const sf = program.getSourceFile(resolve(pkg, file));
  const modSym = checker.getSymbolAtLocation(sf);
  if (!modSym) continue;
  const items = [];
  for (const exp of checker.getExportsOfModule(modSym)) {
    const name = exp.getName();
    if (name === 'default') continue;
    allNames.add(name);
    const sym = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    if (!decl) continue;
    if (spec === '@buffmomo/zeditor' && seen.has(name)) continue; // re-exported from core
    if (!seen.has(name)) seen.set(name, spec);
    const kind = kindOf(decl);
    const where = relative(pkg, decl.getSourceFile().fileName).replace(/\\/g, '/');
    items.push({ name, kind, where, sig: signature(exp.flags & ts.SymbolFlags.Alias ? sym : exp, decl, kind), doc: docOf(sym) || docOf(exp), members: members(sym, decl, kind) });
  }
  items.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
  sections.push({ spec, blurb, items });
}

let out = `# API reference

_Generated from the TypeScript sources by \`scripts/api-docs.mjs\` (\`pnpm docs:api\`). Do not edit by
hand._ Guides explain how these fit together: [user guide](user-guide.md),
[commands and the Editor API](commands.md), [events and sync](events-and-sync.md),
[extensions](extensions.md), [serialization](serialization.md), [databases](databases.md),
[collaboration](collaboration.md).

Each entry shows the signature, the source file, and the doc comment where there is one. Types and
interfaces list their members.

`;
out += sections.map((s) => `- [\`${s.spec}\`](#${s.spec.replace(/[^a-z0-9]+/gi, '').toLowerCase()}) — ${s.items.length} exports`).join('\n') + '\n';
for (const s of sections) {
  out += `\n## \`${s.spec}\`\n\n${s.blurb}\n`;
  let kind = '';
  for (const it of s.items) {
    if (it.kind !== kind) {
      kind = it.kind;
      out += `\n### ${{ function: 'Functions', class: 'Classes', const: 'Constants', interface: 'Interfaces', type: 'Types', enum: 'Enums' }[kind]}\n`;
    }
    out += `\n#### \`${it.name}\`\n\n\`\`\`ts\n${it.sig}\n\`\`\`\n\n`;
    if (it.doc) out += it.doc + '\n\n';
    out += `<sub>${it.where}</sub>\n`;
    if (it.members.length) {
      out += `\n| Member | Description |\n| --- | --- |\n`;
      for (const m of it.members) out += `| \`${md(m.t)}\` | ${md(m.doc)} |\n`;
    }
  }
}

// re-exported dependencies (e.g. `Y` from yjs) are printed by TypeScript with absolute,
// machine-specific node_modules paths: reduce them to the package name so the output is the
// same on every machine (and `--check` passes in CI)
const PKG_IN_NM = String.raw`node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/"<]+\/)?[^/"<]+)`;
out = out
  .replace(new RegExp(String.raw`"[^"\n]*?` + PKG_IN_NM + String.raw`[^"\n]*"`, 'g'), '"$1"')
  .replace(new RegExp(String.raw`<sub>[^<\n]*?` + PKG_IN_NM + String.raw`[^<\n]*<\/sub>`, 'g'), '<sub>re-exported from `$1`</sub>')
  .replace(/#### `(\w+)`\n\n```ts\nconst "([^"]+)": typeof import\("\2"\)/g, '#### `$1`\n\n```ts\nconst $1: typeof import("$2")');

const target = resolve('docs/api-reference.md');
const check = process.argv.includes('--check');
const normalize = (s) => s.replace(/\r\n/g, '\n');
if (check) {
  const cur = existsSync(target) ? normalize(readFileSync(target, 'utf8')) : '';
  if (cur !== normalize(out)) {
    console.error('docs/api-reference.md is out of date: run `pnpm docs:api`');
    process.exitCode = 1;
  } else console.log(`docs/api-reference.md is up to date (${[...allNames].length} exported names).`);
} else {
  writeFileSync(target, out);
  console.log(`wrote docs/api-reference.md: ${sections.map((s) => `${s.spec} ${s.items.length}`).join(', ')}`);
}
