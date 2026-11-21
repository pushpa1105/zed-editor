// Framework-independent extensions shared by the plain HTML, React and Vue examples.
// They use only public exports of the package. Documents saved by one example open in the
// others; each host may override how the nodes are rendered (see the React and Vue apps).
import { textSel, escapeHTML } from '@z-packages/zeditor';

/** Demo data. A real host passes its own `search` function. */
export const DEMO_ISSUES = [
  { key: 'ZED-101', title: 'Cursor jumps after paste', status: 'open' },
  { key: 'ZED-102', title: 'Add table column resize', status: 'done' },
  { key: 'ZED-117', title: 'IME composition in lists', status: 'open' },
  { key: 'ZED-130', title: 'Dark theme contrast', status: 'open' },
  { key: 'ZED-142', title: 'Collaboration reconnect', status: 'done' },
];

/**
 * "Issue reference": an inline atom such as ZED-101, inserted from an async suggestion menu
 * that opens on `#`.
 *
 * @param {{ search?: (query: string, ctx: { signal: AbortSignal }) => Promise<Array<{key:string,title:string,status?:string}>> | Array<{key:string,title:string,status?:string}> }} [options]
 */
export function issueRefExtension(options = {}) {
  const search =
    options.search ??
    ((query) => {
      const q = query.toLowerCase();
      return DEMO_ISSUES.filter((i) => i.key.toLowerCase().includes(q) || i.title.toLowerCase().includes(q));
    });
  return {
    name: 'issue-ref',
    schemaVersion: 1,
    requires: ['base'],
    nodes: [
      {
        type: 'issue',
        kind: 'inline',
        attrs: {
          key: { default: '', validate: (v) => (typeof v === 'string' && /^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/.test(v) ? v : undefined) },
          title: { default: '', validate: (v) => (typeof v === 'string' ? v.slice(0, 200) : undefined) },
          status: { default: 'open', validate: (v) => (v === 'open' || v === 'done' ? v : undefined) },
        },
        // default DOM rendering; hosts can replace it with `inlineRenderers: { issue: ... }`
        render: (atom) => {
          const el = document.createElement('span');
          el.className = 'issue-ref issue-' + (atom.attrs.status ?? 'open');
          el.title = atom.attrs.title ?? '';
          el.textContent = atom.attrs.key;
          el.style.cssText = 'border:1px solid currentColor;border-radius:10px;padding:0 6px;font-size:.85em;font-weight:600;color:' + (atom.attrs.status === 'done' ? '#15803d' : '#b45309');
          return el;
        },
        toText: (atom) => atom.attrs.key,
        toMarkdown: (atom) => atom.attrs.key,
        toHTML: (atom) => `<span data-issue="${escapeHTML(atom.attrs.key)}" data-status="${escapeHTML(atom.attrs.status ?? 'open')}" title="${escapeHTML(atom.attrs.title ?? '')}">${escapeHTML(atom.attrs.key)}</span>`,
        parseHTML: [{ tag: 'span', match: (el) => !!el.attrs['data-issue'], getAttrs: (el) => ({ key: el.attrs['data-issue'], status: el.attrs['data-status'], title: el.attrs.title ?? '' }), priority: 60 }],
      },
    ],
    commands: {
      insertIssue: (editor, issue) => editor.exec('insertInline', { atom: 'issue', attrs: issue }, { trailingSpace: true }),
    },
    typeahead: [
      {
        name: 'issue',
        trigger: '#',
        debounce: 150,
        emptyLabel: 'No matching issues',
        search: async (query, { signal }) => {
          const list = await search(query, { signal });
          return list.map((i) => ({ id: i.key, label: `${i.key} — ${i.title}`, description: i.status, issue: i }));
        },
        select: (editor, item, range) => {
          editor.update((tr) => {
            tr.replaceText(range.id, range.from, range.to, [{ atom: 'issue', attrs: { key: item.issue.key, title: item.issue.title, status: item.issue.status ?? 'open' } }, { text: ' ' }]);
            tr.select(textSel(range.id, range.from + 2));
          });
        },
      },
    ],
  };
}

const TONES = ['tip', 'warning', 'danger'];

/**
 * "Notice" callout: a custom container block with a tone and a title that holds ordinary,
 * editable child blocks.
 */
export function calloutExtension() {
  return {
    name: 'notice-callout',
    schemaVersion: 1,
    requires: ['base'],
    nodes: [
      {
        type: 'notice',
        kind: 'container',
        attrs: {
          tone: { default: 'tip', validate: (v) => (TONES.includes(v) ? v : undefined) },
          title: { default: 'Note', validate: (v) => (typeof v === 'string' ? v.slice(0, 120) : undefined) },
        },
        // default DOM rendering; the Vue example replaces this with a Vuetify component
        render: (block, ctx) => {
          const colors = { tip: '#2563eb', warning: '#d97706', danger: '#dc2626' };
          const dom = document.createElement('div');
          const head = document.createElement('div');
          const title = document.createElement('input');
          const tone = document.createElement('select');
          const body = document.createElement('div');
          head.contentEditable = 'false';
          head.setAttribute('data-z-ignore', '');
          head.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:4px';
          title.setAttribute('aria-label', 'Notice title');
          title.style.cssText = 'font:inherit;font-weight:700;border:0;background:transparent;color:inherit;flex:1;min-width:0';
          tone.setAttribute('aria-label', 'Notice tone');
          for (const t of TONES) tone.append(new Option(t, t));
          head.append(title, tone);
          dom.append(head, body);
          let id = block.id;
          title.addEventListener('change', () => ctx.editor.exec('setBlockAttrs', id, { title: title.value }));
          title.addEventListener('keydown', (e) => e.stopPropagation());
          tone.addEventListener('change', () => ctx.editor.exec('setBlockAttrs', id, { tone: tone.value }));
          const update = (b) => {
            id = b.id;
            if (document.activeElement !== title) title.value = b.attrs.title ?? '';
            tone.value = b.attrs.tone ?? 'tip';
            dom.dataset.tone = tone.value;
            dom.style.cssText = `border:1px solid ${colors[tone.value]};border-left-width:5px;border-radius:8px;padding:10px 14px;margin:8px 0`;
            title.readOnly = tone.disabled = ctx.editor.readOnly;
          };
          update(block);
          return { dom, childrenDOM: body, update };
        },
        toHTML: (b, c) => `<div data-notice="${escapeHTML(b.attrs?.tone ?? 'tip')}" data-title="${escapeHTML(b.attrs?.title ?? '')}">${c.children(b)}</div>`,
        parseHTML: [{ tag: 'div', match: (el) => el.attrs['data-notice'] !== undefined, getAttrs: (el) => ({ tone: el.attrs['data-notice'], title: el.attrs['data-title'] }), priority: 60 }],
        toMarkdown: (b, c) => `> **${b.attrs?.title ?? 'Note'}**\n>\n` + c.children(b).split('\n').map((l) => (l ? '> ' + l : '>')).join('\n'),
      },
    ],
    commands: {
      insertNotice: (editor, attrs = {}) => editor.exec('insertBlocks', [editor.schema.create('notice', attrs)]),
    },
    slashItems: [
      {
        id: 'notice',
        title: 'Notice',
        description: 'Custom callout with a title',
        keywords: ['callout', 'tip', 'warning', 'admonition', 'alert'],
        icon: 'callout',
        group: 'custom',
        order: 26,
        run: (editor) => void editor.exec('insertNotice'),
      },
    ],
    toolbar: [{ id: 'notice', group: 'insert', label: 'Notice', icon: 'callout', command: 'insertNotice', order: 73 }],
  };
}

/** A document that uses both custom nodes. Every example can open it. */
export const SHARED_DOCUMENT = {
  format: 'zeditor',
  version: 1,
  extensions: { 'issue-ref': 1, 'notice-callout': 1 },
  blocks: [
    { id: 'sh1', type: 'heading', attrs: { level: 2 }, content: [{ text: 'Release notes' }] },
    { id: 'sp1', type: 'paragraph', content: [{ text: 'Fixed in this release: ' }, { atom: 'issue', attrs: { key: 'ZED-102', title: 'Add table column resize', status: 'done' } }, { text: ' and ' }, { atom: 'issue', attrs: { key: 'ZED-142', title: 'Collaboration reconnect', status: 'done' } }, { text: '. Type # to reference another issue.' }] },
    { id: 'sn1', type: 'notice', attrs: { tone: 'warning', title: 'Before upgrading' }, children: [{ id: 'sn1p', type: 'paragraph', content: [{ text: 'Back up your documents. ' }, { text: 'This text is editable', marks: { bold: true } }, { text: ' in every integration.' }] }] },
  ],
};
