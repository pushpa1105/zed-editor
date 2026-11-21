# @z-packages/zeditor

An extensible rich-text **and** block editor. One engine, two interfaces:

- **Classic mode** — a formatting toolbar and continuous document editing.
- **Block mode** — slash commands, block handles, nesting and drag-to-reorder.

Switching modes keeps the document, the caret, the scroll position and the undo history.
Written from scratch in TypeScript: no ProseMirror, Lexical, Slate, Quill or Editor.js underneath.
Zero runtime dependencies in the base bundle. Integrations: **plain HTML/JS**, **React**, **Vue 3**.

## Quick start

### Plain HTML — no framework, no build step

```html
<link rel="stylesheet" href="./node_modules/@z-packages/zeditor/dist/style.css" />
<div id="editor"></div>
<script type="module">
  import { createEditor } from './node_modules/@z-packages/zeditor/dist/zeditor.browser.js';

  const z = createEditor({ element: '#editor', placeholder: 'Write something…' });
  // z.setMode('block');  z.getJSON();  z.setJSON(saved);
</script>
```

### React

```tsx
import { ZEditor, useEditorState } from '@z-packages/zeditor/react';
import '@z-packages/zeditor/style.css';

export function Notes() {
  return <ZEditor mode="block" placeholder="Type / for commands" onChange={(editor) => save(editor.getJSON())} />;
}
```

`content` is the *initial* document. The editor owns its state afterwards, so parent re-renders
(and Strict Mode's double mount) never reset the document or the caret. `mode` and `readOnly`
are live props. Load another document with `ref.current.setJSON(doc)`.

### Vue 3

```vue
<script setup>
import { ZEditor } from '@z-packages/zeditor/vue';
import '@z-packages/zeditor/style.css';
</script>

<template>
  <ZEditor :options="{ placeholder: 'Write something…' }" mode="classic" @change="(editor) => save(editor.getJSON())" />
</template>
```

## Three levels of customization

| Level | What you write |
| --- | --- |
| **Ready-made** | `createEditor({ element })` |
| **Configurable** | `features`, `ui.toolbar: ['bold', 'italic', '|', 'link']`, `labels`, `icons`, `theme`, `upload`, `mentions`, `autosave`, `extensions`, CSS variables |
| **Headless** | `ui: false` (or `createHeadlessEditor()` with no DOM at all) and render every control yourself from `getState()` / `subscribe()` and `editor.commands` |

```js
import { createEditor } from '@z-packages/zeditor';

const z = createEditor({
  element: '#editor',
  mode: 'block',
  features: { tables: false, equation: false }, // switch built-in features off
  ui: { toolbar: ['undo', 'redo', '|', 'bold', 'italic', 'link'], statusBar: true },
  labels: { 'mark.bold': 'Fett' }, // any UI string
  icons: { bold: '<svg …/>' }, // any icon
  theme: 'auto', // light | dark | auto; or `unstyled: true`
  upload: async (file, { signal, onProgress }) => ({ url: await myUpload(file, signal, onProgress) }),
  mentions: { search: async (query, { signal }) => fetchPeople(query, signal) },
  autosave: { save: (doc) => api.save(doc), draftKey: 'doc-42' },
});
```

Theme with CSS variables — no selectors to override:

```css
.zeditor { --z-accent: #7c3aed; --z-radius: 16px; --z-font: Georgia, serif; }
```

## Extensions

Everything built in is an extension, and yours use the same API:

```js
const issueRef = {
  name: 'issue-ref',
  schemaVersion: 1,
  nodes: [{ type: 'issue', kind: 'inline', attrs: { key: { default: '' } }, toText: (a) => a.attrs.key }],
  commands: { insertIssue: (editor, issue) => editor.exec('insertInline', { atom: 'issue', attrs: issue }) },
  keymap: { 'Mod-Shift-i': (editor) => editor.exec('insertIssue', { key: 'ZED-1' }) },
  typeahead: [{ name: 'issue', trigger: '#', search: (q, { signal }) => searchIssues(q, signal), select: (editor, item, range) => { /* … */ } }],
};
createEditor({ element: '#editor', extensions: [issueRef] });
```

Nodes, marks, commands, shortcuts, input rules, paste rules, serializers, toolbar items,
slash-menu items, block actions, typeahead sources, renderers, labels and migrations are all
extension points. See [docs/extensions.md](../../docs/extensions.md).

## Entry points

| Import | Contents | Needs |
| --- | --- | --- |
| `@z-packages/zeditor` | `createEditor`, view, default UI, everything from `/core` | a browser |
| `@z-packages/zeditor/core` | headless engine, commands, HTML/Markdown/JSON, comments, suggestions, versions, autosave, uploads | nothing (Node, workers, SSR) |
| `@z-packages/zeditor/react` | `<ZEditor>`, `useEditorState`, `useEditor`, `NodeContent` | `react`, `react-dom` ≥ 18 |
| `@z-packages/zeditor/vue` | `<ZEditor>`, `useEditorState`, `useEditor`, `NodeContent` | `vue` ≥ 3.3 |
| `@z-packages/zeditor/collab` | Yjs binding, presence, sync, transports | `yjs`, `y-protocols` |
| `@z-packages/zeditor/code-highlight` | syntax highlighting for code blocks | — |
| `@z-packages/zeditor/style.css` | styles (optional with `unstyled`) | — |
| `@z-packages/zeditor/browser` | single-file ES module for `<script type="module">` | — |
| `@z-packages/zeditor/collab/browser` | single-file collaboration module (bundles Yjs) | — |

All framework and collaboration packages are *optional* peer dependencies: a vanilla consumer
installs none of them. The package is ESM, marked side-effect free (except CSS) and split into
shared chunks, so bundlers tree-shake what you do not import.

## Server-side rendering and SEO

```js
import { renderToHTML, renderToText } from '@z-packages/zeditor/core';

const html = renderToHTML(savedDoc, { ids: true }); // semantic, sanitized HTML: h1–h6, ul/ol, table, figure…
const description = renderToText(savedDoc).slice(0, 160);
```

`renderToHTML` runs in Node with no DOM, so stored documents can be served as crawlable HTML,
and every entry point is safe to import during SSR.

## Documentation

- [Architecture](../../docs/architecture.md)
- [Extension authoring](../../docs/extensions.md)
- [Serialization: JSON, HTML, Markdown and their limits](../../docs/serialization.md)
- [Collaboration, review features and what a backend must enforce](../../docs/collaboration.md)
- [Browser support, test coverage and the manual test checklist](../../docs/testing.md)
- [Benchmarks](../../docs/benchmarks.md)
- [Migration and versioning policy](../../docs/migration.md)
- [Feature matrix vs. Lexical](../../FEATURE_MATRIX.md)

## License

MIT
