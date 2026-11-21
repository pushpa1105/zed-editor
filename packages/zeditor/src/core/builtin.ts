/**
 * Built-in extensions: node and mark specs with their HTML / Markdown serializers, commands,
 * shortcuts, input rules, toolbar and slash-menu contributions. No DOM code lives here;
 * renderers are in view/renderers.ts.
 */
import { Attrs, Block, BlockJSON, InlineAtom, contentText, newId } from './model';
import { HtmlEl, MarkSpec, NodeSpec, safeUrl } from './schema';
import type { Editor } from './editor';
import { Extension, InputRule, SlashItem, ToolbarItem } from './extension';
import { coreCommands, isBlockActive, isMarkActive, markValue, selectedBlocks, focusBlock, isoAncestor } from './commands';
import { tableCommands, tableContext, findCell, cellInDirection } from './table';
import { blockSel, firstTextBlock, isCollapsed, lastTextBlock, textSel, topMost } from './selection';
import { esc, textContent, findAll } from './html';

/* ------------------------------------------------------------------ validators */

export const v = {
  enumOf:
    <T extends string>(...vals: T[]) =>
    (x: any): T | undefined =>
      vals.includes(x) ? x : undefined,
  int:
    (min: number, max: number) =>
    (x: any): number | undefined => {
      const n = Math.round(Number(x));
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : undefined;
    },
  str:
    (max = 2000) =>
    (x: any): string | undefined =>
      typeof x === 'string' ? x.slice(0, max) : typeof x === 'number' ? String(x) : undefined,
  bool: (x: any): boolean | undefined => (typeof x === 'boolean' ? x : x === 'true' ? true : x === 'false' ? false : undefined),
  color: (x: any): string | undefined =>
    typeof x === 'string' && /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/a-z-]+\)|[a-z]{3,24}|var\(--[\w-]+\))$/i.test(x.trim()) ? x.trim() : undefined,
  url: (x: any): string | undefined => safeUrl(x) || undefined,
  imageUrl: (x: any): string | undefined => safeUrl(x, { image: true }) || undefined,
};

const align = { validate: v.enumOf('center', 'right', 'justify') };
const indentAttr = { validate: (x: any) => v.int(0, 8)(x) || undefined };

/* ------------------------------------------------------------------ base */

const paragraph: NodeSpec = {
  type: 'paragraph',
  kind: 'text',
  children: true,
  attrs: { align, indent: indentAttr },
  toHTML: (b, c) => `<p${c.id(b)}${c.style(b)}>${c.inline(b)}</p>`,
  toMarkdown: (b, c) => c.inline(b),
};
const heading: NodeSpec = {
  type: 'heading',
  kind: 'text',
  attrs: { level: { default: 1, validate: v.int(1, 6) }, align, indent: indentAttr },
  parseHTML: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: 'h' + level, getAttrs: () => ({ level }) })),
  toHTML: (b, c) => `<h${b.attrs.level}${c.id(b)}${c.style(b)}>${c.inline(b)}</h${b.attrs.level}>`,
  toMarkdown: (b, c) => '#'.repeat(b.attrs.level) + ' ' + c.inline(b).replace(/\n/g, ' '),
};
const quote: NodeSpec = {
  type: 'quote',
  kind: 'text',
  attrs: { align },
  parseHTML: [{ tag: 'blockquote' }],
  toHTML: (b, c) => `<blockquote${c.id(b)}${c.style(b)}>${c.inline(b)}</blockquote>`,
  toMarkdown: (b, c) =>
    c
      .inline(b)
      .split('\n')
      .map((l: string) => '> ' + l)
      .join('\n'),
};
const divider: NodeSpec = {
  type: 'divider',
  kind: 'atom',
  parseHTML: [{ tag: 'hr', match: (el) => !/always/.test(el.style['page-break-after'] ?? el.style['break-after'] ?? '') }],
  toHTML: (b, c) => `<hr${c.id(b)}>`,
  toMarkdown: () => '---',
  toText: () => '---',
};
const unknown: NodeSpec = { type: 'unknown', kind: 'atom', attrs: { raw: {} } };

const simpleMark = (type: string, tag: string, md: [string, string] | null, rules: MarkSpec['parseHTML'], rank: number, extra: Partial<MarkSpec> = {}): MarkSpec => ({
  type,
  rank,
  parseHTML: rules,
  toHTML: () => [`<${tag}>`, `</${tag}>`],
  toMarkdown: md ? () => md : () => [`<${tag}>`, `</${tag}>`],
  ...extra,
});
const insideLink = (el: HtmlEl): boolean => {
  for (let p = el.parent; p; p = p.parent) if (p.tag === 'a') return true;
  return false;
};
const styleHas = (prop: string, re: RegExp) => (el: HtmlEl) => re.test(el.style[prop] ?? '');
const boldWeight = (el: HtmlEl) => {
  const w = el.style['font-weight'];
  if (!w) return false;
  return w === 'bold' || w === 'bolder' || parseInt(w, 10) >= 600;
};

export const FONT_FAMILIES = ['serif', 'sans-serif', 'monospace', 'cursive'] as const;
export const FONT_SIZES = ['12px', '14px', '16px', '18px', '24px', '32px'] as const;

const marks: MarkSpec[] = [
  {
    type: 'link',
    rank: 10,
    inclusive: false,
    attrs: { href: { validate: v.url }, title: { default: '', validate: v.str(300) } },
    parseHTML: [{ tag: 'a', getAttrs: (el) => (safeUrl(el.attrs.href) ? { href: el.attrs.href, title: el.attrs.title ?? '' } : false) }],
    toHTML: (x) => [`<a href="${esc(safeUrl(x.href))}"${x.title ? ` title="${esc(x.title)}"` : ''} rel="noopener noreferrer nofollow">`, '</a>'],
    toMarkdown: (x) => ['[', `](${String(x.href).replace(/[()\s]/g, encodeURIComponent)}${x.title ? ` "${String(x.title).replace(/"/g, '\\"')}"` : ''})`],
  },
  simpleMark(
    'bold',
    'strong',
    ['**', '**'],
    [
      { tag: 'strong' },
      { tag: 'b', match: (el) => !/^(normal|[1-4]00)$/.test(el.style['font-weight'] ?? '') },
      { tag: '*', match: (el) => el.tag !== 'b' && el.tag !== 'strong' && !/^h[1-6]$/.test(el.tag) && el.tag !== 'th' && boldWeight(el) },
    ],
    20,
  ),
  simpleMark('italic', 'em', ['*', '*'], [{ tag: 'em' }, { tag: 'i', match: (el) => el.style['font-style'] !== 'normal' }, { tag: '*', match: (el) => el.tag !== 'i' && el.tag !== 'em' && styleHas('font-style', /italic|oblique/)(el) }], 21),
  simpleMark('underline', 'u', null, [{ tag: 'u' }, { tag: 'ins' }, { tag: '*', match: (el) => el.tag !== 'a' && el.tag !== 'u' && (styleHas('text-decoration', /underline/)(el) || styleHas('text-decoration-line', /underline/)(el)) }], 22),
  simpleMark('strike', 's', ['~~', '~~'], [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { tag: '*', match: (el) => styleHas('text-decoration', /line-through/)(el) || styleHas('text-decoration-line', /line-through/)(el) }], 23),
  simpleMark('sub', 'sub', null, [{ tag: 'sub' }, { tag: '*', match: (el) => el.tag !== 'sub' && styleHas('vertical-align', /^sub$/)(el) }], 24, { excludes: ['sup'] }),
  simpleMark('sup', 'sup', null, [{ tag: 'sup' }, { tag: '*', match: (el) => el.tag !== 'sup' && styleHas('vertical-align', /^super$/)(el) }], 25, { excludes: ['sub'] }),
  {
    type: 'color',
    rank: 30,
    attrs: { color: { validate: v.color } },
    parseHTML: [
      {
        tag: '*',
        getAttrs: (el) => {
          const c = el.style.color;
          // ignore default black text produced by Word / Docs
          if (!c || el.tag === 'a' || insideLink(el) || /^(#000(000)?|black|rgb\(0,\s*0,\s*0\)|windowtext|inherit|initial)$/i.test(c) || !v.color(c)) return false;
          return { color: c };
        },
      },
    ],
    toHTML: (x) => [`<span style="color:${esc(x.color)}">`, '</span>'],
    toMarkdown: () => ['', ''],
  },
  {
    type: 'highlight',
    rank: 31,
    attrs: { color: { default: '', validate: (x) => (x === '' ? '' : v.color(x)) } },
    parseHTML: [
      { tag: 'mark', getAttrs: (el) => ({ color: v.color(el.style['background-color'] ?? el.style.background ?? '') ?? '' }) },
      {
        tag: '*',
        getAttrs: (el) => {
          if (el.tag === 'mark' || el.tag === 'td' || el.tag === 'th' || el.tag === 'tr' || el.tag === 'table' || el.tag === 'body' || el.tag === 'div' || el.tag === 'p' || el.tag === 'li') return false;
          const c = el.style['background-color'] ?? (/^(#|rgb|hsl|[a-z]+$)/i.test(el.style.background ?? '') ? el.style.background : '');
          if (!c || /^(transparent|inherit|initial|none|#fff(fff)?|white|rgb\(255,\s*255,\s*255\))$/i.test(c) || !v.color(c)) return false;
          return { color: c };
        },
      },
    ],
    toHTML: (x) => [x.color ? `<mark style="background-color:${esc(x.color)}">` : '<mark>', '</mark>'],
    toMarkdown: () => ['<mark>', '</mark>'],
  },
  simpleMark('code', 'code', ['`', '`'], [{ tag: 'code' }, { tag: 'kbd' }, { tag: 'tt' }, { tag: 'samp' }], 40),
  {
    // only re-imported from our own export: pasted documents set a size on every span
    type: 'fontSize',
    rank: 32,
    attrs: { size: { validate: (x) => (typeof x === 'string' && /^\d{1,3}(\.\d)?(px|pt|em|rem|%)$/.test(x) ? x : undefined) } },
    parseHTML: [{ tag: 'span', match: (el) => !!el.attrs['data-font-size'], getAttrs: (el) => ({ size: el.attrs['data-font-size'] }), priority: 60 }],
    toHTML: (x) => [`<span data-font-size="${esc(x.size)}" style="font-size:${esc(x.size)}">`, '</span>'],
    toMarkdown: () => ['', ''],
  },
  {
    type: 'fontFamily',
    rank: 33,
    attrs: { family: { validate: v.enumOf(...FONT_FAMILIES) } },
    parseHTML: [{ tag: 'span', match: (el) => !!el.attrs['data-font-family'], getAttrs: (el) => ({ family: el.attrs['data-font-family'] }), priority: 60 }],
    toHTML: (x) => [`<span data-font-family="${esc(x.family)}" style="font-family:${esc(x.family)}">`, '</span>'],
    toMarkdown: () => ['', ''],
  },
];

function linkPrompt(editor: Editor): boolean {
  editor.emit('ui:link');
  return true;
}

const blockTypeOptions = [
  { value: 'paragraph', label: 'block.paragraph' },
  { value: 'heading:1', label: 'block.h1' },
  { value: 'heading:2', label: 'block.h2' },
  { value: 'heading:3', label: 'block.h3' },
  { value: 'quote', label: 'block.quote' },
];

const markButton = (id: string, icon: string, shortcut: string | undefined, order: number, floating = true): ToolbarItem => ({
  id,
  group: 'marks',
  label: 'mark.' + id,
  icon,
  command: 'toggleMark',
  args: [id],
  active: (e) => isMarkActive(e, id),
  shortcut,
  floating,
  order,
});

const textSlash = (id: string, title: string, type: string, attrs: Attrs | undefined, keywords: string[], icon: string, order: number, description?: string): SlashItem => ({
  id,
  title,
  description,
  keywords,
  icon,
  group: 'basic',
  order,
  run: (editor, { blockId }) => {
    editor.exec('setBlockType', type, attrs, [blockId]);
  },
});

function moveSel(editor: Editor, dir: -1 | 1, extend: boolean): boolean {
  const sel = editor.selection;
  if (!sel || sel.type !== 'block') return false;
  const { doc } = editor;
  const blocks = topMost(doc, sel.ids);
  if (!blocks.length) return false;
  const anchor = doc.get(sel.anchor ?? '') ?? blocks[0];
  const edge = extend ? (blocks[0] === anchor || blocks[0].id === anchor.id ? blocks[blocks.length - 1] : blocks[0]) : dir < 0 ? blocks[0] : blocks[blocks.length - 1];
  const next = dir < 0 ? edge.prevSibling ?? (edge.parent !== doc.root && !editor.schema.node(edge.parent!.type)?.isolating ? edge.parent : null) : edge.nextSibling;
  if (!next || next === doc.root) return true;
  if (!extend) {
    editor.setSelection(blockSel([next.id]), { scroll: true });
    return true;
  }
  if (next.parent !== anchor.parent) return true;
  const a = anchor.index;
  const b = next.index;
  const ids = anchor.parent!.children!.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id);
  editor.setSelection({ type: 'block', ids, anchor: anchor.id }, { scroll: true });
  return true;
}

export const baseExtension: Extension = {
  name: 'base',
  nodes: [paragraph, heading, quote, divider, unknown],
  marks,
  commands: {
    ...coreCommands,
    /** Remove all content (one undoable edit), leaving a single empty paragraph. */
    clearDocument: (editor) => {
      if (editor.readOnly) return false;
      const para = editor.schema.create('paragraph');
      return editor.update((tr) => {
        tr.removeAt('root', 0, editor.doc.blocks.length);
        tr.insert('root', 0, [para]);
        tr.select(textSel(para.id, 0));
      });
    },
    /** Escape in block mode: turn a text selection into a block selection. */
    selectCurrentBlock: (editor) => {
      const b = focusBlock(editor);
      if (!b) return false;
      editor.setSelection(blockSel([b.id]));
      return true;
    },
  },
  keymap: {
    'Mod-b': (e) => e.exec('toggleMark', 'bold'),
    'Mod-i': (e) => e.exec('toggleMark', 'italic'),
    'Mod-u': (e) => e.exec('toggleMark', 'underline'),
    'Mod-Shift-x': (e) => e.exec('toggleMark', 'strike'),
    'Mod-Shift-s': (e) => e.exec('toggleMark', 'strike'),
    'Mod-e': (e) => e.exec('toggleMark', 'code'),
    'Mod-.': (e) => e.exec('toggleMark', 'sup'),
    'Mod-,': (e) => e.exec('toggleMark', 'sub'),
    'Mod-Shift-h': (e) => e.exec('toggleMark', 'highlight', { color: '' }),
    'Mod-k': linkPrompt,
    'Mod-z': 'undo',
    'Mod-y': 'redo',
    'Mod-Shift-z': 'redo',
    'Mod-a': 'selectAll',
    'Mod-\\': 'clearFormatting',
    'Mod-Alt-0': (e) => e.exec('setBlockType', 'paragraph'),
    'Mod-Alt-1': (e) => e.exec('setBlockType', 'heading', { level: 1 }),
    'Mod-Alt-2': (e) => e.exec('setBlockType', 'heading', { level: 2 }),
    'Mod-Alt-3': (e) => e.exec('setBlockType', 'heading', { level: 3 }),
    'Mod-Alt-4': (e) => e.exec('setBlockType', 'heading', { level: 4 }),
    'Mod-Alt-5': (e) => e.exec('setBlockType', 'heading', { level: 5 }),
    'Mod-Alt-6': (e) => e.exec('setBlockType', 'heading', { level: 6 }),
    'Mod-Shift-b': (e) => e.exec('toggleBlockType', 'quote'),
    'Mod-Shift-l': (e) => e.exec('setAlign', 'left'),
    'Mod-Shift-e': (e) => e.exec('setAlign', 'center'),
    'Mod-Shift-r': (e) => e.exec('setAlign', 'right'),
    'Mod-Shift-j': (e) => e.exec('setAlign', 'justify'),
    Tab: (e) => {
      e.exec('indent');
      return true; // keep focus in the editor even when nothing can be indented
    },
    'Shift-Tab': (e) => {
      e.exec('outdent');
      return true;
    },
    'Mod-]': 'indent',
    'Mod-[': 'outdent',
    'Alt-ArrowUp': 'moveBlocksUp',
    'Alt-ArrowDown': 'moveBlocksDown',
    'Mod-Shift-ArrowUp': 'moveBlocksUp',
    'Mod-Shift-ArrowDown': 'moveBlocksDown',
    'Mod-Shift-d': 'duplicateBlocks',
    Escape: (e) => (e.selection?.type === 'text' && e.mode === 'block' ? e.exec('selectCurrentBlock') : false),
    ArrowUp: (e) => moveSel(e, -1, false),
    ArrowDown: (e) => moveSel(e, 1, false),
    'Shift-ArrowUp': (e) => moveSel(e, -1, true),
    'Shift-ArrowDown': (e) => moveSel(e, 1, true),
    Enter: (e) => {
      const sel = e.selection;
      if (sel?.type !== 'block') return false;
      const b = sel.ids.length === 1 ? e.doc.get(sel.ids[0]) : null;
      if (b && e.schema.isText(b)) {
        e.setSelection(textSel(b.id, b.length));
        return true;
      }
      return e.exec('splitBlock');
    },
  },
  toolbar: [
    { id: 'undo', group: 'history', label: 'undo', icon: 'undo', command: 'undo', enabled: (e) => e.canUndo(), shortcut: 'Mod-z', order: 1 },
    { id: 'redo', group: 'history', label: 'redo', icon: 'redo', command: 'redo', enabled: (e) => e.canRedo(), shortcut: 'Mod-y', order: 2 },
    {
      id: 'blockType',
      group: 'block',
      label: 'blockType',
      type: 'select',
      options: blockTypeOptions,
      value: (e) => {
        const b = selectedBlocks(e)[0] ?? focusBlock(e);
        const f = focusBlock(e) ?? b;
        if (!f) return 'paragraph';
        return f.type === 'heading' ? 'heading:' + f.attrs.level : f.type;
      },
      run: (e, value: string) => {
        const [type, level] = String(value).split(':');
        e.exec('setBlockType', type, level ? { level: +level } : undefined);
      },
      order: 10,
    },
    markButton('bold', 'bold', 'Mod-b', 20),
    markButton('italic', 'italic', 'Mod-i', 21),
    markButton('underline', 'underline', 'Mod-u', 22),
    markButton('strike', 'strike', 'Mod-Shift-x', 23),
    markButton('code', 'code', 'Mod-e', 24),
    { id: 'link', group: 'marks', label: 'link', icon: 'link', run: (e) => void linkPrompt(e), active: (e) => isMarkActive(e, 'link') || markValue(e, 'link') !== undefined, shortcut: 'Mod-k', floating: true, order: 25 },
    markButton('sub', 'sub', 'Mod-,', 26, false),
    markButton('sup', 'sup', 'Mod-.', 27, false),
    {
      id: 'fontSize',
      group: 'font',
      label: 'fontSize',
      type: 'select',
      options: [{ value: '', label: 'font.default' }, ...FONT_SIZES.map((s) => ({ value: s, label: s }))],
      value: (e) => markValue(e, 'fontSize')?.size ?? '',
      run: (e, size: string) => void (size ? e.exec('setMark', 'fontSize', { size }) : e.exec('unsetMark', 'fontSize')),
      order: 28,
    },
    {
      id: 'fontFamily',
      group: 'font',
      label: 'fontFamily',
      type: 'select',
      options: [{ value: '', label: 'font.default' }, ...FONT_FAMILIES.map((s) => ({ value: s, label: s }))],
      value: (e) => markValue(e, 'fontFamily')?.family ?? '',
      run: (e, family: string) => void (family ? e.exec('setMark', 'fontFamily', { family }) : e.exec('unsetMark', 'fontFamily')),
      order: 29,
    },
    { id: 'color', group: 'color', label: 'textColor', icon: 'color', type: 'color', value: (e) => markValue(e, 'color')?.color ?? '', run: (e, c: string) => void (c ? e.exec('setMark', 'color', { color: c }) : e.exec('unsetMark', 'color')), order: 30 },
    { id: 'highlight', group: 'color', label: 'highlight', icon: 'highlight', type: 'color', value: (e) => markValue(e, 'highlight')?.color ?? '', run: (e, c: string) => void (c ? e.exec('setMark', 'highlight', { color: c }) : e.exec('unsetMark', 'highlight')), floating: true, order: 31 },
    ...(['left', 'center', 'right', 'justify'] as const).map(
      (a, i): ToolbarItem => ({
        id: 'align-' + a,
        group: 'align',
        label: 'align.' + a,
        icon: 'align-' + a,
        command: 'setAlign',
        args: [a],
        active: (e) => {
          const b = focusBlock(e);
          return !!b && (b.attrs.align ?? 'left') === a;
        },
        order: 50 + i,
      }),
    ),
    { id: 'outdent', group: 'indent', label: 'outdent', icon: 'outdent', command: 'outdent', shortcut: 'Shift-Tab', order: 60 },
    { id: 'indent', group: 'indent', label: 'indent', icon: 'indent', command: 'indent', shortcut: 'Tab', order: 61 },
    { id: 'divider', group: 'insert', label: 'block.divider', icon: 'divider', command: 'insertBlock', args: ['divider'], order: 72 },
    { id: 'clear', group: 'clear', label: 'clearFormatting', icon: 'clear', command: 'clearFormatting', shortcut: 'Mod-\\', order: 90 },
  ],
  slashItems: [
    textSlash('paragraph', 'Text', 'paragraph', undefined, ['paragraph', 'plain', 'p'], 'text', 1, 'Plain text'),
    textSlash('h1', 'Heading 1', 'heading', { level: 1 }, ['h1', 'title', 'heading'], 'h1', 2, 'Large section heading'),
    textSlash('h2', 'Heading 2', 'heading', { level: 2 }, ['h2', 'subtitle', 'heading'], 'h2', 3, 'Medium section heading'),
    textSlash('h3', 'Heading 3', 'heading', { level: 3 }, ['h3', 'heading'], 'h3', 4, 'Small section heading'),
    textSlash('quote', 'Quote', 'quote', undefined, ['blockquote', 'citation'], 'quote', 20, 'Capture a quote'),
    { id: 'divider', title: 'Divider', description: 'Horizontal rule', keywords: ['hr', 'line', 'rule', 'separator'], icon: 'divider', group: 'basic', order: 21, run: (e, { blockId }) => void e.exec('insertBlock', 'divider', undefined, { replace: emptyId(e, blockId), after: blockId }) },
  ],
  blockActions: [
    { id: 'duplicate', label: 'action.duplicate', icon: 'copy', run: (e, ids) => void e.exec('duplicateBlocks', ids) },
    { id: 'delete', label: 'action.delete', icon: 'trash', run: (e, ids) => void e.exec('deleteBlocks', ids) },
    { id: 'moveUp', label: 'action.moveUp', icon: 'up', run: (e, ids) => void e.exec('moveBlocksUp', ids) },
    { id: 'moveDown', label: 'action.moveDown', icon: 'down', run: (e, ids) => void e.exec('moveBlocksDown', ids) },
    { id: 'copyLink', label: 'action.copyLink', icon: 'link', run: (e, ids) => void e.emit('ui:copyBlockLink', { id: ids[0] }) },
  ],
  labels: {
    undo: 'Undo',
    redo: 'Redo',
    blockType: 'Block type',
    'block.paragraph': 'Paragraph',
    'block.h1': 'Heading 1',
    'block.h2': 'Heading 2',
    'block.h3': 'Heading 3',
    'block.quote': 'Quote',
    'block.code': 'Code block',
    'block.divider': 'Divider',
    'mark.bold': 'Bold',
    'mark.italic': 'Italic',
    'mark.underline': 'Underline',
    'mark.strike': 'Strikethrough',
    'mark.code': 'Inline code',
    'mark.sub': 'Subscript',
    'mark.sup': 'Superscript',
    link: 'Link',
    'link.placeholder': 'Paste or type a link',
    'link.apply': 'Apply',
    'link.remove': 'Remove link',
    'link.open': 'Open link',
    textColor: 'Text color',
    fontSize: 'Font size',
    fontFamily: 'Font family',
    'font.default': 'Default',
    highlight: 'Highlight',
    'color.none': 'Default',
    'align.left': 'Align left',
    'align.center': 'Align center',
    'align.right': 'Align right',
    'align.justify': 'Justify',
    indent: 'Indent',
    outdent: 'Outdent',
    clearFormatting: 'Clear formatting',
    'action.duplicate': 'Duplicate',
    'action.delete': 'Delete',
    'action.moveUp': 'Move up',
    'action.moveDown': 'Move down',
    'action.copyLink': 'Copy link to block',
    'action.turnInto': 'Turn into',
    'handle.add': 'Add block below',
    'handle.drag': 'Drag to move, click for actions',
    toolbar: 'Formatting',
    'floating.toolbar': 'Selection formatting',
    'slash.empty': 'No results',
    'slash.label': 'Insert block',
    placeholder: 'Write something…',
    'placeholder.block': "Type '/' for commands",
    'unknown.block': 'Unsupported content',
    'unknown.hint': 'This block needs an extension that is not installed. Its data is preserved.',
    editor: 'Rich text editor',
    'status.words': 'words',
    'status.chars': 'characters',
    'save.saved': 'Saved',
    'save.saving': 'Saving…',
    'save.dirty': 'Unsaved changes',
    'save.error': 'Save failed',
    'save.offline': 'Offline — changes kept locally',
    'mode.classic': 'Classic',
    'mode.block': 'Blocks',
  },
};

/** id of the block if it is an empty paragraph (so inserts replace it), else undefined */
export function emptyId(editor: Editor, id: string): string | undefined {
  const b = editor.doc.get(id);
  return b && b.type === 'paragraph' && b.length === 0 && !b.children ? id : undefined;
}
const insertSlash = (id: string, title: string, description: string, keywords: string[], icon: string, order: number, make: (e: Editor) => BlockJSON, group = 'basic'): SlashItem => ({
  id,
  title,
  description,
  keywords,
  icon,
  group,
  order,
  run: (e, { blockId }) => void e.exec('insertBlocks', [make(e)], { replace: emptyId(e, blockId), after: blockId }),
});

/* ------------------------------------------------------------------ lists */

const list: NodeSpec = {
  type: 'list',
  kind: 'text',
  children: true,
  continues: true,
  attrs: { kind: { default: 'bullet', validate: v.enumOf('bullet', 'ordered', 'check') }, checked: { validate: v.bool }, start: { validate: v.int(0, 100000) } },
  // HTML import/export of lists is structural and handled in html.ts
  toMarkdown: (b, c) => {
    const marker = b.attrs.kind === 'ordered' ? `${c.number(b)}. ` : b.attrs.kind === 'check' ? `- [${b.attrs.checked ? 'x' : ' '}] ` : '- ';
    return marker + c.inline(b).replace(/\n/g, '\n' + ' '.repeat(marker.length));
  },
};
const listButton = (kind: string, icon: string, order: number, shortcut: string): ToolbarItem => ({
  id: 'list-' + kind,
  group: 'lists',
  label: 'list.' + kind,
  icon,
  command: 'toggleBlockType',
  args: ['list', { kind }],
  active: (e) => isBlockActive(e, 'list', { kind }),
  shortcut,
  order,
});
export const listExtension: Extension = {
  name: 'lists',
  requires: ['base'],
  nodes: [list],
  keymap: {
    'Mod-Shift-7': (e) => e.exec('toggleBlockType', 'list', { kind: 'ordered' }),
    'Mod-Shift-8': (e) => e.exec('toggleBlockType', 'list', { kind: 'bullet' }),
    'Mod-Shift-9': (e) => e.exec('toggleBlockType', 'list', { kind: 'check' }),
    'Mod-Enter': 'toggleCheck',
  },
  toolbar: [listButton('bullet', 'list-bullet', 40, 'Mod-Shift-8'), listButton('ordered', 'list-ordered', 41, 'Mod-Shift-7'), listButton('check', 'list-check', 42, 'Mod-Shift-9')],
  slashItems: [
    textSlash('bullet', 'Bulleted list', 'list', { kind: 'bullet' }, ['ul', 'unordered', 'bullets'], 'list-bullet', 10, 'Simple bulleted list'),
    textSlash('ordered', 'Numbered list', 'list', { kind: 'ordered' }, ['ol', 'ordered', 'numbers'], 'list-ordered', 11, 'List with numbering'),
    textSlash('check', 'To-do list', 'list', { kind: 'check', checked: false }, ['todo', 'task', 'checkbox', 'checklist'], 'list-check', 12, 'Track tasks with checkboxes'),
  ],
  labels: { 'list.bullet': 'Bulleted list', 'list.ordered': 'Numbered list', 'list.check': 'Checklist', 'check.toggle': 'Toggle task' },
};

/* ------------------------------------------------------------------ code */

const LANGS = ['plain', 'javascript', 'typescript', 'html', 'css', 'json', 'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'ruby', 'php', 'sql', 'bash', 'yaml', 'markdown', 'xml', 'swift', 'kotlin'];
const code: NodeSpec = {
  type: 'code',
  kind: 'text',
  code: true,
  marks: false,
  attrs: { language: { default: 'plain', validate: (x) => (typeof x === 'string' && /^[\w+#-]{1,30}$/.test(x) ? x.toLowerCase() : undefined) } },
  parseHTML: [
    {
      tag: 'pre',
      getAttrs: (el) => {
        const codeEl = findAll(el, (e) => e.tag === 'code')[0];
        const cls = [...el.classes, ...(codeEl?.classes ?? [])].find((c) => /^(language|lang)-/.test(c));
        return { language: el.attrs['data-language'] ?? codeEl?.attrs['data-language'] ?? cls?.replace(/^(language|lang)-/, '') ?? 'plain' };
      },
    },
  ],
  toHTML: (b, c) => `<pre${c.id(b)} data-language="${esc(b.attrs.language ?? 'plain')}"><code class="language-${esc(b.attrs.language ?? 'plain')}">${esc(contentText(b.content, ''))}</code></pre>`,
  toMarkdown: (b) => {
    const text = contentText(b.content, '');
    const fence = '`'.repeat(Math.max(3, (text.match(/`+/g) ?? []).reduce((m: number, s: string) => Math.max(m, s.length + 1), 3)));
    return `${fence}${b.attrs.language && b.attrs.language !== 'plain' ? b.attrs.language : ''}\n${text}\n${fence}`;
  },
};
export const codeExtension: Extension = {
  name: 'code',
  requires: ['base'],
  priority: 10,
  nodes: [code],
  keymap: {
    Tab: (e) => {
      const b = focusBlock(e);
      if (!b || b.type !== 'code') return false;
      return codeIndent(e, b, 1);
    },
    'Shift-Tab': (e) => {
      const b = focusBlock(e);
      if (!b || b.type !== 'code') return false;
      return codeIndent(e, b, -1);
    },
    'Mod-Alt-c': (e) => e.exec('toggleBlockType', 'code'),
  },
  toolbar: [{ id: 'codeBlock', group: 'block2', label: 'block.code', icon: 'code-block', command: 'toggleBlockType', args: ['code'], active: (e) => isBlockActive(e, 'code'), order: 43 }],
  slashItems: [textSlash('code', 'Code block', 'code', undefined, ['pre', 'snippet', 'codeblock'], 'code-block', 22, 'Code with syntax highlighting')],
  labels: { 'code.language': 'Language', 'code.copy': 'Copy code', 'code.copied': 'Copied' },
  setup: (editor) => {
    editor.storage.codeLanguages = LANGS;
  },
};
/** Indent or outdent the selected lines of a code block by two spaces. */
function codeIndent(editor: Editor, b: Block, dir: 1 | -1): boolean {
  const sel = editor.selection;
  if (!sel || sel.type !== 'text' || sel.anchor.id !== b.id || sel.focus.id !== b.id) return false;
  const text = b.text;
  const from = Math.min(sel.anchor.offset, sel.focus.offset);
  const to = Math.max(sel.anchor.offset, sel.focus.offset);
  if (from === to && dir > 0) return editor.exec('insertText', '  ', { rules: false });
  const start = text.lastIndexOf('\n', from - 1) + 1;
  const lines = text.slice(start, to).split('\n');
  let delta0 = 0;
  let total = 0;
  const out = lines.map((l, i) => {
    let d = 0;
    let r = l;
    if (dir > 0) {
      r = '  ' + l;
      d = 2;
    } else {
      const m = /^( {1,2}|\t)/.exec(l);
      if (m) {
        r = l.slice(m[0].length);
        d = -m[0].length;
      }
    }
    if (i === 0) delta0 = d;
    total += d;
    return r;
  });
  if (!total) return true;
  const backward = sel.anchor.offset > sel.focus.offset;
  return editor.update((tr) => {
    tr.replaceText(b.id, start, to, out.join('\n'));
    const nf = Math.max(start, from + delta0);
    const nt = to + total;
    tr.select(backward ? textSel(b.id, nt, b.id, nf) : textSel(b.id, nf, b.id, nt));
  });
}

/* ------------------------------------------------------------------ tables */

const tableNodes: NodeSpec[] = [
  {
    type: 'table',
    kind: 'container',
    children: ['table_row'],
    attrs: { colWidths: { validate: (x) => (Array.isArray(x) ? x.slice(0, 50).map((n) => Math.max(0, Math.min(2000, Math.round(+n) || 0))) : undefined) } },
    toHTML: (b, c) => {
      const w: number[] = b.attrs?.colWidths ?? [];
      const cg = w.some((x) => x > 0) ? `<colgroup>${w.map((x) => (x > 0 ? `<col style="width:${x}px">` : '<col>')).join('')}</colgroup>` : '';
      return `<table${c.id(b)}>${cg}<tbody>${c.children(b)}</tbody></table>`;
    },
  },
  { type: 'table_row', kind: 'container', children: ['table_cell'], parents: ['table'], allowEmpty: true, toHTML: (b, c) => `<tr>${c.children(b)}</tr>` },
  {
    type: 'table_cell',
    kind: 'container',
    isolating: true,
    parents: ['table_row'],
    attrs: { colspan: { validate: (x) => (v.int(1, 50)(x)! > 1 ? v.int(1, 50)(x) : undefined) }, rowspan: { validate: (x) => (v.int(1, 500)(x)! > 1 ? v.int(1, 500)(x) : undefined) }, header: { validate: (x) => v.bool(x) || undefined }, background: { validate: v.color } },
    toHTML: (b, c) => {
      const a = b.attrs ?? {};
      const tag = a.header ? 'th' : 'td';
      const kids = b.children ?? [];
      // single plain paragraph: emit bare inline content for clean spreadsheet interop
      const inner = kids.length === 1 && kids[0].type === 'paragraph' && !kids[0].attrs?.align && !kids[0].children?.length ? c.inline(kids[0]) : c.children(b);
      return `<${tag}${a.colspan > 1 ? ` colspan="${a.colspan | 0}"` : ''}${a.rowspan > 1 ? ` rowspan="${a.rowspan | 0}"` : ''}${a.background ? ` style="background-color:${esc(a.background)}"` : ''}>${inner}</${tag}>`;
    },
  },
];

function cellArrow(editor: Editor, dir: 1 | -1): boolean {
  // Tab-like vertical movement when the caret is in an edge block of a cell is left to the
  // browser; this only handles moving a *cell selection*.
  const sel = editor.selection;
  if (!sel || sel.type !== 'cell') return false;
  const cell = editor.doc.get(sel.focus);
  if (!cell) return false;
  const next = cellInDirection(editor, cell, dir, 0);
  const t = next && firstTextBlock(editor.doc, editor.schema, next);
  if (t) editor.setSelection(textSel(t.id, 0));
  return true;
}
function extendCells(editor: Editor, dr: number, dc: number): boolean {
  const sel = editor.selection;
  if (!sel) return false;
  if (sel.type === 'cell') {
    const cell = editor.doc.get(sel.focus);
    const next = cell && cellInDirection(editor, cell, dr, dc);
    if (next) editor.setSelection({ ...sel, focus: next.id });
    return true;
  }
  if (sel.type !== 'text') return false;
  const b = editor.doc.get(sel.focus.id);
  const cell = findCell(editor, b);
  if (!cell || !b) return false;
  // only start a cell selection when the caret is at the edge of the cell in that direction
  const first = firstTextBlock(editor.doc, editor.schema, cell);
  const last = lastTextBlock(editor.doc, editor.schema, cell);
  const atStart = b === first && sel.focus.offset === 0;
  const atEnd = b === last && sel.focus.offset === b.length;
  if ((dc > 0 && !atEnd) || (dc < 0 && !atStart) || (dr > 0 && b !== last) || (dr < 0 && b !== first)) return false;
  const next = cellInDirection(editor, cell, dr, dc);
  const ctx = tableContext(editor);
  if (!next || !ctx) return false;
  editor.setSelection({ type: 'cell', table: ctx.table.id, anchor: cell.id, focus: next.id });
  return true;
}

export const tableExtension: Extension = {
  name: 'tables',
  requires: ['base'],
  priority: 20,
  nodes: tableNodes,
  commands: tableCommands,
  keymap: {
    Tab: (e) => (tableContext(e) && e.selection?.type !== 'block' ? e.exec('nextCell', 1) : false),
    'Shift-Tab': (e) => (tableContext(e) && e.selection?.type !== 'block' ? e.exec('nextCell', -1) : false),
    'Shift-ArrowRight': (e) => extendCells(e, 0, 1),
    'Shift-ArrowLeft': (e) => extendCells(e, 0, -1),
    'Shift-ArrowDown': (e) => extendCells(e, 1, 0),
    'Shift-ArrowUp': (e) => extendCells(e, -1, 0),
    ArrowDown: (e) => cellArrow(e, 1),
    ArrowUp: (e) => cellArrow(e, -1),
    ArrowLeft: (e) => (e.selection?.type === 'cell' ? cellArrow(e, -1) : false),
    ArrowRight: (e) => (e.selection?.type === 'cell' ? cellArrow(e, 1) : false),
    Escape: (e) => {
      if (e.selection?.type !== 'cell') return false;
      const t = firstTextBlock(e.doc, e.schema, e.doc.get(e.selection.focus)!);
      if (t) e.setSelection(textSel(t.id, 0));
      return true;
    },
  },
  toolbar: [{ id: 'table', group: 'insert', label: 'table.insert', icon: 'table', command: 'insertTable', args: [3, 3], order: 70 }],
  slashItems: [{ id: 'table', title: 'Table', description: 'Rows and columns', keywords: ['grid', 'spreadsheet', 'rows', 'columns'], icon: 'table', group: 'basic', order: 23, run: (e, { blockId }) => {
    const empty = emptyId(e, blockId);
    e.exec('insertTable', 3, 3);
    void empty;
  } }],
  labels: {
    'table.insert': 'Insert table',
    'table.addRowBefore': 'Insert row above',
    'table.addRowAfter': 'Insert row below',
    'table.addColBefore': 'Insert column left',
    'table.addColAfter': 'Insert column right',
    'table.deleteRow': 'Delete row',
    'table.deleteCol': 'Delete column',
    'table.delete': 'Delete table',
    'table.merge': 'Merge cells',
    'table.split': 'Split cell',
    'table.headerRow': 'Toggle header row',
    'table.headerCol': 'Toggle header column',
    'table.tools': 'Table tools',
    'table.resize': 'Resize column',
  },
};

/* ------------------------------------------------------------------ layout: callout, toggle, columns */

const TONES = ['note', 'info', 'success', 'warning', 'danger'] as const;
const layoutNodes: NodeSpec[] = [
  {
    type: 'callout',
    kind: 'container',
    attrs: { tone: { default: 'note', validate: v.enumOf(...TONES) }, icon: { default: '💡', validate: v.str(16) } },
    parseHTML: [{ tag: 'aside' }, { tag: 'div', match: (el) => el.attrs['data-callout'] !== undefined, getAttrs: (el) => ({ tone: el.attrs['data-callout'] || 'note', icon: el.attrs['data-icon'] }), priority: 60 }],
    toHTML: (b, c) => `<div${c.id(b)} data-callout="${esc(b.attrs?.tone ?? 'note')}" data-icon="${esc(b.attrs?.icon ?? '')}">${c.children(b)}</div>`,
    toMarkdown: (b, c) => {
      const tone = { note: 'NOTE', info: 'TIP', success: 'TIP', warning: 'WARNING', danger: 'CAUTION' }[(b.attrs?.tone as string) ?? 'note'] ?? 'NOTE';
      return (`[!${tone}]\n` + c.children(b)).split('\n').map((l: string) => (l ? '> ' + l : '>')).join('\n');
    },
  },
  {
    type: 'toggle',
    kind: 'text',
    children: true,
    attrs: { open: { default: true, validate: v.bool } },
    toHTML: (b, c) => `<details${c.id(b)}${b.attrs?.open !== false ? ' open' : ''}><summary>${c.inline(b)}</summary>${c.children(b)}</details>`,
    toMarkdown: (b, c) => `<details${b.attrs?.open !== false ? ' open' : ''}>\n<summary>${c.inline(b)}</summary>\n\n${c.children(b)}\n\n</details>`,
    ...({ htmlNestsChildren: true } as any),
  },
  {
    type: 'columns',
    kind: 'container',
    children: ['column'],
    parseHTML: [{ tag: 'div', match: (el) => el.attrs['data-columns'] !== undefined, priority: 60 }],
    toHTML: (b, c) => `<div${c.id(b)} data-columns="" style="display:flex;gap:1em">${c.children(b)}</div>`,
    toMarkdown: (b, c) => c.children(b),
  },
  {
    type: 'column',
    kind: 'container',
    isolating: true,
    parents: ['columns'],
    attrs: { width: { validate: (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.min(100, Math.max(5, n)) : undefined; } } },
    parseHTML: [{ tag: 'div', match: (el) => el.attrs['data-column'] !== undefined, getAttrs: (el) => ({ width: parseFloat(el.attrs['data-width'] ?? '') || undefined }), priority: 60 }],
    toHTML: (b, c) => `<div data-column=""${b.attrs?.width ? ` data-width="${+b.attrs.width}"` : ''} style="flex:${b.attrs?.width ? +b.attrs.width : 1} 1 0">${c.children(b)}</div>`,
    toMarkdown: (b, c) => c.children(b),
  },
];

export const layoutExtension: Extension = {
  name: 'layout',
  requires: ['base'],
  nodes: layoutNodes,
  commands: {
    insertColumns: (editor, count = 2) => {
      const s = editor.schema;
      const cols: BlockJSON[] = [];
      for (let i = 0; i < Math.max(2, Math.min(6, count | 0)); i++) cols.push(s.create('column'));
      return editor.exec('insertBlocks', [s.create('columns', undefined, undefined, cols)]);
    },
    toggleOpen: (editor, id?: string) => {
      const b = id ? editor.doc.get(id) : focusBlock(editor);
      if (!b || b.type !== 'toggle') return false;
      // collapsing is view state stored in the document so it persists; allowed in read-only too
      const open = b.attrs.open === false;
      const sel = editor.selection;
      return editor.update((tr) => {
        tr.setAttrs(b.id, { open });
        // never leave the caret inside hidden children
        if (!open && sel?.type === 'text') {
          const f = editor.doc.get(sel.focus.id);
          if (f && editor.doc.isAncestor(b, f)) tr.select(textSel(b.id, b.length));
        }
      });
    },
  },
  keymap: { 'Mod-Alt-o': (e) => e.exec('toggleOpen') },
  toolbar: [],
  slashItems: [
    {
      id: 'callout',
      title: 'Callout',
      description: 'Highlighted note',
      keywords: ['note', 'info', 'warning', 'tip', 'admonition'],
      icon: 'callout',
      group: 'basic',
      order: 24,
      run: (e, { blockId }) => {
        const b = e.doc.get(blockId);
        if (b && b.length > 0 && e.exec('wrapIn', 'callout', undefined, [blockId])) return;
        e.exec('insertBlocks', [e.schema.create('callout')], { replace: emptyId(e, blockId), after: blockId });
      },
    },
    textSlash('toggle', 'Toggle', 'toggle', { open: true }, ['collapse', 'collapsible', 'details', 'accordion'], 'toggle', 25, 'Collapsible section'),
    { id: 'columns2', title: '2 columns', description: 'Side by side content', keywords: ['layout', 'columns', 'grid'], icon: 'columns', group: 'layout', order: 30, run: (e) => void e.exec('insertColumns', 2) },
    { id: 'columns3', title: '3 columns', description: 'Three columns', keywords: ['layout', 'columns', 'grid'], icon: 'columns', group: 'layout', order: 31, run: (e) => void e.exec('insertColumns', 3) },
  ],
  labels: { 'toggle.toggle': 'Expand or collapse', 'callout.tone': 'Callout style', 'tone.note': 'Note', 'tone.info': 'Info', 'tone.success': 'Success', 'tone.warning': 'Warning', 'tone.danger': 'Danger' },
};

/* ------------------------------------------------------------------ media: image, file, embed */

export interface EmbedProvider {
  name: string;
  /** return an https iframe URL for a pasted/entered URL, or null */
  match: (url: string) => string | null;
  aspect?: number;
}
export const defaultEmbedProviders: EmbedProvider[] = [
  {
    name: 'youtube',
    match: (u) => {
      const m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,20})/.exec(u);
      return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
    },
    aspect: 16 / 9,
  },
  {
    name: 'vimeo',
    match: (u) => {
      const m = /^https?:\/\/(?:www\.)?vimeo\.com\/(\d{4,12})/.exec(u);
      return m ? `https://player.vimeo.com/video/${m[1]}` : null;
    },
    aspect: 16 / 9,
  },
];
/** Resolve an embed URL through the configured providers. */
export function resolveEmbed(editor: Editor, url: string): { provider: string; src: string; aspect?: number } | null {
  const safe = safeUrl(url);
  if (!/^https?:\/\//i.test(safe)) return null;
  for (const p of (editor.storage.embedProviders as EmbedProvider[]) ?? defaultEmbedProviders) {
    let src: string | null = null;
    try {
      src = p.match(safe);
    } catch {
      src = null;
    }
    if (src && /^https:\/\//i.test(src)) return { provider: p.name, src, aspect: p.aspect };
  }
  return null;
}

const mediaNodes: NodeSpec[] = [
  {
    type: 'image',
    kind: 'atom',
    attrs: {
      src: { default: '', validate: v.imageUrl },
      alt: { default: '', validate: v.str(1000) },
      caption: { default: '', validate: v.str(2000) },
      width: { validate: (x) => v.int(24, 4000)(x) },
      align,
      /** set while an upload is running; cleared when it finishes */
      uploadId: { validate: v.str(64) },
      status: { validate: v.enumOf('uploading', 'error') },
    },
    parseHTML: [
      {
        tag: 'figure',
        priority: 60,
        getAttrs: (el) => {
          const img = findAll(el, (e) => e.tag === 'img')[0];
          if (!img || !safeUrl(img.attrs.src, { image: true })) return false;
          const cap = findAll(el, (e) => e.tag === 'figcaption')[0];
          return { src: img.attrs.src, alt: img.attrs.alt ?? '', caption: cap ? textContent(cap).trim() : '', width: parseInt(img.attrs.width ?? '', 10) || undefined };
        },
      },
      { tag: 'img', getAttrs: (el) => (safeUrl(el.attrs.src, { image: true }) ? { src: el.attrs.src, alt: el.attrs.alt ?? '', width: parseInt(el.attrs.width ?? el.style.width ?? '', 10) || undefined } : false) },
    ],
    toHTML: (b, c) => {
      const a = b.attrs ?? {};
      const src = /^blob:/i.test(a.src ?? '') ? '' : safeUrl(a.src, { image: true });
      const img = `<img src="${esc(src)}" alt="${esc(a.alt ?? '')}"${a.width ? ` width="${a.width | 0}"` : ''}>`;
      return `<figure${c.id(b)}${c.style(b)}>${img}${a.caption ? `<figcaption>${esc(a.caption)}</figcaption>` : ''}</figure>`;
    },
    toMarkdown: (b) => `![${String(b.attrs?.alt ?? '').replace(/[[\]]/g, '')}](${String(b.attrs?.src ?? '').replace(/[()\s]/g, encodeURIComponent)}${b.attrs?.caption ? ` "${String(b.attrs.caption).replace(/"/g, '\\"')}"` : ''})`,
    toText: (b) => b.attrs?.alt || b.attrs?.caption || '',
  },
  {
    type: 'file',
    kind: 'atom',
    attrs: { url: { default: '', validate: v.url }, name: { default: 'file', validate: v.str(300) }, size: { validate: v.int(0, Number.MAX_SAFE_INTEGER) }, mime: { validate: v.str(120) }, uploadId: { validate: v.str(64) }, status: { validate: v.enumOf('uploading', 'error') } },
    parseHTML: [{ tag: 'a', match: (el) => el.attrs['data-file'] !== undefined, getAttrs: (el) => (safeUrl(el.attrs.href) ? { url: el.attrs.href, name: el.attrs['data-name'] || textContent(el), size: parseInt(el.attrs['data-size'] ?? '', 10) || undefined, mime: el.attrs['data-mime'] } : false), priority: 70 }],
    toHTML: (b, c) => `<p${c.id(b)}><a data-file="" href="${esc(safeUrl(b.attrs?.url))}" data-name="${esc(b.attrs?.name ?? '')}"${b.attrs?.size ? ` data-size="${b.attrs.size | 0}"` : ''}${b.attrs?.mime ? ` data-mime="${esc(b.attrs.mime)}"` : ''} download>${esc(b.attrs?.name ?? 'file')}</a></p>`,
    toMarkdown: (b) => `[${String(b.attrs?.name ?? 'file').replace(/[[\]]/g, '')}](${b.attrs?.url ?? ''})`,
    toText: (b) => b.attrs?.name ?? '',
  },
  {
    type: 'embed',
    kind: 'atom',
    attrs: { url: { default: '', validate: v.url }, title: { default: '', validate: v.str(300) }, height: { validate: v.int(80, 2000) } },
    parseHTML: [{ tag: 'div', match: (el) => el.attrs['data-embed'] !== undefined, getAttrs: (el) => (safeUrl(el.attrs['data-url']) ? { url: el.attrs['data-url'], title: el.attrs['data-title'] ?? '' } : false), priority: 60 }],
    toHTML: (b, c) => `<div${c.id(b)} data-embed="" data-url="${esc(safeUrl(b.attrs?.url))}" data-title="${esc(b.attrs?.title ?? '')}"><a href="${esc(safeUrl(b.attrs?.url))}" rel="noopener noreferrer nofollow">${esc(b.attrs?.title || b.attrs?.url || '')}</a></div>`,
    toMarkdown: (b) => `[${b.attrs?.title || b.attrs?.url || ''}](${b.attrs?.url ?? ''})`,
    toText: (b) => b.attrs?.url ?? '',
  },
];

export const mediaExtension: Extension = {
  name: 'media',
  requires: ['base'],
  nodes: mediaNodes,
  commands: {
    insertImage: (editor, attrs: Attrs) => editor.exec('insertBlock', 'image', attrs),
    insertEmbed: (editor, url: string) => {
      if (!/^https?:\/\//i.test(safeUrl(url))) return false;
      return editor.exec('insertBlock', 'embed', { url });
    },
    insertFile: (editor, attrs: Attrs) => editor.exec('insertBlock', 'file', attrs),
  },
  toolbar: [{ id: 'image', group: 'insert', label: 'image.insert', icon: 'image', run: (e) => void e.emit('ui:image'), order: 71 }],
  slashItems: [
    { id: 'image', title: 'Image', description: 'Upload or embed an image', keywords: ['picture', 'photo', 'img', 'upload'], icon: 'image', group: 'media', order: 40, run: (e, { blockId }) => void e.emit('ui:image', { blockId }) },
    { id: 'file', title: 'File', description: 'Attach a file', keywords: ['attachment', 'upload', 'document'], icon: 'file', group: 'media', order: 41, run: (e, { blockId }) => void e.emit('ui:file', { blockId }) },
    { id: 'embed', title: 'Embed', description: 'YouTube, Vimeo or a link card', keywords: ['video', 'youtube', 'vimeo', 'iframe', 'link'], icon: 'embed', group: 'media', order: 42, run: (e, { blockId }) => void e.emit('ui:embed', { blockId }) },
  ],
  labels: {
    'image.insert': 'Insert image',
    'image.alt': 'Alt text',
    'image.caption': 'Caption',
    'image.captionPlaceholder': 'Add a caption',
    'image.altPrompt': 'Describe this image for people who cannot see it',
    'image.resize': 'Resize image',
    'image.uploading': 'Uploading…',
    'image.failed': 'Upload failed',
    'upload.retry': 'Retry',
    'upload.cancel': 'Cancel',
    'embed.prompt': 'Paste a link to embed',
    'embed.open': 'Open',
    'file.download': 'Download',
  },
  setup: (editor) => {
    editor.storage.embedProviders ??= defaultEmbedProviders;
  },
};

/* ------------------------------------------------------------------ equations */

const texAttr = { default: '', validate: v.str(5000) };
export const equationExtension: Extension = {
  name: 'equation',
  requires: ['base'],
  nodes: [
    {
      type: 'equation',
      kind: 'atom',
      attrs: { tex: texAttr },
      parseHTML: [{ tag: 'div', match: (el) => el.attrs['data-equation'] !== undefined, getAttrs: (el) => ({ tex: el.attrs['data-equation'] }), priority: 60 }],
      toHTML: (b, c) => `<div${c.id(b)} data-equation="${esc(b.attrs?.tex ?? '')}">${esc(b.attrs?.tex ?? '')}</div>`,
      toMarkdown: (b) => `$$\n${b.attrs?.tex ?? ''}\n$$`,
      toText: (b) => b.attrs?.tex ?? '',
    },
    {
      type: 'math',
      kind: 'inline',
      attrs: { tex: texAttr },
      parseHTML: [{ tag: 'span', match: (el) => el.attrs['data-math'] !== undefined, getAttrs: (el) => ({ tex: el.attrs['data-math'] }), priority: 60 }],
      toHTML: (a: InlineAtom) => `<span data-math="${esc(a.attrs?.tex ?? '')}">${esc(a.attrs?.tex ?? '')}</span>`,
      toMarkdown: (a: InlineAtom) => `$${a.attrs?.tex ?? ''}$`,
      toText: (a: InlineAtom) => a.attrs?.tex ?? '',
    },
  ],
  commands: {
    insertEquation: (editor, tex = '', inline = false) => (inline ? editor.exec('insertInline', { atom: 'math', attrs: { tex } }) : editor.exec('insertBlock', 'equation', { tex })),
  },
  slashItems: [
    { id: 'equation', title: 'Equation', description: 'Block LaTeX equation', keywords: ['math', 'latex', 'tex', 'formula'], icon: 'equation', group: 'media', order: 43, run: (e, { blockId }) => void e.exec('insertBlocks', [e.schema.create('equation', { tex: '' })], { replace: emptyId(e, blockId), after: blockId }) },
    { id: 'math', title: 'Inline equation', description: 'LaTeX inside text', keywords: ['math', 'latex', 'tex', 'formula'], icon: 'equation', group: 'media', order: 44, run: (e) => void e.exec('insertEquation', 'x^2', true) },
  ],
  labels: { 'equation.edit': 'Edit equation (LaTeX)', 'equation.empty': 'Empty equation' },
};

/* ------------------------------------------------------------------ mentions, hashtags, emoji */

export const mentionNode: NodeSpec = {
  type: 'mention',
  kind: 'inline',
  attrs: { id: { default: '', validate: v.str(200) }, label: { default: '', validate: v.str(200) } },
  parseHTML: [{ tag: 'span', match: (el) => el.attrs['data-mention'] !== undefined, getAttrs: (el) => ({ id: el.attrs['data-mention'], label: el.attrs['data-label'] ?? textContent(el).replace(/^@/, '') }), priority: 60 }],
  toHTML: (a: InlineAtom) => `<span data-mention="${esc(a.attrs?.id ?? '')}" data-label="${esc(a.attrs?.label ?? '')}">@${esc(a.attrs?.label ?? '')}</span>`,
  toMarkdown: (a: InlineAtom) => '@' + (a.attrs?.label ?? ''),
  toText: (a: InlineAtom) => '@' + (a.attrs?.label ?? ''),
};

const HASHTAG = /(^|[^\p{L}\p{N}_#&/])(#[\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)/gu;
/** Recompute `hashtag` marks for the blocks a transaction touched. */
function syncHashtags(tr: any): void {
  const editor: Editor = tr.editor;
  for (const id of [...tr.dirty]) {
    const b = editor.doc.get(id);
    if (!b || !b.content || editor.schema.node(b.type)?.code) continue;
    const text = b.text;
    const want: [number, number][] = [];
    if (text.indexOf('#') >= 0) {
      HASHTAG.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = HASHTAG.exec(text))) want.push([m.index + m[1].length, m.index + m[0].length]);
    }
    // current ranges
    const have: [number, number][] = [];
    let pos = 0;
    for (const c of b.content) {
      const len = 'atom' in c ? 1 : c.text.length;
      if (c.marks?.hashtag) {
        const last = have[have.length - 1];
        if (last && last[1] === pos) last[1] = pos + len;
        else have.push([pos, pos + len]);
      }
      pos += len;
    }
    if (JSON.stringify(want) === JSON.stringify(have)) continue;
    const sel = tr.selection;
    const strip = (from: number, to: number, on: boolean) => {
      const parts = b.content!.length ? sliceMarks(b, from, to, on) : [];
      if (parts.length) tr.step({ t: 'text', id: b.id, from, to, insert: parts });
    };
    for (const [f, t] of have) strip(f, t, false);
    for (const [f, t] of want) strip(f, t, true);
    if (sel !== undefined) tr.select(sel);
  }
}
function sliceMarks(b: Block, from: number, to: number, on: boolean) {
  let pos = 0;
  const out: any[] = [];
  for (const c of b.content!) {
    const len = 'atom' in c ? 1 : c.text.length;
    const s = Math.max(from, pos);
    const e = Math.min(to, pos + len);
    if (e > s) {
      const marks = { ...(c.marks ?? {}) };
      if (on) marks.hashtag = true;
      else delete marks.hashtag;
      const m = Object.keys(marks).length ? marks : undefined;
      if ('atom' in c) out.push(m ? { atom: c.atom, attrs: c.attrs, marks: m } : { atom: c.atom, attrs: c.attrs });
      else out.push(m ? { text: c.text.slice(s - pos, e - pos), marks: m } : { text: c.text.slice(s - pos, e - pos) });
    }
    pos += len;
  }
  return out;
}

export const hashtagExtension: Extension = {
  name: 'hashtag',
  requires: ['base'],
  marks: [{ type: 'hashtag', rank: 45, inclusive: false, toHTML: () => ['<span data-hashtag="">', '</span>'], toMarkdown: () => ['', ''], parseHTML: [{ tag: 'span', match: (el) => el.attrs['data-hashtag'] !== undefined }] }],
  setup: (editor) => {
    editor.appenders.push(syncHashtags);
    return () => {
      const i = editor.appenders.indexOf(syncHashtags);
      if (i >= 0) editor.appenders.splice(i, 1);
    };
  },
};

export const EMOJI: [string, string, string][] = [
  ['😀', 'grinning', 'smile happy'], ['😂', 'joy', 'laugh tears lol'], ['🙂', 'slight_smile', 'smile'], ['😉', 'wink', ''], ['😍', 'heart_eyes', 'love'], ['🤔', 'thinking', 'hmm'], ['😎', 'sunglasses', 'cool'],
  ['😢', 'cry', 'sad tear'], ['😡', 'rage', 'angry mad'], ['😴', 'sleeping', 'zzz'], ['🥳', 'partying', 'party celebrate'], ['😅', 'sweat_smile', 'phew'], ['🙃', 'upside_down', ''], ['🤯', 'mind_blown', 'exploding'],
  ['👍', 'thumbsup', '+1 like yes'], ['👎', 'thumbsdown', '-1 dislike no'], ['👏', 'clap', 'applause'], ['🙏', 'pray', 'thanks please'], ['💪', 'muscle', 'strong'], ['👀', 'eyes', 'look'], ['🤝', 'handshake', 'deal'],
  ['❤️', 'heart', 'love'], ['🔥', 'fire', 'hot lit'], ['✨', 'sparkles', 'shiny new'], ['🎉', 'tada', 'party celebrate'], ['🚀', 'rocket', 'launch ship'], ['⭐', 'star', 'favorite'], ['💡', 'bulb', 'idea'],
  ['✅', 'check', 'done yes'], ['❌', 'x', 'no cross'], ['⚠️', 'warning', 'caution'], ['❓', 'question', ''], ['❗', 'exclamation', 'important'], ['📌', 'pin', 'pushpin'], ['📎', 'paperclip', 'attach'],
  ['📝', 'memo', 'note write'], ['📅', 'calendar', 'date'], ['⏰', 'alarm', 'clock time'], ['🐛', 'bug', 'insect'], ['🔒', 'lock', 'secure'], ['🔑', 'key', ''], ['💬', 'speech', 'comment chat'],
  ['👨‍👩‍👧‍👦', 'family', 'people'], ['🏳️‍🌈', 'rainbow_flag', 'pride'], ['🇳🇵', 'nepal', 'flag'], ['🇺🇸', 'us', 'flag usa'], ['👋🏽', 'wave', 'hello hi bye'], ['☕', 'coffee', 'tea'], ['🍕', 'pizza', 'food'],
];
export const emojiExtension: Extension = {
  name: 'emoji',
  requires: ['base'],
  typeahead: [
    {
      name: 'emoji',
      trigger: ':',
      search: (q, { editor }) => {
        const list: [string, string, string][] = editor.storage.emojiList ?? EMOJI;
        const s = q.toLowerCase();
        if (!s) return [];
        return list
          .filter(([, name, kw]) => name.includes(s) || kw.includes(s))
          .slice(0, 12)
          .map(([ch, name]) => ({ id: name, label: `${ch}  :${name}:`, char: ch }));
      },
      select: (editor, item, range) => {
        editor.update((tr) => {
          tr.replaceText(range.id, range.from, range.to, item.char);
          tr.select(textSel(range.id, range.from + item.char.length));
        });
      },
    },
  ],
  inputRules: [
    {
      name: 'emoji-shortcode',
      match: /(?:^|\s):([a-z0-9_+-]{2,30}):$/,
      run: (editor, m, { block, to }) => {
        const list: [string, string, string][] = editor.storage.emojiList ?? EMOJI;
        const hit = list.find(([, name]) => name === m[1]);
        if (!hit) return false;
        const from = to - m[1].length - 2;
        return editor.update((tr) => {
          tr.replaceText(block.id, from, to, hit[0]);
          tr.select(textSel(block.id, from + hit[0].length));
        });
      },
    },
  ],
};

/* ------------------------------------------------------------------ markdown typing shortcuts & autolink */

const blockRule = (match: RegExp, type: string, attrs?: (m: RegExpExecArray) => Attrs | undefined): InputRule => ({
  name: 'md-' + type,
  match,
  run: (editor, m, { block, from, to }) => {
    if (from !== 0 || !editor.schema.node(type)) return false;
    if (block.type !== 'paragraph' && !(block.type === 'list' && type === 'list') && !(block.type === 'heading' && type === 'heading')) return false;
    if (!editor.schema.canContain(block.parent!, type)) return false;
    return editor.update((tr) => {
      tr.replaceText(block.id, 0, to);
      tr.setType(block.id, type, attrs?.(m));
      tr.select(textSel(block.id, 0));
    });
  },
});
const markRule = (match: RegExp, type: string): InputRule => ({
  name: 'md-mark-' + type,
  match,
  run: (editor, m, { block, to }) => {
    if (!editor.schema.marks.get(type)) return false;
    const full = m[1];
    const inner = m[2];
    const start = to - full.length;
    const open = (full.length - inner.length) / 2;
    return editor.update((tr) => {
      // remove the closing marker, then the opening one, then mark the remaining text
      tr.replaceText(block.id, to - open, to);
      tr.replaceText(block.id, start, start + open);
      const b = editor.doc.get(block.id)!;
      const parts = sliceMarks2(b, start, start + inner.length, type);
      tr.step({ t: 'text', id: block.id, from: start, to: start + inner.length, insert: parts });
      tr.select(textSel(block.id, start + inner.length));
      tr.setMeta('storedMarks', {});
    });
  },
});
function sliceMarks2(b: Block, from: number, to: number, type: string) {
  let pos = 0;
  const out: any[] = [];
  for (const c of b.content!) {
    const len = 'atom' in c ? 1 : c.text.length;
    const s = Math.max(from, pos);
    const e = Math.min(to, pos + len);
    if (e > s) {
      const marks = { ...(c.marks ?? {}), [type]: true };
      if ('atom' in c) out.push({ atom: c.atom, attrs: c.attrs, marks });
      else out.push({ text: c.text.slice(s - pos, e - pos), marks });
    }
    pos += len;
  }
  return out;
}

export const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/i;
const URL_END = new RegExp('(?:^|[\\s(])(' + URL_RE.source + ')(\\s)$', 'i');
const EMAIL_END = /(?:^|[\s(])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)(\s)$/;

export const markdownShortcutsExtension: Extension = {
  name: 'markdownShortcuts',
  requires: ['base'],
  inputRules: [
    blockRule(/^(#{1,6})\s$/, 'heading', (m) => ({ level: m[1].length })),
    blockRule(/^>\s$/, 'quote'),
    blockRule(/^[-*+]\s$/, 'list', () => ({ kind: 'bullet' })),
    blockRule(/^(\d{1,5})[.)]\s$/, 'list', (m) => ({ kind: 'ordered', start: +m[1] === 1 ? undefined : +m[1] })),
    blockRule(/^(?:[-*+]\s)?\[( |x|X)?\]\s$/, 'list', (m) => ({ kind: 'check', checked: /x/i.test(m[1] ?? '') })),
    blockRule(/^```([\w+#-]*)\s$/, 'code', (m) => ({ language: m[1] || 'plain' })),
    {
      name: 'md-divider',
      match: /^(?:---|\*\*\*|___)$/,
      run: (editor, _m, { block, from }) => {
        if (from !== 0 || block.type !== 'paragraph' || !editor.schema.canContain(block.parent!, 'divider')) return false;
        return editor.update((tr) => {
          tr.replaceText(block.id, 0, block.length);
          tr.insertBefore(block.id, [editor.schema.create('divider')]);
          tr.select(textSel(block.id, 0));
        });
      },
    },
    markRule(/(?:^|[\s( ])(\*\*([^*\s](?:[^*]*[^*\s])?)\*\*)$/, 'bold'),
    markRule(/(?:^|[\s( ])(__([^_\s](?:[^_]*[^_\s])?)__)$/, 'bold'),
    markRule(/(?:^|[\s( ])(~~([^~\s](?:[^~]*[^~\s])?)~~)$/, 'strike'),
    markRule(/(?:^|[\s( ])(`([^`]+)`)$/, 'code'),
    markRule(/(?:^|[\s( ])(\*([^*\s](?:[^*]*[^*\s])?)\*)$/, 'italic'),
    markRule(/(?:^|[\s( ])(_([^_\s](?:[^_]*[^_\s])?)_)$/, 'italic'),
  ],
};

export const autolinkExtension: Extension = {
  name: 'autolink',
  requires: ['base'],
  inputRules: [
    {
      name: 'autolink',
      match: URL_END,
      run: (editor, m, { block, to }) => linkify(editor, block, to - m[2].length - m[1].length, to - m[2].length, /^www\./i.test(m[1]) ? 'https://' + m[1] : m[1]),
    },
    { name: 'autolink-email', match: EMAIL_END, run: (editor, m, { block, to }) => linkify(editor, block, to - m[2].length - m[1].length, to - m[2].length, 'mailto:' + m[1]) },
  ],
};
function linkify(editor: Editor, block: Block, from: number, to: number, href: string): boolean {
  const value = editor.schema.parseMarks({ link: { href } })?.link;
  if (!value) return false;
  const b = editor.doc.get(block.id)!;
  let pos = 0;
  const out: any[] = [];
  for (const c of b.content!) {
    const len = 'atom' in c ? 1 : c.text.length;
    const s = Math.max(from, pos);
    const e = Math.min(to, pos + len);
    if (e > s) {
      if (c.marks?.link || c.marks?.code) return false;
      const marks = { ...(c.marks ?? {}), link: value };
      if ('atom' in c) out.push({ atom: c.atom, attrs: c.attrs, marks });
      else out.push({ text: c.text.slice(s - pos, e - pos), marks });
    }
    pos += len;
  }
  const sel = editor.selection;
  return editor.update((tr) => {
    tr.step({ t: 'text', id: block.id, from, to, insert: out });
    tr.select(sel);
  });
}

/* ------------------------------------------------------------------ pages */

const pageNodes: NodeSpec[] = [
  {
    type: 'page',
    kind: 'container',
    isolating: true,
    parents: ['doc'],
    attrs: { title: { default: '', validate: v.str(200) } },
    parseHTML: [{ tag: 'section', match: (el) => el.attrs['data-page'] !== undefined, getAttrs: (el) => ({ title: el.attrs['data-title'] ?? el.attrs['data-page'] ?? '' }), priority: 70 }],
    toHTML: (b, c) => `<section${c.id(b)} data-page="" data-title="${esc(b.attrs?.title ?? '')}">${c.children(b)}</section>`,
    toMarkdown: (b, c) => `<!-- page: ${String(b.attrs?.title ?? '').replace(/--/g, '—')} -->\n\n${c.children(b)}`,
  },
  {
    type: 'page_break',
    kind: 'atom',
    parseHTML: [
      { tag: 'div', match: (el) => el.attrs['data-page-break'] !== undefined, priority: 70 },
      { tag: '*', match: (el) => (el.tag === 'br' || el.tag === 'hr' || el.tag === 'div') && /always|page/.test(el.style['page-break-before'] ?? el.style['page-break-after'] ?? el.style['break-before'] ?? el.style['break-after'] ?? ''), priority: 80 },
    ],
    toHTML: (b, c) => `<div${c.id(b)} data-page-break="" style="break-after:page;page-break-after:always"></div>`,
    toMarkdown: () => '<!-- pagebreak -->',
    toText: () => '\f',
  },
];

/** Page blocks of the document, in order (empty when the document is not paged). */
export function getPages(editor: Editor): Block[] {
  return editor.doc.blocks.filter((b) => b.type === 'page');
}
export function pageOf(editor: Editor, b: Block | null | undefined): Block | null {
  return editor.doc.closest(b, (x) => x.type === 'page');
}
export function activePage(editor: Editor): Block | null {
  const pages = getPages(editor);
  if (!pages.length) return null;
  return pages.find((p) => p.id === editor.storage.pages?.active) ?? pages[0];
}
function setActive(editor: Editor, id: string | null): void {
  const st = (editor.storage.pages ??= { active: null });
  if (st.active === id) return;
  st.active = id;
  editor.emit('page', { id });
  editor.emit('update');
}
function nextTitle(editor: Editor): string {
  const used = new Set(getPages(editor).map((p) => p.attrs.title));
  for (let i = getPages(editor).length + 1; ; i++) if (!used.has(`Page ${i}`)) return `Page ${i}`;
}

export const pagesExtension: Extension = {
  name: 'pages',
  requires: ['base'],
  nodes: pageNodes,
  commands: {
    /** Turn the document into a paged document: all content moves into "Page 1". */
    enablePages: (editor) => {
      if (editor.readOnly || getPages(editor).length) return false;
      const sel = editor.selection;
      return editor.update((tr) => {
        const json = editor.doc.blocks.map((b) => b.toJSON());
        tr.removeAt('root', 0, json.length);
        const page = editor.schema.create('page', { title: 'Page 1' }, undefined, json);
        tr.insert('root', 0, [page]);
        tr.select(sel);
      });
    },
    /** Merge all pages back into one continuous document. */
    disablePages: (editor) => {
      const pages = getPages(editor);
      if (editor.readOnly || !pages.length) return false;
      const sel = editor.selection;
      return editor.update((tr) => {
        const all: BlockJSON[] = [];
        for (const p of pages) all.push(...p.children!.map((c) => c.toJSON()));
        tr.removeAt('root', 0, editor.doc.blocks.length);
        tr.insert('root', 0, all);
        tr.select(sel);
      });
    },
    addPage: (editor, title?: string, afterId?: string) => {
      if (editor.readOnly) return false;
      if (!getPages(editor).length && !editor.exec('enablePages')) return false;
      const after = (afterId && editor.doc.get(afterId)) || activePage(editor) || getPages(editor).slice(-1)[0];
      const page = editor.schema.create('page', { title: title ?? nextTitle(editor) });
      const ok = editor.update((tr) => {
        tr.insert('root', after ? after.index + 1 : editor.doc.blocks.length, [page]);
        const t = firstTextBlock(editor.doc, editor.schema, editor.doc.get(page.id)!);
        if (t) tr.select(textSel(t.id, 0));
        tr.scroll();
      });
      if (ok) setActive(editor, page.id);
      return ok;
    },
    removePage: (editor, id?: string) => {
      const pages = getPages(editor);
      const page = (id && editor.doc.get(id)) || activePage(editor);
      if (editor.readOnly || !page || page.type !== 'page' || pages.length < 2) return false;
      const idx = pages.indexOf(page);
      const next = pages[idx + 1] ?? pages[idx - 1];
      const ok = editor.update((tr) => {
        tr.remove(page.id);
        const t = firstTextBlock(editor.doc, editor.schema, next);
        if (t) tr.select(textSel(t.id, 0));
      });
      if (ok) setActive(editor, next.id);
      return ok;
    },
    renamePage: (editor, id: string, title: string) => {
      const page = editor.doc.get(id);
      if (editor.readOnly || !page || page.type !== 'page') return false;
      return editor.update((tr) => void tr.setAttrs(id, { title: String(title).slice(0, 200) }));
    },
    movePage: (editor, id: string, index: number) => {
      const page = editor.doc.get(id);
      if (editor.readOnly || !page || page.type !== 'page') return false;
      const target = Math.max(0, Math.min(index, editor.doc.blocks.length - 1));
      if (target === page.index) return false;
      let moved = false;
      const ok = editor.update((tr) => {
        moved = tr.move([id], 'root', target > page.index ? target + 1 : target);
      });
      return ok && moved;
    },
    duplicatePage: (editor, id?: string) => {
      const page = (id && editor.doc.get(id)) || activePage(editor);
      if (editor.readOnly || !page || page.type !== 'page') return false;
      const ok = editor.exec('duplicateBlocks', [page.id]);
      if (ok) {
        const copy = page.nextSibling;
        if (copy) {
          editor.update((tr) => void tr.setAttrs(copy.id, { title: (page.attrs.title || 'Page') + ' (copy)' }));
          setActive(editor, copy.id);
          const t = firstTextBlock(editor.doc, editor.schema, copy);
          if (t) editor.setSelection(textSel(t.id, 0));
        }
      }
      return ok;
    },
    /** Show a page (view state, not a document change). Moves the caret into it. */
    setActivePage: (editor, id: string) => {
      const page = editor.doc.get(id);
      if (!page || page.type !== 'page') return false;
      setActive(editor, id);
      const cur = editor.selection?.type === 'text' ? editor.doc.get(editor.selection.focus.id) : null;
      if (pageOf(editor, cur) !== page) {
        const t = firstTextBlock(editor.doc, editor.schema, page);
        if (t) editor.setSelection(textSel(t.id, 0));
      }
      return true;
    },
    /**
     * Word-style page break at the caret. In a paged document the current page is split in
     * two at the current block; otherwise a `page_break` block is inserted.
     */
    insertPageBreak: (editor) => {
      if (editor.readOnly) return false;
      const b = focusBlock(editor) ?? selectedBlocks(editor)[0];
      if (!b) return false;
      const page = pageOf(editor, b);
      if (!page) return editor.exec('insertBlock', 'page_break');
      // top-level child of the page that holds the caret
      let top = b;
      while (top.parent && top.parent !== page) top = top.parent;
      const idx = top.index;
      const rest = page.children!.slice(idx + 1);
      const np = editor.schema.create('page', { title: nextTitle(editor) }, undefined, rest.length ? rest.map((x) => x.toJSON()) : undefined);
      const ok = editor.update((tr) => {
        if (rest.length) tr.removeAt(page.id, idx + 1, rest.length);
        tr.insert('root', page.index + 1, [np]);
        const t = firstTextBlock(editor.doc, editor.schema, editor.doc.get(np.id)!);
        if (t) tr.select(textSel(t.id, 0));
        tr.scroll();
      });
      if (ok) setActive(editor, np.id);
      return ok;
    },
  },
  keymap: {
    'Mod-Shift-Enter': 'insertPageBreak',
    'Mod-Alt-PageDown': (e) => {
      const pages = getPages(e);
      const cur = activePage(e);
      const next = cur && pages[pages.indexOf(cur) + 1];
      return next ? e.exec('setActivePage', next.id) : false;
    },
    'Mod-Alt-PageUp': (e) => {
      const pages = getPages(e);
      const cur = activePage(e);
      const prev = cur && pages[pages.indexOf(cur) - 1];
      return prev ? e.exec('setActivePage', prev.id) : false;
    },
  },
  priority: 5,
  slashItems: [
    { id: 'pagebreak', title: 'Page break', description: 'Start a new page here', keywords: ['page', 'break', 'new page', 'split'], icon: 'page', group: 'layout', order: 32, run: (e) => void e.exec('insertPageBreak') },
    { id: 'newpage', title: 'New page', description: 'Add a page to this document', keywords: ['page', 'tab', 'sheet', 'add'], icon: 'page', group: 'layout', order: 33, run: (e) => void e.exec('addPage') },
  ],
  labels: {
    'pages.tabs': 'Pages',
    'pages.add': 'Add page',
    'pages.rename': 'Rename page',
    'pages.delete': 'Delete page',
    'pages.duplicate': 'Duplicate page',
    'pages.moveLeft': 'Move left',
    'pages.moveRight': 'Move right',
    'pages.untitled': 'Untitled',
    'pages.break': 'Page break',
    'pages.view.tabs': 'One page at a time',
    'pages.view.paged': 'All pages',
    'pages.count': 'Page {n} of {total}',
  },
  // a paged document holds only pages at the top level
  normalize: (tr) => {
    const root = tr.doc.root;
    if (!tr.dirty.has('root')) return false;
    const kids = root.children!;
    if (!kids.some((b) => b.type === 'page') || kids.every((b) => b.type === 'page')) return false;
    let changed = false;
    for (let i = kids.length - 1; i >= 0; i--) {
      const b = kids[i];
      if (b.type === 'page') continue;
      let j = i;
      while (j > 0 && kids[j - 1].type !== 'page') j--;
      const run = kids.slice(j, i + 1).map((x) => x.id);
      const prev = j > 0 ? kids[j - 1] : null;
      if (prev) tr.move(run, prev.id, prev.children!.length);
      else {
        const json = kids.slice(j, i + 1).map((x) => x.toJSON());
        tr.removeAt('root', j, json.length);
        tr.insert('root', j, [tr.schema.create('page', { title: 'Page 1' }, undefined, json)]);
      }
      changed = true;
      i = j;
    }
    return changed;
  },
  setup: (editor) => {
    editor.storage.pages ??= { active: null };
    // follow the selection: undo / remote edits / search may move the caret to another page
    return editor.on('transaction', () => {
      const sel = editor.selection;
      const id = sel?.type === 'text' ? sel.focus.id : sel?.type === 'block' ? sel.ids[0] : sel?.type === 'cell' ? sel.focus : null;
      const b = id ? editor.doc.get(id) : null;
      const page = b ? (b.type === 'page' ? b : pageOf(editor, b)) : null;
      if (page && page.id !== activePage(editor)?.id) setActive(editor, page.id);
      else if (!page && editor.storage.pages.active && !editor.doc.has(editor.storage.pages.active)) setActive(editor, getPages(editor)[0]?.id ?? null);
    });
  },
};

void isCollapsed;
void isoAncestor;
void newId;

declare module './editor' {
  interface Commands {
    selectCurrentBlock(): boolean;
    clearDocument(): boolean;
    insertColumns(count?: number): boolean;
    toggleOpen(id?: string): boolean;
    insertImage(attrs: Attrs): boolean;
    insertEmbed(url: string): boolean;
    insertFile(attrs: Attrs): boolean;
    insertEquation(tex?: string, inline?: boolean): boolean;
    enablePages(): boolean;
    disablePages(): boolean;
    addPage(title?: string, afterId?: string): boolean;
    removePage(id?: string): boolean;
    renamePage(id: string, title: string): boolean;
    movePage(id: string, index: number): boolean;
    duplicatePage(id?: string): boolean;
    setActivePage(id: string): boolean;
    insertPageBreak(): boolean;
  }
}
