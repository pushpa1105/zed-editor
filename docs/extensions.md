# Writing extensions

An extension is a plain object. Everything the editor ships with is built this way, so an
extension can do anything a built-in feature does.

```ts
import { defineExtension, type Extension } from '@buffmomo/zeditor';

export const myExtension: Extension = defineExtension({
  name: 'my-extension',        // unique; an extension with the same name replaces an earlier one
  version: '1.2.0',            // informational
  schemaVersion: 1,            // version of your node data, stored in documents (see Migrations)
  apiVersion: 1,               // extension API you target; a newer engine API throws a clear error
  requires: ['base'],          // dependencies: must be installed, and are set up first
  priority: 0,                 // higher priority keymaps / rules run first
  override: false,             // allow replacing nodes / marks / commands defined by others

  nodes: [], marks: [],        // schema
  extendNode: {}, extendMark: {}, // add behaviour to an existing node or mark
  commands: {}, keymap: {}, inputRules: [], pasteRules: [],
  toolbar: [], slashItems: [], blockActions: [], typeahead: [],
  labels: {},                  // UI strings, overridable by the host
  migrate: (doc, fromVersion) => doc,
  normalize: (tr) => false,    // structural fix-ups inside each transaction
  setup: (editor) => () => {}, // called once per editor; return a cleanup function
});
```

## Nodes

```ts
nodes: [{
  type: 'notice',
  kind: 'container',              // 'text' | 'container' | 'atom' | 'inline'
  attrs: {
    tone: { default: 'tip', validate: (v) => (['tip', 'warning'].includes(v) ? v : undefined) },
  },
  children: undefined,            // container: allowed child types (default: any block)
  isolating: false,               // selection / joins do not cross the boundary (cells, columns, pages)
  parents: undefined,             // only valid inside these parent types
  render: (block, ctx) => {       // DOM renderer (see below)
    const dom = document.createElement('div');
    return { dom, childrenDOM: dom, update: (b) => { dom.dataset.tone = b.attrs.tone; } };
  },
  toHTML: (b, c) => `<div data-notice="${c.esc(b.attrs.tone)}">${c.children(b)}</div>`,
  parseHTML: [{ tag: 'div', match: (el) => 'data-notice' in el.attrs, getAttrs: (el) => ({ tone: el.attrs['data-notice'] }) }],
  toMarkdown: (b, c) => c.children(b),
  toText: (b) => '',
}]
```

- `validate` receives untrusted values. Return the sanitized value, or `undefined` to fall
  back to the default. It runs for loaded documents, pasted content and `setBlockAttrs`.
- Nodes without `toHTML` / `toMarkdown` still round-trip: HTML uses `data-z-type` +
  `data-z-attrs`, Markdown a `<!-- zeditor:block {...} -->` comment.
- **Renderers** return `{ dom, contentDOM?, childrenDOM?, update?, destroy? }`. `contentDOM` is
  where inline content goes (text kinds), `childrenDOM` where child blocks go. `update(block)`
  is called when attrs change; return `false` to have the view re-created. Mark interactive
  controls inside the document with `contenteditable="false"` and `data-z-ignore` so the editor
  leaves their keyboard and input events alone. A renderer that throws is replaced by the
  default renderer and logged; it cannot take the editor down.
- **Hosts override rendering** without touching the extension:
  `createEditor({ renderers: { notice: myRenderer }, inlineRenderers: { issue: … } })`, or
  `nodeViews` / `inlineViews` with React or Vue components (see the examples).

## Marks

```ts
marks: [{
  type: 'spoiler',
  inclusive: true,                 // typing at the end extends the mark (links use false)
  excludes: [],                    // mark types removed when this one is applied
  rank: 50,                        // lower renders outermost
  attrs: {},
  render: () => Object.assign(document.createElement('span'), { className: 'spoiler' }),
  toHTML: () => ['<span class="spoiler">', '</span>'],
  parseHTML: [{ tag: 'span', match: (el) => el.classes.includes('spoiler') }],
  toMarkdown: () => ['||', '||'],
}]
```

## Commands

```ts
commands: {
  insertNotice: (editor, attrs = {}) => editor.exec('insertBlocks', [editor.schema.create('notice', attrs)]),
}
// editor.commands.insertNotice({ tone: 'warning' })   or   editor.exec('insertNotice')
```

A command returns `true` when it did something. Use `editor.update(tr => …)` for changes; it
is atomic and undoable. Add types by augmenting the `Commands` interface:

```ts
declare module '@buffmomo/zeditor' {
  interface Commands { insertNotice(attrs?: { tone?: string }): boolean }
}
```

## Shortcuts, input rules, paste rules

```ts
keymap: { 'Mod-Shift-n': 'insertNotice', 'Alt-ArrowUp': (editor, event) => false /* not handled */ },
inputRules: [{ match: /^!!\s$/, run: (editor, match, { block, from, to }) => { /* convert */ return true; } }],
pasteRules: [{ run: (editor, { text, html, files, json }) => false }],
```

Handlers for the same key are tried in priority order until one returns `true`. `Mod` is ⌘ on
macOS and Ctrl elsewhere. Input rules are tested against the text before the caret and become
their own undo entry. Paste rules run before the built-in paste handling.

## UI contributions

```ts
toolbar: [{ id: 'notice', label: 'Notice', icon: 'callout', command: 'insertNotice', active: (e) => false, enabled: (e) => !e.readOnly, order: 73 }],
slashItems: [{ id: 'notice', title: 'Notice', keywords: ['callout'], run: (editor, { blockId }) => editor.exec('insertNotice') }],
blockActions: [{ id: 'archive', label: 'Archive', run: (editor, ids) => {} }],
typeahead: [{
  name: 'issue', trigger: '#', debounce: 150,
  search: async (query, { signal }) => fetchIssues(query, signal),   // stale answers are dropped, superseded requests aborted
  select: (editor, item, range) => { /* replace range.from..range.to in block range.id */ },
}],
```

Items are data, so they appear in whichever toolbar the host renders — including a custom one.
An item with the same `id` as an existing one replaces it.

## Adding behaviour to an existing block

```ts
defineExtension({
  name: 'heading-anchors',
  extendNode: { heading: (spec) => ({ ...spec, attrs: { ...spec.attrs, anchor: { default: '' } } }) },
  keymap: { 'Mod-Alt-a': (editor) => { /* set the anchor on the current heading */ return true; } },
});
```

## Dependencies, conflicts, cleanup

- **Dependencies**: `requires` names must be installed; missing or circular dependencies throw
  at editor creation with the chain in the message.
- **Conflicts**: two extensions defining the same node, mark or command throw unless the later
  one sets `override: true`. Keymaps never conflict — they chain.
- **Cleanup**: return a function from `setup`. It runs on `editor.destroy()`, in reverse order.
- **Compatibility**: `apiVersion` is the extension contract version (currently `1`). It is
  bumped only for breaking changes to this contract; an extension built for a newer contract
  fails fast instead of misbehaving.

## Migrations

Documents record `extensions: { 'my-extension': <schemaVersion> }`. When a document saved with
an older version is loaded, `migrate(doc, fromVersion)` runs before validation:

```ts
schemaVersion: 2,
migrate: (doc, from) => { if (from < 2) { /* rename attrs, etc. */ } return doc; },
```

If the extension is missing when a document is opened, its nodes are preserved as inert data
and come back when the extension is installed again.

## Shared, framework-independent extensions

`examples/shared/extensions.js` defines an issue reference (inline node + async `#` menu) and
a notice callout (custom container). The plain HTML, React and Vue examples import the same
file; React overrides the issue rendering with a component, Vue the notice with a Vuetify alert.
