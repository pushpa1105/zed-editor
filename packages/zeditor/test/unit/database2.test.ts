import { describe, it, expect, beforeEach } from 'vitest';
import { make, p, resetIds, checkInvariants, caret } from './helpers';
import { Editor, queryDatabase, dbProperties, dbRows, dbViews, cellText, cellValue, runFormula, checkFormula, registerDbPropertyType, toHTML, fromHTML, getPages, pagePath, pageTree, blockSel } from '../../src/core';

beforeEach(resetIds);

function tasks(): { e: Editor; id: string; prop: (name: string) => string; text: (row: number, name: string) => string } {
  const e = make([p('intro', 'a')]);
  e.commands.insertDatabase('table', {
    title: 'Tasks',
    properties: [{ name: 'Name', type: 'title' }, { name: 'Points', type: 'number' }, { name: 'Price', type: 'number' }, { name: 'Done', type: 'checkbox' }, { name: 'Due', type: 'date' }],
    rows: [{ Name: 'Design', Points: 3, Price: 10.5, Done: true, Due: '2026-01-10' }, { Name: 'Build', Points: 8, Price: 2, Due: '2026-01-20' }, { Name: 'Docs' }],
    at: { after: 'a' },
  });
  const id = e.doc.blocks.find((b) => b.type === 'database')!.id;
  const prop = (name: string) => dbProperties(e.doc.get(id)!).find((x) => x.name === name)!.id;
  const text = (row: number, name: string) => cellText(dbRows(e.doc.get(id)!)[row], dbProperties(e.doc.get(id)!).find((x) => x.name === name)!);
  return { e, id, prop, text };
}

describe('formulas', () => {
  it('evaluates expressions safely', () => {
    const props: Record<string, any> = { A: 4, B: 2.5, Name: 'Ada', Done: true, Due: '2026-03-10', Empty: null };
    const run = (src: string) => runFormula(src, (n) => (n in props ? props[n] : null));
    expect(run('prop("A") * 2 + 1')).toBe(9);
    expect(run('(prop("A") + prop("B")) / 2')).toBe(3.25);
    expect(run('round(prop("A") / 3, 2)')).toBe(1.33);
    expect(run('prop("Name") + " scored " + prop("A")')).toBe('Ada scored 4');
    expect(run('if(prop("Done") and prop("A") > 3, "ok", "no")')).toBe('ok');
    expect(run('if(not prop("Done") or empty(prop("Empty")), upper(prop("Name")), 0)')).toBe('ADA');
    expect(run('dateDiff(prop("Due"), "2026-03-01")')).toBe(9);
    expect(run('dateAdd(prop("Due"), 30)')).toBe('2026-04-09');
    expect(run('prop("A") / 0')).toBeNull();
    expect(run('max(prop("A"), 10, 3) % 4')).toBe(2);
    expect(run('length(concat(prop("Name"), "!")) == 4')).toBe(true);
    // errors are values, never exceptions; nothing can reach the host environment
    for (const bad of ['prop("A") +', 'constructor("x")()', 'window.alert(1)', 'prop(A)', 'a = 1', '__proto__', 'eval("1")', 'prop("A")(1)', '"unterminated', '((((']) {
      expect(String(run(bad))).toMatch(/^#ERR/);
      expect(checkFormula(bad)).toBeTruthy();
    }
    expect(checkFormula('if(prop("A") >= 1, "a", "b")')).toBeNull();
    expect(String(run('('.repeat(200) + '1' + ')'.repeat(200)))).toMatch(/^#ERR/);
  });

  it('formula properties compute per row, sort, filter and summarize', () => {
    const { e, id, prop, text } = tasks();
    e.commands.dbAddProperty(id, { name: 'Total', type: 'formula', formula: 'round(prop("Points") * prop("Price"), 1)' });
    e.commands.dbAddProperty(id, { name: 'Label', type: 'formula', formula: 'if(prop("Done"), "✔ ", "") + prop("Name")' });
    expect([0, 1, 2].map((r) => text(r, 'Total'))).toEqual(['31.5', '16', '0']);
    expect([0, 1, 2].map((r) => text(r, 'Label'))).toEqual(['✔ Design', 'Build', 'Docs']);
    // computed cells cannot be written
    expect(e.commands.dbSetCell(dbRows(e.doc.get(id)!)[0].id, prop('Total'), 5)).toBe(false);
    e.commands.dbSort(id, prop('Total'), 'desc');
    expect(queryDatabase(e.doc.get(id)!).rows.map((r) => r.attrs.cells.title)).toEqual(['Design', 'Build', 'Docs']);
    e.commands.dbFilter(id, [{ prop: prop('Total'), op: 'gt', value: '20' }]);
    expect(queryDatabase(e.doc.get(id)!).rows.length).toBe(1);
    e.commands.dbFilter(id, null);
    e.commands.dbCalculate(id, prop('Total'), 'sum');
    expect(queryDatabase(e.doc.get(id)!).calc[prop('Total')]).toBe('47.5');
    // editing an input updates the result; a broken or circular formula shows an error, not a crash
    e.commands.dbSetCell(dbRows(e.doc.get(id)!)[2].id, prop('Points'), 4);
    e.commands.dbSetCell(dbRows(e.doc.get(id)!)[2].id, prop('Price'), 1.5);
    expect(text(2, 'Total')).toBe('6');
    e.commands.dbUpdateProperty(id, prop('Total'), { formula: 'prop("Total") + 1' });
    expect(text(0, 'Total')).toMatch(/^#ERR/);
    e.commands.dbUpdateProperty(id, prop('Total'), { formula: 'prop("Label") + prop("Nope")' });
    expect(text(0, 'Total')).toMatch(/^#ERR: No property "Nope"/);
    e.commands.dbUpdateProperty(id, prop('Label'), { formula: 'prop("Total")' });
    expect(text(0, 'Label')).toMatch(/^#ERR/);
    expect(toHTML(e)).toContain('#ERR');
    checkInvariants(e);
    e.undo();
    e.undo();
    e.undo();
    expect(text(0, 'Total')).toBe('31.5');
  });
});

describe('relations and rollups', () => {
  it('links rows of another database and summarizes them', () => {
    const { e, id, prop, text } = tasks();
    e.commands.insertDatabase('table', { title: 'Projects', properties: [{ name: 'Project', type: 'title' }], rows: [{ Project: 'Website' }, { Project: 'App' }] });
    const projects = e.doc.blocks.filter((b) => b.type === 'database')[1];
    const pid = projects.id;
    const pprop = (name: string) => dbProperties(e.doc.get(pid)!).find((x) => x.name === name)!.id;
    e.commands.dbAddProperty(pid, { name: 'Tasks', type: 'relation', relation: { database: id } });
    const rows = dbRows(e.doc.get(id)!);
    const website = dbRows(e.doc.get(pid)!)[0];
    expect(e.commands.dbSetCell(website.id, pprop('Tasks'), [rows[0].id, rows[1].id, 'missing-row'])).toBe(true);
    const ptext = (r: number, name: string) => cellText(dbRows(e.doc.get(pid)!)[r], dbProperties(e.doc.get(pid)!).find((x) => x.name === name)!);
    expect(ptext(0, 'Tasks')).toBe('Design, Build'); // unknown ids are ignored
    expect(ptext(1, 'Tasks')).toBe('');
    e.commands.dbAddProperty(pid, { name: 'Points', type: 'rollup', rollup: { relation: pprop('Tasks'), target: prop('Points'), calc: 'sum' } });
    e.commands.dbAddProperty(pid, { name: 'Open', type: 'rollup', rollup: { relation: pprop('Tasks'), target: prop('Done'), calc: 'percent_checked' } });
    e.commands.dbAddProperty(pid, { name: 'Names', type: 'rollup', rollup: { relation: pprop('Tasks'), target: 'title', calc: 'show' } });
    e.commands.dbAddProperty(pid, { name: 'Load', type: 'formula', formula: 'if(prop("Points") > 10, "heavy", "light")' });
    expect([ptext(0, 'Points'), ptext(0, 'Open'), ptext(0, 'Names'), ptext(0, 'Load')]).toEqual(['11', '50%', 'Design, Build', 'heavy']);
    expect([ptext(1, 'Points'), ptext(1, 'Load')]).toEqual(['0', 'light']);
    // changes in the related database flow through
    e.commands.dbSetCell(rows[1].id, prop('Points'), 20);
    expect(ptext(0, 'Points')).toBe('23');
    e.commands.dbDeleteRow(rows[0].id);
    expect([ptext(0, 'Tasks'), ptext(0, 'Points')]).toEqual(['Build', '20']);
    // sort and filter by a rollup; HTML keeps the readable values and round-trips
    e.commands.dbSort(pid, pprop('Points'), 'desc');
    expect(queryDatabase(e.doc.get(pid)!).rows.map((r) => r.attrs.cells.title)).toEqual(['Website', 'App']);
    const html = toHTML(e);
    expect(html).toContain('<td>Build</td><td>20</td>');
    expect(make(fromHTML(e, html)).getJSON().blocks.filter((b) => b.type === 'database')[1]).toEqual(e.getJSON().blocks.filter((b) => b.type === 'database')[1]);
    // a relation to a database that does not exist is harmless
    e.commands.dbUpdateProperty(pid, pprop('Tasks'), { relation: { database: 'gone' } });
    expect([ptext(0, 'Tasks'), ptext(0, 'Points')]).toEqual(['', '']);
    void text;
    checkInvariants(e);
  });
});

describe('views and schema', () => {
  it('match-any filters, calendar / timeline views, property order, custom types', () => {
    const { e, id, prop } = tasks();
    const names = () => queryDatabase(e.doc.get(id)!).rows.map((r) => r.attrs.cells.title);
    e.commands.dbFilter(id, [{ prop: prop('Points'), op: 'gt', value: '5' }, { prop: prop('Done'), op: 'checked' }]);
    expect(names()).toEqual([]);
    e.commands.dbFilterMode(id, 'or');
    expect(names()).toEqual(['Design', 'Build']);
    e.commands.dbFilter(id, null);
    // calendar uses the first date property; a database without one gets a date property
    e.commands.dbAddView(id, 'calendar');
    let res = queryDatabase(e.doc.get(id)!);
    expect([res.view.type, res.dateProp?.name]).toEqual(['calendar', 'Due']);
    e.commands.dbAddProperty(id, { name: 'End', type: 'date' });
    e.commands.dbAddView(id, 'timeline');
    e.commands.dbUpdateView(id, undefined, { endProp: prop('End') });
    res = queryDatabase(e.doc.get(id)!);
    expect([res.view.type, res.dateProp?.name, res.endProp?.name]).toEqual(['timeline', 'Due', 'End']);
    const bare = make([p('x', 'a')]);
    bare.commands.insertDatabase('table', { properties: [{ name: 'Name', type: 'title' }], rows: [{ Name: 'r' }] });
    const bid = bare.doc.blocks.find((b) => b.type === 'database')!.id;
    bare.commands.dbAddView(bid, 'calendar');
    expect(dbProperties(bare.doc.get(bid)!).map((x) => x.type)).toEqual(['title', 'date']);
    expect(queryDatabase(bare.doc.get(bid)!).dateProp).toBeTruthy();
    bare.undo(); // one step
    expect(dbViews(bare.doc.get(bid)!).length).toBe(1);
    // reorder properties; the title cannot move and nothing can move in front of it
    const order = () => dbProperties(e.doc.get(id)!).map((x) => x.name);
    expect(order()).toEqual(['Name', 'Points', 'Price', 'Done', 'Due', 'End']);
    expect(e.commands.dbMoveProperty(id, prop('End'), 0)).toBe(true);
    expect(order()).toEqual(['Name', 'End', 'Points', 'Price', 'Done', 'Due']);
    expect(e.commands.dbMoveProperty(id, 'title', 3)).toBe(false);
    e.commands.dbMoveProperty(id, prop('Points'), 99);
    expect(order()).toEqual(['Name', 'End', 'Price', 'Done', 'Due', 'Points']);
    // custom property type: validated, shown and sorted by the host's rules
    registerDbPropertyType({ type: 'rating', label: 'Rating', coerce: (v) => (Number(v) >= 1 && Number(v) <= 5 ? Math.round(Number(v)) : undefined), text: (v) => '★'.repeat(v), compare: (a, b) => a - b });
    e.commands.dbAddProperty(id, { name: 'Stars', type: 'rating' });
    const rows = dbRows(e.doc.get(id)!);
    e.commands.dbSetCell(rows[0].id, prop('Stars'), 2);
    e.commands.dbSetCell(rows[1].id, prop('Stars'), '5');
    e.commands.dbSetCell(rows[2].id, prop('Stars'), 99); // rejected by coerce
    const stars = dbProperties(e.doc.get(id)!).find((x) => x.name === 'Stars')!;
    expect(dbRows(e.doc.get(id)!).map((r) => [cellValue(r, stars), cellText(r, stars)])).toEqual([[2, '★★'], [5, '★★★★★'], [null, '']]);
    e.commands.dbSetView(id, 'v1');
    e.commands.dbSort(id, prop('Stars'), 'desc');
    expect(names()).toEqual(['Build', 'Design', 'Docs']);
    expect(() => registerDbPropertyType({ type: 'title', label: 'x', coerce: (v) => v, text: String })).toThrow();
    checkInvariants(e);
    expect(make(JSON.parse(JSON.stringify(e.getJSON())).blocks).getJSON()).toEqual(e.getJSON());
  });

  it('moving a row keeps the selection and is one undo step', () => {
    const { e, id } = tasks();
    const rows = dbRows(e.doc.get(id)!);
    caret(e, 'a', 2);
    expect(e.commands.dbMoveRow(rows[2].id, rows[0].id, 'before')).toBe(true);
    expect(dbRows(e.doc.get(id)!).map((r) => r.attrs.cells.title)).toEqual(['Docs', 'Design', 'Build']);
    expect(e.selection).toMatchObject({ type: 'text', focus: { id: 'a', offset: 2 } });
    e.undo();
    expect(dbRows(e.doc.get(id)!).map((r) => r.attrs.cells.title)).toEqual(['Design', 'Build', 'Docs']);
  });
});

describe('sub-pages and synced copies', () => {
  it('nests pages, keeps tree order, re-parents on delete and refuses cycles', () => {
    const e = make([p('root text', 'a')]);
    e.commands.enablePages();
    const top = getPages(e)[0];
    e.commands.addSubPage(top.id, 'Child A');
    e.commands.addPage('Second top');
    e.commands.addSubPage(top.id, 'Child B');
    const childA = getPages(e).find((x) => x.attrs.title === 'Child A')!;
    e.commands.addSubPage(childA.id, 'Grandchild');
    const titles = () => pageTree(e).map((x) => '  '.repeat(x.depth) + x.page.attrs.title);
    expect(titles()).toEqual(['Page 1', '  Child A', '    Grandchild', '  Child B', 'Second top']);
    // sub-pages are stored right after their parent's subtree
    expect(getPages(e).map((x) => x.attrs.title)).toEqual(['Page 1', 'Child A', 'Grandchild', 'Child B', 'Second top']);
    const grand = getPages(e).find((x) => x.attrs.title === 'Grandchild')!;
    expect(pagePath(e, grand.id).map((x) => x.attrs.title)).toEqual(['Page 1', 'Child A', 'Grandchild']);
    expect(e.commands.setPageParent(top.id, grand.id)).toBe(false); // would be a cycle
    expect(e.commands.setPageParent(childA.id, childA.id)).toBe(false);
    e.commands.removePage(childA.id);
    expect(titles()).toEqual(['Page 1', '  Grandchild', '  Child B', 'Second top']);
    e.commands.setPageParent(grand.id, null);
    expect(pagePath(e, grand.id).length).toBe(1);
    e.undo();
    e.undo();
    expect(titles()).toEqual(['Page 1', '  Child A', '    Grandchild', '  Child B', 'Second top']);
    // hostile data: a parent cycle does not hang
    const bad = make([{ id: 'p1', type: 'page', attrs: { title: 'A', parent: 'p2' }, children: [p('x', 'x')] }, { id: 'p2', type: 'page', attrs: { title: 'B', parent: 'p1' }, children: [p('y', 'y')] }]);
    expect(pageTree(bad).length).toBe(2);
    expect(pagePath(bad, 'p1').length).toBeLessThan(4);
    checkInvariants(e);
  });

  it('synced copies point at a source block', () => {
    const e = make([p('original', 'a'), p('other', 'b')]);
    e.setSelection(blockSel(['a']));
    expect(e.commands.insertSyncedCopy()).toBe(true);
    const copy = e.doc.blocks[1];
    expect(copy).toMatchObject({ type: 'synced', attrs: { source: 'a' } });
    expect(e.commands.insertSyncedCopy(copy.id)).toBe(false); // no copies of copies
    const html = toHTML(e);
    expect(html).toContain('data-synced="a"');
    expect(make(fromHTML(e, html)).getJSON().blocks[1]).toMatchObject({ type: 'synced', attrs: { source: 'a' } });
    e.commands.deleteBlocks(['a']); // the copy survives and reports a missing source in the view
    expect(e.doc.blocks.some((b) => b.type === 'synced')).toBe(true);
    checkInvariants(e);
  });
});
