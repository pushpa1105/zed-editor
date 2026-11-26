# Releasing and updates

How versions are numbered, how a release is cut, and how the documentation website is deployed.
Everything after `git push` runs on GitHub Actions; nobody publishes from a laptop.

## Overview

| What | Where | Trigger |
| --- | --- | --- |
| Checks (build, types, docs, unit tests on Linux / Windows / macOS; browser tests; packed tarball; site build) | `.github/workflows/ci.yml` | every push to `main` and every pull request |
| Documentation website on GitHub Pages | `.github/workflows/pages.yml` | every push to `main`, or run it by hand |
| npm package + GitHub release | `.github/workflows/release.yml` | pushing a tag `vX.Y.Z` |

The single source of the version is `packages/zeditor/package.json`. The website header, the
changelog page and the CDN snippets on the landing page all read it.

## One-time setup

1. **GitHub Pages**: open the repository's *Settings → Pages*, and under *Build and deployment* set
   *Source* to **GitHub Actions**. The next push to `main` publishes the site at
   `https://<owner>.github.io/<repo>/` (for this repository:
   <https://pushpa1105.github.io/zed-editor/>).
2. **npm**: set up publishing in one of these two ways.
   - **Trusted publishing** (recommended, needs no token): on npmjs.com, open the package's
     *Settings → Trusted publishing* and add GitHub Actions with repository
     `pushpa1105/zed-editor` and workflow `release.yml`. For the very first publish, the
     package must exist first, so use the token method once, or publish `0.1.0` by hand.
   - **Token**: create an npm *granular* or *automation* access token that can publish
     `@z-packages/zeditor`. Add it in *Settings → Secrets and variables → Actions* as `NPM_TOKEN`.
3. **Package name**: check the name before the first release. `zeditor` is taken on npm, so the
   package is `@z-packages/zeditor`, and you must own the `@z-packages` scope (an npm organization
   or user). To use another scope, search the repository for `@z-packages/zeditor` and replace
   every occurrence.
4. If the repository moves or is renamed, update `homepage`, `repository` and `bugs` in
   `packages/zeditor/package.json`, and the compare links at the bottom of `CHANGELOG.md`.

## Versioning

The package follows [Semantic Versioning](https://semver.org/).

| Change | 0.x (now) | 1.0 and later |
| --- | --- | --- |
| Bug fix, docs, performance, no API change | patch `0.1.1` | patch `1.0.1` |
| New feature, new option, new command, new export | minor `0.2.0` | minor `1.1.0` |
| Breaking change to the API, to the stored JSON format, or to CSS class names and variables | minor `0.2.0`, listed under **Changed** with a migration note | major `2.0.0` |
| Try a release before it is final | `0.2.0-beta.0` (published under the `next` dist-tag) | same |

The stored document JSON carries `version`. A change to it also needs a migration in
`docs/migration.md`, and the old format must keep loading.

Move to `1.0.0` once the open items in `PROGRESS.md` ("Manual test pass", parity check) are done
and the API has been stable for a release or two.

## Day to day: keeping the changelog

Every pull request that changes behaviour adds a line under `## [Unreleased]` in
`CHANGELOG.md`, in the matching group:

- **Added**: new features
- **Changed**: changes in existing behaviour (mark breaking ones **Breaking:**)
- **Deprecated**: features that will be removed later
- **Removed**: features that were removed
- **Fixed**: bug fixes
- **Security**: vulnerability fixes

Write entries for people who use the package: say what they can now do or what changed for them,
not which files moved. Leave empty groups in place, because the release script removes them.

If the public API changed, also run `pnpm docs:api`, and update `docs/commands.md` or the guide.
`pnpm docs:check` fails when something public is undocumented.

## Cutting a release

```sh
git switch main && git pull
pnpm install
pnpm release minor            # or: patch | major | 0.3.0 | prerelease --preid beta
                              # add --dry-run first to preview
pnpm check                    # build, types, docs, unit, browser, packed tarball
git add -A
git commit -m "release: v0.2.0"
git tag -a v0.2.0 -m v0.2.0
git push --follow-tags
```

`pnpm release <bump>` updates the version in `packages/zeditor/package.json` and moves the
`Unreleased` entries into a dated `## [0.2.0] - YYYY-MM-DD` section of `CHANGELOG.md`. It also
starts a fresh `Unreleased` section and updates the compare links. It refuses to run while
`Unreleased` is empty. With `--commit` it also makes the commit and the tag. It never pushes.

The tag push starts **Release**, which:

1. fails early if the tag does not match the package version or the changelog has no section for it
   (`node scripts/release-notes.mjs vX.Y.Z --check`);
2. builds, type-checks, checks the docs and runs the unit tests;
3. runs `npm publish --provenance`, under the `latest` dist-tag, or under `next` when the version
   has a pre-release suffix such as `-beta.0`;
4. creates the GitHub release with that changelog section as its notes and the `.tgz` attached.

The same push to `main` redeploys the website, so the docs show the new version within a few
minutes.

### Pre-releases

```sh
pnpm release prerelease --preid beta    # 0.1.0 -> 0.1.1-beta.0, then -beta.1, …
pnpm release minor                      # 0.1.1-beta.1 -> 0.2.0 (finishes the line)
```

Users install a pre-release with `npm install @z-packages/zeditor@next`.

### If something goes wrong

- **The Release workflow failed before "Publish to npm"**: fix the problem on `main`. Then move the
  tag (`git tag -d v0.2.0 && git push origin :refs/tags/v0.2.0`), tag the fixed commit and push
  it again.
- **It failed after publishing**: an npm version cannot be published twice. Leave it, fix forward
  with a patch release, and create the GitHub release by hand if that step did not run
  (`gh release create v0.2.0 --notes "$(pnpm -s release:notes 0.2.0)"`).
- **A bad version reached users**: `npm deprecate @z-packages/zeditor@0.2.0 "use 0.2.1"`, then
  publish the fix. Use `npm unpublish` only within 72 hours, and only when nothing depends on the
  version yet.

## The documentation website

`pnpm site` builds `_site/` from:

| Source | Becomes |
| --- | --- |
| `packages/zeditor/README.md` | Getting started |
| `docs/*.md`, `FEATURE_MATRIX.md`, `CHANGELOG.md`, `RELEASING.md`, `CONTRIBUTING.md` | one page each, with search, an "On this page" outline and "Edit on GitHub" links |
| `playground/`, `examples/html/`, `examples/collab/` | the same pages, pointed at a copy of the built package |
| `examples/react/dist`, `examples/vue-vuetify/dist` | the React and Vue example apps (run `pnpm build:examples` first) |
| `website/assets/` | the site's CSS, JS and icon |

Preview it locally:

```sh
pnpm build && pnpm build:examples && pnpm site
pnpm site:serve          # http://127.0.0.1:4180/
```

**To add a page**, write the Markdown file and add one line to `NAV` at the top of
`scripts/build-site.mjs`. Links between Markdown files (`[x](./databases.md#views)`) become site
links automatically. Links to any other repository file go to GitHub.

The site uses relative links only, so it works at any base path: a project page, a user page or a
custom domain. For a custom domain, add the domain under *Settings → Pages*. The Pages workflow
passes the URL to the build for `sitemap.xml`.

## Release checklist

- [ ] `CHANGELOG.md` → `Unreleased` describes every user-visible change
- [ ] breaking changes carry a migration note (and `docs/migration.md` if stored JSON changed)
- [ ] `pnpm docs:api` was run if exports changed; `pnpm docs:check` passes
- [ ] `pnpm release <bump>` → `pnpm check` passes locally
- [ ] commit, tag, `git push --follow-tags`
- [ ] Release workflow green; the package is on npm; the GitHub release exists
- [ ] website shows the new version; the landing-page demo loads
- [ ] `PROGRESS.md` updated with what shipped and what is next
