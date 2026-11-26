import { describe, it, expect, beforeEach } from 'vitest';
import { make, p, resetIds, caret, checkInvariants } from './helpers';
import { toHTML, toMarkdown, fromHTML, fromMarkdown, createTable, tableMap, BlockJSON } from '../../src/core';

beforeEach(resetIds);

const nestedDoc = (): BlockJSON[] => {
  const e = make();
  const inner = createTable(e, 2, 2, true, (r, c) => `in${r}${c}`);
  inner.id = 'inner';
  const outer = createTable(e, 2, 2, true, (r, c) => `out${r}${c}`);
  outer.id = 'outer';
  // put the inner table in the outer table's body cell (1,0), after its paragraph
  outer.children![1].children![0].children!.push(inner);
  return [p('before', 'a'), outer, p('after', 'z')];
};

describe('tables inside tables', () => {
  it('loads, edits and keeps both tables valid', () => {
    const e = make(nestedDoc());
    checkInvariants(e);
    const inner = e.doc.get('inner')!;
    expect(inner.parent!.type).toBe('table_cell');
    expect(tableMap(inner).rows).toBe(2);
    expect(tableMap(e.doc.get('outer')!).rows).toBe(2);
    // commands act on the table holding the caret: the inner one
    const firstInner = [...e.doc.descendants(inner)].find((b) => b.type === 'paragraph')!;
    caret(e, firstInner.id, 0);
    e.commands.addRow('after');
    expect(tableMap(e.doc.get('inner')!).rows).toBe(3);
    expect(tableMap(e.doc.get('outer')!).rows).toBe(2);
    e.commands.addColumn('after');
    expect(tableMap(e.doc.get('inner')!).cols).toBe(3);
    expect(tableMap(e.doc.get('outer')!).cols).toBe(2);
    checkInvariants(e);
    // deleting the inner table leaves the outer cell usable
    e.commands.deleteTable();
    expect(e.doc.get('inner')).toBeFalsy();
    expect(e.doc.get('outer')).toBeTruthy();
    checkInvariants(e);
  });

  it('inserting a table while the caret is in a cell nests it', () => {
    const e = make(nestedDoc());
    const cellPara = e.doc.get('outer')!.children![1].children![1].children![0];
    caret(e, cellPara.id, 0);
    expect(e.commands.insertTable(2, 3)).toBe(true);
    const cell = e.doc.get('outer')!.children![1].children![1];
    expect(cell.children!.some((b) => b.type === 'table')).toBe(true);
    checkInvariants(e);
  });

  it('round-trips through HTML; Markdown keeps the content readable', () => {
    const e = make(nestedDoc());
    const html = toHTML(e);
    expect(html).toMatch(/<td[^>]*>(?:(?!<\/td>).)*<table/s);
    const e2 = make();
    e2.setJSON(fromHTML(e2, html));
    const outer = e2.doc.blocks.find((b) => b.type === 'table')!;
    const nested = [...e2.doc.descendants(outer)].filter((b) => b.type === 'table');
    expect(nested).toHaveLength(1);
    expect([...e2.doc.descendants(nested[0])].filter((b) => b.content).map((b) => b.text)).toEqual(['in00', 'in01', 'in10', 'in11']);
    const md = toMarkdown(e);
    for (const t of ['out00', 'out10', 'in00', 'in11']) expect(md).toContain(t);
  });
});

describe('complex tables from other apps', () => {
  const load = (html: string) => {
    const e = make();
    e.setJSON(fromHTML(e, html));
    checkInvariants(e);
    return e;
  };
  const texts = (b: any) => [...b.children.flatMap((r: any) => r.children)].map((c: any) => c.children.map((k: any) => (k.type === 'paragraph' ? k.text : k.type)).join('/'));

  it('keeps caption, column widths, colours, alignment, header column and merged cells', () => {
    const e = load(`<table><caption>Q3 statement</caption><colgroup><col style="width:180px"><col width="90"><col></colgroup>
      <thead><tr><th rowspan="2">Item</th><th colspan="2">Amount</th></tr><tr><th>2025</th><th>2026</th></tr></thead>
      <tbody><tr><th scope="row">Revenue</th><td align="right">1,200</td><td style="text-align:right;background-color:#fff3c4">1,450</td></tr>
      <tr><th>Costs</th><td bgcolor="#eeeeee">800</td><td>900</td></tr></tbody>
      <tfoot><tr><td><b>Total</b></td><td colspan="2" style="text-align:center">950</td></tr></tfoot></table>`);
    const [cap, t] = e.doc.blocks;
    expect(cap.type).toBe('paragraph');
    expect(cap.text).toBe('Q3 statement');
    expect(cap.content![0].marks?.bold).toBe(true);
    expect(t.type).toBe('table');
    expect(t.attrs.colWidths).toEqual([180, 90, 0]);
    const cells = t.children!.flatMap((r) => r.children!);
    expect(cells[0].attrs).toMatchObject({ header: true, rowspan: 2 });
    expect(cells[1].attrs).toMatchObject({ header: true, colspan: 2 });
    const revenue2026 = cells.find((c) => c.children![0].text === '1,450')!;
    expect(revenue2026.attrs.background).toBe('#fff3c4');
    expect(revenue2026.children![0].attrs.align).toBe('right');
    expect(cells.find((c) => c.children![0].text === '800')!.attrs.background).toBe('#eeeeee');
    expect(cells.find((c) => c.children![0].text === 'Costs')!.attrs.header).toBe(true);
    expect(cells.find((c) => c.children![0].text === '950')!.attrs).toMatchObject({ colspan: 2 });
    expect(tableMap(t).rows).toBe(5);
    expect(tableMap(t).cols).toBe(3);
  });

  it('cells keep lists, code, images and nested tables; layout tables are unwrapped', () => {
    const e = load(`<table role="presentation"><tr><td><h2>Newsletter</h2>
      <table><tr><td>Plan</td><td><ul><li>one</li><li>two</li></ul></td></tr>
      <tr><td><pre><code>npm i</code></pre></td><td><img src="https://example.com/a.png" alt="A"><table><tr><td>x</td><td>y</td></tr></table></td></tr></table>
      </td></tr></table><table><tr><td><p>Only cell</p></td></tr></table>`);
    expect(e.doc.blocks.map((b) => b.type)).toEqual(['heading', 'table', 'paragraph']);
    const t = e.doc.blocks[1];
    expect(texts(t)).toEqual(['Plan', 'list/list', 'code', 'image/table']);
    const inner = [...e.doc.descendants(t)].filter((b) => b.type === 'table');
    expect(inner).toHaveLength(1);
    expect(e.doc.blocks[2].text).toBe('Only cell');
  });

  it('very deep nesting is flattened below four levels; nothing is lost', () => {
    let html = '<b>deepest</b>';
    for (let i = 0; i < 7; i++) html = `<table><tr><td>L${7 - i}</td><td>${html}</td></tr></table>`;
    const e = load(html);
    const tables = [...e.doc.descendants()].filter((b) => b.type === 'table');
    expect(tables).toHaveLength(4);
    const all = [...e.doc.descendants()].filter((b) => b.content).map((b) => b.text);
    for (const t of ['L1', 'L4', 'L5', 'L7', 'deepest']) expect(all).toContain(t);
  });

  it('a table inside a list item stays inside it', () => {
    const e = load('<ul><li>Steps<table><tr><td>a</td><td>b</td></tr></table></li><li>next</li></ul>');
    expect(e.doc.blocks.map((b) => b.type)).toEqual(['list', 'list']);
    expect(e.doc.blocks[0].children![0].type).toBe('table');
  });

  it('Markdown keeps complex tables as HTML and reads them back; simple tables stay GFM', () => {
    const e = make(nestedDoc());
    const md = toMarkdown(e);
    expect(md).toMatch(/^<table/m);
    const e2 = make();
    e2.setJSON(fromMarkdown(e2, md));
    const outer = e2.doc.blocks.find((b) => b.type === 'table')!;
    expect([...e2.doc.descendants(outer)].filter((b) => b.type === 'table')).toHaveLength(1);
    expect([...e2.doc.descendants(outer)].filter((b) => b.content).map((b) => b.text)).toContain('in11');
    // simple
    const s = make([createTable(make(), 2, 2, true, (r, c) => `c${r}${c}`)]);
    expect(toMarkdown(s)).toMatch(/^\| c00 \| c01 \|/m);
  });
});
