# Versioning and migration policy

## Package versions

Semantic versioning. While the package is `0.x`, a minor release may contain breaking changes;
they are listed in the changelog with upgrade notes. From `1.0`:

| Change | Release |
| --- | --- |
| Breaking change to a public export, a command signature, the document format, or the extension contract | major |
| New features, new optional fields, new commands, new extension points | minor |
| Fixes | patch |

"Public" means everything exported from the documented entry points
(`.`, `/core`, `/react`, `/vue`, `/collab`, `/code-highlight`, the CSS variables and the
`z-*` class names listed in the stylesheet header). Anything else — files under `dist/chunks`,
private class members, undocumented `storage` keys — may change at any time.

## Document format

- Documents carry `format: "zeditor"` and an integer `version` (currently `1`).
- **Old documents always open.** When the format changes, a migration from each previous
  version is added to the schema and applied automatically on load, in order. Migrations are
  never removed within a major version.
- **Newer documents open with a warning.** A document whose `version` is higher than the
  library supports is loaded on a best-effort basis and `issues` reports it; nodes this version
  does not know are preserved as inert data, so saving does not destroy them.
- Additive changes (a new optional attribute, a new node type) do **not** bump the version.
- Saving always writes the current version.

## Extension data

- An extension declares `schemaVersion`. Saved documents record the version of every installed
  extension that declares one (`extensions: { name: version }`).
- When a document saved with an older version is loaded, the extension's
  `migrate(doc, fromVersion)` runs before validation.
- A document that needs an extension which is not installed still opens: its blocks render as
  placeholders, inline nodes as chips, and both are written back unchanged. Installing the
  extension later restores them.

## Extension contract

`API_VERSION` (currently `1`) identifies the extension contract. Extensions may declare the
`apiVersion` they were written for. An engine refuses an extension that targets a **newer**
contract (clear error at creation). Extensions written for an older contract keep working
within a major version; if a contract change cannot be made compatible, it ships in a major
release with a migration guide.

## Collaboration

The shared Yjs structure (`blocks` array of maps with `id`, `type`, `attrs`, `text`,
`children`) is part of the document format and follows the same policy. All clients in a room
must run compatible versions; mixed major versions in one room are not supported.

## Deprecations

A deprecated API keeps working for at least one minor release, is marked `@deprecated` in the
types and listed in the changelog, and is removed no earlier than the next major.
