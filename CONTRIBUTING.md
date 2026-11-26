# Contributing

Thanks for helping with zeditor. This page covers setting up the project, the checks a change
has to pass, and how changes reach a release.

## Setup

You need Node 18 or newer (CI uses 24) and pnpm 10 (`corepack enable` installs the right version).

```sh
pnpm install
pnpm build
pnpm --filter @buffmomo/zeditor exec playwright install chromium firefox webkit   # once, for browser tests
pnpm playground        # http://127.0.0.1:4173/
```

| Folder | Contents |
| --- | --- |
| `packages/zeditor/src/core` | headless engine: model, schema, steps, commands, serializers |
| `packages/zeditor/src/view` | DOM rendering, input and selection |
| `packages/zeditor/src/ui` | default toolbar, menus and panels |
| `packages/zeditor/src/features` | optional features (review, sync, …) |
| `packages/zeditor/test` | Vitest unit tests (`unit/`) and Playwright browser tests (`browser/`) |
| `docs/` | guides and the generated API reference; also the website's pages |
| `website/` | the documentation website's CSS and JS; `scripts/build-site.mjs` builds it |
| `examples/`, `playground/` | runnable examples, also published on the website |

[Architecture](docs/architecture.md) explains how the pieces fit together.

## Making a change

1. Create a branch from `main`.
2. Make the change, with tests. Unit tests go in `packages/zeditor/test/unit`. Anything that
   depends on real browser input, selection or layout goes in `packages/zeditor/test/browser`.
3. If you changed anything public (exports, commands, events, options, toolbar items), run
   `pnpm docs:api` and document it in `docs/commands.md` or the matching guide.
4. Add a line to `CHANGELOG.md` under `## [Unreleased]` (see [RELEASING.md](RELEASING.md#day-to-day-keeping-the-changelog)).
5. Run the checks:

   ```sh
   pnpm check        # build, typecheck, docs check, unit tests, browser tests, packed tarball
   ```

   For quicker loops, use `pnpm test`, or `pnpm --filter @buffmomo/zeditor exec playwright test some.spec.ts --project=chromium`.
   Browser tests load `packages/zeditor/dist`, so rebuild first (`SKIP_TYPES=1 node build.mjs`
   inside `packages/zeditor` is the fast way).
6. For visual changes, attach before and after screenshots to the pull request. `node scripts/shots.mjs <dir>` and
   `node scripts/shots-db.mjs <dir>` take them.
7. Open a pull request. CI runs the same checks on Linux, Windows and macOS.

## Guidelines

- **Base bundle has zero runtime dependencies.** Optional integrations (React, Vue, Yjs) are
  optional peer dependencies behind their own entry points.
- **Everything is an extension.** New built-in features should use the same extension API that
  users have. See [Writing extensions](docs/extensions.md).
- **Stored JSON is a contract.** Never break loading of existing documents. Changes to the format
  need a schema migration and a note in [docs/migration.md](docs/migration.md).
- **Accessible by default.** Every control is reachable by keyboard and has a label. Menus follow
  the ARIA patterns already used in `src/ui`.
- **Performance.** Do not read layout inside a transaction. `pnpm bench` updates
  `docs/benchmarks.md`.

## Reporting bugs and requesting features

Use [GitHub issues](https://github.com/pushpa1105/zed-editor/issues). For bugs, include the
browser and OS, the editor options, and the smallest document JSON (`editor.getJSON()`) that
reproduces the problem.

## License

By contributing you agree that your contributions are licensed under the MIT License.
