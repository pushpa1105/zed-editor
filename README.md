# zeditor

[![CI](https://github.com/pushpa1105/zed-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/pushpa1105/zed-editor/actions/workflows/ci.yml)
[![Docs site](https://github.com/pushpa1105/zed-editor/actions/workflows/pages.yml/badge.svg)](https://pushpa1105.github.io/zed-editor/)
[![npm](https://img.shields.io/npm/v/@buffmomo/zeditor)](https://www.npmjs.com/package/@buffmomo/zeditor)

**[Documentation website](https://pushpa1105.github.io/zed-editor/)** · [Playground](https://pushpa1105.github.io/zed-editor/playground/) · [Changelog](CHANGELOG.md) · [Releasing](RELEASING.md) · [Contributing](CONTRIBUTING.md)

An extensible, open-source rich-text and block editor written from scratch in TypeScript.
One engine, two interfaces — **Classic** (toolbar, continuous document) and **Blocks**
(slash commands, handles, nesting, drag-to-reorder) — for **plain HTML/JS**, **React** and **Vue 3**.

- Package: [`packages/zeditor`](packages/zeditor) → `@buffmomo/zeditor` ([README with quick starts](packages/zeditor/README.md))
- [User guide](docs/user-guide.md) · [Commands and Editor API](docs/commands.md) · [Block IDs, events and backend sync](docs/events-and-sync.md) · [API reference](docs/api-reference.md)
- [Feature matrix vs. Lexical 0.53.0](FEATURE_MATRIX.md) · [Architecture](docs/architecture.md) · [Progress / resume notes](PROGRESS.md)

## Try it

```sh
pnpm install
pnpm build
pnpm playground        # http://127.0.0.1:4173/
```

| URL | What |
| --- | --- |
| `/playground/` | mode switch, feature toggles, themes, custom toolbar, document inspector, import/export, review, versions, a sample database |
| `/examples/html/` | plain HTML page — no framework, no TypeScript, no build step |
| `/examples/collab/` | two clients, presence, offline/reconnect (`?room=x` to use two tabs) |
| `/examples/react/dist/` | React (Strict Mode) with a custom issue-reference node and async `#` menu — run `pnpm build:examples` first, or `pnpm --filter zeditor-example-react dev` |
| `/examples/vue-vuetify/dist/` | Vue 3 with a Vuetify toolbar and a custom callout — same |

## Commands

| | |
| --- | --- |
| `pnpm build` | build the package (ESM entries, browser bundles, CSS, types) |
| `pnpm build:examples` | build the React and Vue example apps |
| `pnpm typecheck` | type-check the package and the React example |
| `pnpm test` | unit, randomized and collaboration tests (Vitest, Node) |
| `pnpm test:browser` | Playwright tests in Chromium, Firefox and WebKit (`pnpm --filter @buffmomo/zeditor exec playwright install` once) |
| `pnpm bench` | benchmarks → `docs/benchmarks.md` |
| `pnpm docs:api` | regenerate `docs/api-reference.md` from the sources |
| `pnpm docs:check` | fail if anything public (exports, commands, events, toolbar items, options) is undocumented or the API reference is stale |
| `pnpm pack:verify` | pack the tarball and verify it in clean consumer projects → `docs/pack-verify.json` |
| `pnpm check` | all of the above except the benchmark |
| `pnpm site` / `pnpm site:serve` | build the documentation website into `_site/` (after `pnpm build` and `pnpm build:examples`) / serve it at http://127.0.0.1:4180/ |
| `pnpm release <patch\|minor\|major\|x.y.z>` | bump the version and date the changelog — see [RELEASING.md](RELEASING.md) |

## Repository layout

```
packages/zeditor/        the npm package (src, tests, build script)
examples/html/           no-build example
examples/react/          React example (Vite)
examples/vue-vuetify/    Vue 3 + Vuetify example (Vite)
examples/collab/         two-client collaboration example (no build)
examples/shared/         framework-independent extensions used by all examples
playground/              playground page (no build)
docs/                    user guide, events and sync, architecture, extensions, serialization, databases, collaboration, testing, benchmarks, migration
scripts/                 dev server, benchmarks, pack verification, screenshots, site builder, release
website/                 documentation website assets (CSS, JS); built by scripts/build-site.mjs
.github/workflows/       CI, GitHub Pages deployment, npm release
```

## Releases and the docs website

- **Website**: every push to `main` builds the docs, playground and examples and deploys them to
  GitHub Pages (`.github/workflows/pages.yml`). Enable it once under *Settings → Pages → Source:
  GitHub Actions*.
- **Releases**: `pnpm release minor` → `pnpm check` → commit → `git tag vX.Y.Z` →
  `git push --follow-tags`. The tag publishes to npm and creates the GitHub release
  (`.github/workflows/release.yml`).
- Versioning policy, one-time npm setup and recovery steps: [RELEASING.md](RELEASING.md).

The unscoped name `zeditor` is taken on npm, so the package is `@buffmomo/zeditor`.

## License

MIT
