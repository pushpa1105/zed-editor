# zeditor

An extensible, open-source rich-text and block editor written from scratch in TypeScript.
One engine, two interfaces — **Classic** (toolbar, continuous document) and **Blocks**
(slash commands, handles, nesting, drag-to-reorder) — for **plain HTML/JS**, **React** and **Vue 3**.

- Package: [`packages/zeditor`](packages/zeditor) → `@z-packages/zeditor` ([README with quick starts](packages/zeditor/README.md))
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
| `pnpm test:browser` | Playwright tests in Chromium, Firefox and WebKit (`pnpm --filter @z-packages/zeditor exec playwright install` once) |
| `pnpm bench` | benchmarks → `docs/benchmarks.md` |
| `pnpm pack:verify` | pack the tarball and verify it in clean consumer projects → `docs/pack-verify.json` |
| `pnpm check` | all of the above except the benchmark |

## Repository layout

```
packages/zeditor/        the npm package (src, tests, build script)
examples/html/           no-build example
examples/react/          React example (Vite)
examples/vue-vuetify/    Vue 3 + Vuetify example (Vite)
examples/collab/         two-client collaboration example (no build)
examples/shared/         framework-independent extensions used by all examples
playground/              playground page (no build)
docs/                    architecture, extensions, serialization, databases, collaboration, testing, benchmarks, migration
scripts/                 dev server, benchmarks, pack verification, screenshots
```

## Publishing

Publishing to npm is a separate, manual owner action and has **not** been done. The unscoped
name `zeditor` is already taken on npm, so the package is named `@z-packages/zeditor`; choose the
final name/scope before publishing (it is a search-and-replace). Then, from `packages/zeditor`:
`pnpm build && npm publish --access public`.

## License

MIT
