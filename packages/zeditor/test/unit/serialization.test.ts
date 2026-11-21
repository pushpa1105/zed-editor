import { describe, it, expect, beforeEach } from 'vitest';
import { make, p, resetIds, checkInvariants, texts, caret } from './helpers';
import { createHeadlessEditor, toHTML, toMarkdown, fromHTML, fromMarkdown, getText, defineExtension, Extension, parseHTML, safeUrl, BlockJSON, htmlToBlocks, markdownToBlocks } from '../../src/core';
import { GDOCS_HTML, WORD_HTML, EXCEL_HTML } from '../fixtures/paste';

beforeEach(resetIds);

const issueRef: Extension = defineExtension({
  name: 'issue-ref',
  schemaVersion: 2,
  nodes: [{ type: 'issue', kind: 'inline', attrs: { key: { default: '' }, title: { default: '' } }, toText: (a: any) => a.attrs.key }],
  migrate: (doc, from) => {
    if (from < 2) {
      const walk = (b: BlockJSON) => {
        for (const c of b.content ?? []) if ('atom' in c && c.atom === 'issue' && c.attrs?.id) {
          c.attrs.key = c.attrs.id;
          delete c.attrs.id;
        }
        b.children?.forEach(walk);
      };
      doc.blocks.forEach(walk);
    }
    return doc;
  },
});
const widget: Extension = { name: 'widget', nodes: [{ type: 'widget', kind: 'container', attrs: { color: { default: 'red' } } }] };

const rich: BlockJSON[] = [
  { id: 'h', type: 'heading', attrs: { level: 2, align: 'center' }, content: [{ text: 'Title' }] },
  { id: 'p1', type: 'paragraph', content: [{ text: 'Plain ' }, { text: 'bold', marks: { bold: true } }, { text: ' and ' }, { text: 'link', marks: { link: { href: 'https://example.com/a b', title: '' }, italic: true } }, { text: '\nnext line' }] },
  { id: 'l1', type: 'list', attrs: { kind: 'bullet' }, content: [{ text: 'one' }], children: [{ id: 'l2', type: 'list', attrs: { kind: 'ordered' }, content: [{ text: 'nested' }] }] },
  { id: 'l3', type: 'list', attrs: { kind: 'check', checked: true }, content: [{ text: 'done' }] },
  { id: 'q', type: 'quote', content: [{ text: 'quoted' }] },
  { id: 'c', type: 'code', attrs: { language: 'typescript' }, content: [{ text: 'const a = `x`;\n  <b>not html</b>' }] },
  { id: 'd', type: 'divider' },
  { id: 'img', type: 'image', attrs: { src: 'https://example.com/i.png', alt: 'An image', caption: 'Cap', width: 300 } },
  { id: 'co', type: 'callout', attrs: { tone: 'warning', icon: '⚠️' }, children: [{ id: 'cop', type: 'paragraph', content: [{ text: 'careful' }] }] },
  { id: 'tg', type: 'toggle', attrs: { open: false }, content: [{ text: 'More' }], children: [{ id: 'tgp', type: 'paragraph', content: [{ text: 'hidden' }] }] },
  { id: 'eq', type: 'equation', attrs: { tex: 'E=mc^2' } },
  { id: 'pm', type: 'paragraph', content: [{ text: 'hi ' }, { atom: 'mention', attrs: { id: 'u1', label: 'Ada' } }, { text: ' ' }, { atom: 'math', attrs: { tex: 'x^2' } }] },
];

describe('JSON', () => {
  it('round-trips losslessly, including custom node data', () => {
    const e = createHeadlessEditor({ content: [...rich, { id: 'w', type: 'widget', attrs: { color: 'blue', extra: { deep: [1, 2] } }, children: [p('in', 'wi')] }, { id: 'pi', type: 'paragraph', content: [{ atom: 'issue', attrs: { key: 'ZED-1', title: 'T' } }] }], extensions: [issueRef, widget] });
    const a = e.getJSON();
    const b = createHeadlessEditor({ content: JSON.parse(JSON.stringify(a)), extensions: [issueRef, widget] }).getJSON();
    expect(b).toEqual(a);
    expect(a.extensions).toMatchObject({ 'issue-ref': 2 });
    checkInvariants(e);
  });

  it('preserves nodes of a missing extension as inert data and recovers them later', () => {
    const full = createHeadlessEditor({ content: [p('before', 'a'), { id: 'w', type: 'widget', attrs: { color: 'blue', secret: 42 }, children: [p('inside', 'wi')] }, { id: 'c', type: 'paragraph', content: [{ text: 'see ' }, { atom: 'issue', attrs: { key: 'ZED-7', title: 'Bug' } }] }], extensions: [issueRef, widget] });
    const saved = full.getJSON();
    // open without the extensions
    const bare = createHeadlessEditor({ content: JSON.parse(JSON.stringify(saved)) });
    expect(bare.doc.get('w')!.type).toBe('unknown');
    checkInvariants(bare);
    // edit the surrounding text and around the unknown inline node
    caret(bare, 'a', 6);
    bare.commands.insertText(' edited');
    caret(bare, 'c', 0);
    bare.commands.insertText('>> ');
    bare.commands.toggleBlockType('quote');
    const resaved = JSON.parse(JSON.stringify(bare.getJSON()));
    // the custom block and inline node are written back untouched
    expect(resaved.blocks[1]).toEqual(saved.blocks[1]);
    expect(resaved.blocks[2].content[1]).toEqual({ atom: 'issue', attrs: { key: 'ZED-7', title: 'Bug' } });
    // reinstall the extensions
    const again = createHeadlessEditor({ content: resaved, extensions: [issueRef, widget] });
    expect(again.doc.get('w')!.type).toBe('widget');
    expect(again.doc.get('w')!.attrs).toEqual({ color: 'blue', secret: 42 });
    expect(again.doc.get('wi')!.text).toBe('inside');
    expect(again.doc.get('a')!.text).toBe('before edited');
    expect(getText(again)).toContain('ZED-7');
  });

  it('validates and sanitizes untrusted documents', () => {
    const e = make([
      { id: 'a', type: 'paragraph', content: [{ text: 'x', marks: { link: { href: 'javascript:alert(1)' }, bold: 1, __proto__: { polluted: true } } as any }] },
      { id: 'a', type: 'heading', attrs: { level: 99, align: 'expression(alert(1))' }, content: 'dup id' as any },
      { id: 'i', type: 'image', attrs: { src: 'javascript:alert(1)', width: 'NaN' } },
      { id: 'i2', type: 'image', attrs: { src: ' data:text/html,<script>1</script>' } },
      { id: 't', type: 'table', children: [{ id: 'bad', type: 'paragraph', content: [] } as any] },
      { type: 'paragraph', content: [{ text: 'no id' }, { text: 42 } as any, null as any] } as any,
      null as any,
      { id: 'c', type: 'code', content: [{ text: 'a', marks: { bold: true } }, { atom: 'mention', attrs: { id: 1 } } as any] },
    ]);
    const j = e.getJSON();
    expect(j.blocks[0].content).toEqual([{ text: 'x', marks: { bold: true } }]);
    expect(({} as any).polluted).toBeUndefined();
    expect(j.blocks[1].id).not.toBe('a');
    expect(j.blocks[1].attrs).toEqual({ level: 6 });
    expect(j.blocks[2].attrs!.src).toBe('');
    expect(j.blocks[2].attrs!.width).toBeUndefined();
    expect(j.blocks[3].attrs!.src).toBe('');
    expect(j.blocks[4].type).toBe('table');
    expect(j.blocks[4].children![0].type).toBe('table_row');
    expect(j.blocks[6].content).toEqual([{ text: 'a' }]);
    expect(e.validate({ blocks: 'nope' }).length).toBeGreaterThan(0);
    checkInvariants(e);
    expect(safeUrl('java\nscript:alert(1)')).toBe('');
    expect(safeUrl(' JaVaScRiPt:alert(1)')).toBe('');
    expect(safeUrl('/relative?x=1#h')).toBe('/relative?x=1#h');
    expect(safeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeUrl('data:image/png;base64,AAAA')).toBe('');
    expect(safeUrl('data:image/png;base64,AAAA', { image: true })).not.toBe('');
  });

  it('runs extension migrations for older documents', () => {
    const old = { format: 'zeditor', version: 1, extensions: { 'issue-ref': 1 }, blocks: [{ id: 'a', type: 'paragraph', content: [{ atom: 'issue', attrs: { id: 'ZED-3' } }] }] };
    const e = createHeadlessEditor({ content: old as any, extensions: [issueRef] });
    expect(e.getJSON().blocks[0].content![0]).toMatchObject({ atom: 'issue', attrs: { key: 'ZED-3' } });
  });
});

describe('HTML', () => {
  it('exports and re-imports supported content', () => {
    const e = make(rich);
    const html = toHTML(e);
    expect(html).toContain('<h2 style="text-align:center;">Title</h2>');
    expect(html).toContain('<ul><li>one<ol><li>nested</li></ol></li></ul>');
    expect(html).toContain('&lt;b&gt;not html&lt;/b&gt;');
    const back = make(fromHTML(e, html));
    const strip = (b: BlockJSON): any => ({ type: b.type, attrs: b.attrs, content: b.content, children: b.children?.map(strip) });
    expect(back.getJSON().blocks.map(strip)).toEqual(e.getJSON().blocks.map(strip));
  });

  it('never lets active content through', () => {
    const e = make();
    const blocks = fromHTML(
      e,
      `<p onclick="alert(1)">hi<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">l</a><iframe src="https://evil.example"></iframe><svg onload=alert(1)></svg><style>*{}</style><a href="  JAVASCRIPT:alert(1)">m</a><img src="data:text/html,x"></p><object data="x"></object><form><input name=a><button>b</button></form>`,
    );
    const out = toHTML(make(blocks));
    expect(out).not.toMatch(/script|onerror|onclick|javascript|iframe|svg|<style|<form|<input|<object/i);
    expect(getText(make(blocks)).replace(/\n/g, '')).toBe('hilm');
  });

  it('parses malformed markup without throwing', () => {
    for (const bad of ['<p><b>unclosed', '<<<>>>', '<table><tr><td>a<td>b<tr><td>c', '</div></p>text', '<p a="1" a=\'2\' b>x', '<!-- unterminated', '<ul><li>a<li>b<ul><li>c</ul></ul>', '&#xZZ; &amp; &nbsp; &#128512; &bogus;']) {
      expect(() => parseHTML(bad)).not.toThrow();
      expect(() => htmlToBlocks(make().schema, bad)).not.toThrow();
    }
    const t = htmlToBlocks(make().schema, '<table><tr><td>a<td>b<tr><td>c')[0];
    expect(t.type).toBe('table');
    expect(t.children!.length).toBe(2);
  });

  it('imports a Google Docs paste: headings, formatting, nested lists, links, table', () => {
    const e = make(fromHTML(make(), GDOCS_HTML));
    const j = e.getJSON().blocks;
    expect(j[0]).toMatchObject({ type: 'heading', attrs: { level: 1 }, content: [{ text: 'Project plan' }] });
    expect(j[1].content).toEqual([{ text: 'Normal, ' }, { text: 'bold', marks: { bold: true } }, { text: ', ' }, { text: 'italic', marks: { italic: true } }, { text: ' and a ' }, { text: 'link', marks: { link: { href: 'https://example.com/', title: '' }, underline: true } }, { text: '.' }]);
    expect(j[2]).toMatchObject({ type: 'list', attrs: { kind: 'bullet' }, content: [{ text: 'First' }] });
    expect(j[2].children![0]).toMatchObject({ type: 'list', content: [{ text: 'Nested' }] });
    expect(j[3]).toMatchObject({ type: 'list', content: [{ text: 'Second' }] });
    const table = j.find((b) => b.type === 'table')!;
    expect(table.children!.length).toBe(2);
    expect(getText(e)).toContain('A1\tB1');
    checkInvariants(e);
  });

  it('imports a Word paste: headings, formatting, mso lists with levels, table', () => {
    const e = make(fromHTML(make(), WORD_HTML));
    const j = e.getJSON().blocks;
    expect(j[0]).toMatchObject({ type: 'heading', attrs: { level: 1 }, content: [{ text: 'Quarterly report' }] });
    expect(j[1].content).toEqual([{ text: 'Some ' }, { text: 'bold', marks: { bold: true } }, { text: ' and ' }, { text: 'italic', marks: { italic: true } }, { text: ' text with a ' }, { text: 'link', marks: { link: { href: 'https://example.com/', title: '' } } }, { text: '.' }]);
    expect(j[2]).toMatchObject({ type: 'list', attrs: { kind: 'bullet' }, content: [{ text: 'Bullet one' }] });
    expect(j[2].children![0]).toMatchObject({ type: 'list', attrs: { kind: 'bullet' }, content: [{ text: 'Nested bullet' }] });
    expect(j[3]).toMatchObject({ type: 'list', attrs: { kind: 'ordered' }, content: [{ text: 'Step one' }] });
    expect(j[4]).toMatchObject({ type: 'list', attrs: { kind: 'ordered' }, content: [{ text: 'Step two' }] });
    const table = j.find((b) => b.type === 'table')!;
    expect(getText(make([table]))).toBe('Name\tQty\nApples\t3');
    expect(JSON.stringify(j)).not.toMatch(/mso|o:p|Symbol/);
  });

  it('imports a spreadsheet range with merged cells', () => {
    const t = fromHTML(make(), EXCEL_HTML)[0];
    expect(t.type).toBe('table');
    expect(t.children![0].children![0].attrs).toMatchObject({ colspan: 2 });
    expect(getText(make([t]))).toBe('Merged\tC\n1\t2\t3');
  });

  it('round-trips custom nodes through HTML without a dedicated serializer', () => {
    const e = createHeadlessEditor({ content: [{ id: 'w', type: 'widget', attrs: { color: 'blue' }, children: [p('in', 'wi')] }, { id: 'x', type: 'paragraph', content: [{ atom: 'issue', attrs: { key: 'ZED-9', title: 'T' } }] }], extensions: [issueRef, widget] });
    const back = createHeadlessEditor({ content: fromHTML(e, toHTML(e)), extensions: [issueRef, widget] }).getJSON().blocks;
    expect(back[0]).toMatchObject({ type: 'widget', attrs: { color: 'blue' } });
    expect(back[0].children![0].content).toEqual([{ text: 'in' }]);
    expect(back[1].content).toEqual([{ atom: 'issue', attrs: { key: 'ZED-9', title: 'T' } }]);
  });
});

describe('Markdown', () => {
  it('exports readable markdown', () => {
    const md = toMarkdown(make(rich));
    expect(md).toContain('## Title');
    expect(md).toContain('Plain **bold** and [*link*](https://example.com/a%20b)\\\nnext line');
    expect(md).toContain('- one\n  1. nested\n- [x] done');
    expect(md).toContain('> quoted');
    expect(md).toContain('```typescript\nconst a = `x`;\n  <b>not html</b>\n```');
    expect(md).toContain('![An image](https://example.com/i.png "Cap")');
    expect(md).toContain('> [!WARNING]\n> careful');
    expect(md).toContain('$$\nE=mc^2\n$$');
    expect(md).toContain('hi @Ada $x^2$');
  });

  it('round-trips the representable subset', () => {
    const e = make(rich);
    const strip = (b: BlockJSON): any => ({ type: b.type, content: b.content, children: b.children?.map(strip), ...(b.type === 'heading' ? { level: b.attrs!.level } : {}), ...(b.type === 'list' ? { kind: b.attrs!.kind, checked: b.attrs!.checked } : {}) });
    const back = make(fromMarkdown(e, toMarkdown(e)));
    const a = e.getJSON().blocks.map(strip);
    const b = back.getJSON().blocks.map(strip);
    // mention is exported as text; everything else must match
    a[a.length - 1].content = [{ text: 'hi @Ada ' }, { atom: 'math', attrs: { tex: 'x^2' } }];
    expect(b).toEqual(a);
  });

  it('imports common markdown', () => {
    const md = ['# H1', '', 'Para with **bold**, _em_, ~~gone~~, `code` and <https://a.example>.', 'Second line.', '', '1. one', '2. two', '   - nested', '', '- [ ] todo', '- [x] done', '', '| a | b |', '|---|:-:|', '| 1 | 2 |', '', '---', '', '```js', 'let x = 1;', '```', '', 'Setext', '------'].join('\n');
    const e = make(markdownToBlocks(make().schema, md));
    const j = e.getJSON().blocks;
    expect(j.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'list', 'list', 'table', 'divider', 'code', 'heading']);
    expect(j[1].content).toEqual([
      { text: 'Para with ' }, { text: 'bold', marks: { bold: true } }, { text: ', ' }, { text: 'em', marks: { italic: true } }, { text: ', ' }, { text: 'gone', marks: { strike: true } }, { text: ', ' },
      { text: 'code', marks: { code: true } }, { text: ' and ' }, { text: 'https://a.example', marks: { link: { href: 'https://a.example', title: '' } } }, { text: '. Second line.' },
    ]);
    expect(j[3].children![0]).toMatchObject({ type: 'list', attrs: { kind: 'bullet' } });
    expect(j[4].attrs).toMatchObject({ kind: 'check', checked: false });
    expect(j[8]).toMatchObject({ attrs: { language: 'js' }, content: [{ text: 'let x = 1;' }] });
    expect(j[9]).toMatchObject({ attrs: { level: 2 } });
    checkInvariants(e);
  });

  it('keeps custom node data through markdown via comment markers', () => {
    const e = createHeadlessEditor({ content: [{ id: 'w', type: 'widget', attrs: { color: 'blue' }, children: [p('in -- side', 'wi')] }], extensions: [widget] });
    const md = toMarkdown(e);
    expect(md).toContain('<!-- zeditor:block');
    const back = createHeadlessEditor({ content: fromMarkdown(e, md), extensions: [widget] }).getJSON().blocks[0];
    expect(back).toMatchObject({ type: 'widget', attrs: { color: 'blue' } });
    expect(back.children![0].content).toEqual([{ text: 'in -- side' }]);
  });
});

describe('plain text', () => {
  it('extracts text and counts', async () => {
    const { getCounts } = await import('../../src/core');
    const e = make([p('Hello wörld 👨‍👩‍👧‍👦', 'a')]);
    expect(getCounts(make([p('नमस्ते दुनिया', 'b')])).words).toBe(2);
    
    const c = getCounts(e);
    expect(c.words).toBe(2);
    expect(c.characters).toBe(13);
  });
});
