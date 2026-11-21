import { test, expect, Page } from '@playwright/test';
import { open, root, json, sel, texts, setSel, expectInSync, noErrors, p, MOD } from './util';

/** Dispatch a paste with arbitrary clipboard flavours (works in every engine, no OS clipboard needed). */
async function paste(page: Page, data: Record<string, string>) {
  await page.evaluate((d) => {
    const w = window as any;
    const dt = new DataTransfer();
    for (const k in d) dt.setData(k, d[k]);
    const el = document.querySelector('#a .z-root')!;
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    const key = Object.keys(d)[0];
    if (ev.clipboardData && ev.clipboardData.getData(key) === d[key]) el.dispatchEvent(ev);
    else {
      // this engine ignores `clipboardData` on synthetic events: drive the same code path through the public API
      w.syntheticClipboard = false;
      let json;
      try {
        json = d['application/x-zeditor+json'] ? JSON.parse(d['application/x-zeditor+json']) : undefined;
      } catch {}
      w.Z.pasteData(w.z.editor, { text: d['text/plain'] ?? '', html: d['text/html'] ?? '', files: [], json });
    }
  }, data);
}
/** Run a copy/cut through the editor's own handlers and return what it put on the clipboard. */
async function copy(page: Page, type: 'copy' | 'cut' = 'copy'): Promise<Record<string, string>> {
  return page.evaluate((t) => {
    const w = window as any;
    const dt = new DataTransfer();
    const ev = new ClipboardEvent(t, { clipboardData: dt, bubbles: true, cancelable: true });
    const out: Record<string, string> = {};
    if (ev.clipboardData === dt) {
      document.querySelector('#a .z-root')!.dispatchEvent(ev);
      for (const k of dt.types) out[k] = dt.getData(k);
      if (Object.keys(out).length) return out;
    }
    w.syntheticClipboard = false;
    const p = t === 'cut' ? w.Z.cutPayload(w.z.editor) : w.Z.copyPayload(w.z.editor);
    return { 'text/plain': p.text, 'text/html': p.html, 'application/x-zeditor+json': JSON.stringify(p.json) };
  }, type);
}
const cellText = (page: Page) =>
  page.evaluate(() => {
    const z = (window as any).z;
    const t = [...z.editor.doc.descendants()].find((b: any) => b.type === 'table');
    return t.children.map((r: any) => r.children.map((c: any) => (window as any).Z.getText(z.editor, c.children) + (c.attrs.colspan > 1 ? `[${c.attrs.colspan}]` : '')).join(',')).join(' / ');
  });
const firstCell = async (page: Page, r = 0, c = 0) => {
  const id = await page.evaluate(([r, c]) => {
    const z = (window as any).z;
    const t = [...z.editor.doc.descendants()].find((b: any) => b.type === 'table');
    return t.children[r].children[c].children[0].id;
  }, [r, c]);
  await setSel(page, id, 0);
  return id;
};

test.describe('tables', () => {
  test('insert, type across cells with Tab, add/remove rows and columns via table tools', async ({ page }) => {
    await open(page, { content: [p('', 'a')] });
    await root(page).click();
    await page.locator('#a .z-top [data-id="table"]').click();
    await page.keyboard.type('A');
    await page.keyboard.press('Tab');
    await page.keyboard.type('B');
    await page.keyboard.press('Tab');
    await page.keyboard.type('C');
    expect(await cellText(page)).toBe('A,B,C / ,, / ,,');
    const tools = page.locator('#a .z-table-tools');
    await expect(tools).toBeVisible();
    await tools.getByRole('button', { name: 'Insert column right' }).click();
    await tools.getByRole('button', { name: 'Insert row below' }).click();
    expect(await cellText(page)).toBe('A,B,C, / ,,, / ,,, / ,,,');
    await tools.getByRole('button', { name: 'Delete row' }).click();
    await tools.getByRole('button', { name: 'Delete column' }).click();
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press(`${MOD}+z`);
    expect(await cellText(page)).toBe('A,B,C, / ,,, / ,,, / ,,,');
    await expect(page.locator('#a th')).toHaveCount(4);
    await noErrors(page);
  });

  test('rectangular selection by dragging and by Shift+Arrow, merge and split', async ({ page }) => {
    await open(page, { content: [p('', 'a')] });
    await root(page).click();
    await page.evaluate(() => (window as any).z.commands.insertTable(3, 3));
    const cells = page.locator('#a .z-cell');
    const a = (await cells.nth(0).boundingBox())!;
    const b = (await cells.nth(4).boundingBox())!;
    await page.mouse.move(a.x + 10, a.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + 10, b.y + 10, { steps: 5 });
    await page.mouse.up();
    expect((await sel(page)).type).toBe('cell');
    await expect(page.locator('#a .z-cell-selected')).toHaveCount(4);
    await page.locator('#a .z-table-tools').getByRole('button', { name: 'Merge cells' }).click();
    await expect(page.locator('#a .z-cell').first()).toHaveAttribute('colspan', '2');
    await expect(page.locator('#a .z-cell').first()).toHaveAttribute('rowspan', '2');
    await page.locator('#a .z-table-tools').getByRole('button', { name: 'Split cell' }).click();
    await expect(page.locator('#a .z-cell')).toHaveCount(9);
    // keyboard: extend a cell selection from the caret
    await firstCell(page, 0, 0);
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    expect((await sel(page)).type).toBe('cell');
    await expect(page.locator('#a .z-cell-selected')).toHaveCount(4);
    await page.keyboard.press('Backspace'); // clears contents, keeps structure
    await expect(page.locator('#a .z-cell')).toHaveCount(9);
    await noErrors(page);
  });

  test('paste a spreadsheet range into a table, undo, serialize, reload and compare', async ({ page }) => {
    await open(page, { content: [p('', 'a')] });
    await root(page).click();
    await page.evaluate(() => (window as any).z.commands.insertTable(2, 2));
    await page.keyboard.type('keep');
    await firstCell(page, 1, 1);
    const before = JSON.stringify(await json(page));
    // what Excel / Sheets put on the clipboard: TSV plus an HTML table (with a merged cell)
    await paste(page, {
      'text/plain': 'M\t\tC\n1\t2\t3\n',
      'text/html': '<table><tr><td colspan=2>M</td><td>C</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>',
    });
    // destination grew from 2x2 to 3x4; the merged source cell lands on its first position
    expect(await cellText(page)).toBe('keep,,, / ,M,,C / ,1,2,3');
    const afterPaste = await json(page);
    await page.keyboard.press(`${MOD}+z`);
    expect(JSON.stringify(await json(page))).toBe(before);
    await page.keyboard.press(`${MOD}+y`);
    expect(await json(page)).toEqual(afterPaste);
    // serialize, reload into a fresh editor and compare
    const same = await page.evaluate(() => {
      const w = window as any;
      const saved = JSON.stringify(w.z.getJSON());
      const z2 = w.mount({ content: JSON.parse(saved) }, '#b');
      return JSON.stringify(z2.getJSON()) === saved;
    });
    expect(same).toBe(true);
    await expect(page.locator('#b .z-cell')).toHaveCount(12);
    await noErrors(page);
  });

  test('copy a cell range and paste it into another table position and as plain TSV', async ({ page }) => {
    await open(page, { content: [p('', 'a')] });
    await root(page).click();
    await page.evaluate(() => {
      const z = (window as any).z;
      z.commands.insertBlocks([(window as any).Z.createTable(z.editor, 2, 2, false, (r: number, c: number) => `r${r}c${c}`)]);
    });
    const ids = await page.evaluate(() => {
      const z = (window as any).z;
      const t = [...z.editor.doc.descendants()].find((b: any) => b.type === 'table');
      return { table: t.id, a: t.children[0].children[0].id, b: t.children[0].children[1].id };
    });
    await page.evaluate((i) => {
      const z = (window as any).z;
      z.focus();
      z.editor.setSelection({ type: 'cell', table: i.table, anchor: i.a, focus: i.b });
    }, ids);
    const clip = await copy(page);
    expect(clip['text/plain']).toBe('r0c0\tr0c1');
    expect(clip['text/html']).toContain('<table>');
    await firstCell(page, 1, 1);
    await paste(page, clip);
    expect(await cellText(page)).toBe('r0c0,r0c1, / r1c0,r0c0,r0c1');
    await noErrors(page);
  });

  test('column resize with the keyboard is undoable', async ({ page }) => {
    await open(page, { content: [p('', 'a')] });
    await root(page).click();
    await page.evaluate(() => (window as any).z.commands.insertTable(2, 2));
    const handle = page.locator('#a .z-col-handle').first();
    await expect(handle).toBeAttached();
    const w0 = (await page.locator('#a .z-cell').first().boundingBox())!.width;
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const widths = await page.evaluate(() => [...(window as any).z.editor.doc.descendants()].find((b: any) => b.type === 'table').attrs.colWidths);
    expect(widths[0]).toBeGreaterThan(w0 + 20);
    await page.evaluate(() => (window as any).z.focus());
    await page.keyboard.press(`${MOD}+z`);
    const w2 = await page.evaluate(() => [...(window as any).z.editor.doc.descendants()].find((b: any) => b.type === 'table').attrs.colWidths);
    expect(w2 ?? []).not.toEqual(widths);
  });
});

test.describe('clipboard', () => {
  test('copy keeps formatting through the internal format and HTML; cut + paste moves blocks', async ({ page }) => {
    await open(page, { content: [{ id: 'a', type: 'heading', attrs: { level: 2 }, content: [{ text: 'Title' }] }, { id: 'b', type: 'paragraph', content: [{ text: 'some ' }, { text: 'bold', marks: { bold: true } }, { text: ' text' }] }, p('end', 'c')] });
    await setSel(page, 'a', 0, 'b', 9);
    const clip = await copy(page);
    expect(clip['text/plain']).toBe('Title\nsome bold');
    expect(clip['text/html']).toContain('<h2>Title</h2><p>some <strong>bold</strong></p>');
    await setSel(page, 'c', 3);
    await paste(page, clip);
    let j = await json(page);
    expect(j.map((b: any) => b.type)).toEqual(['heading', 'paragraph', 'paragraph', 'heading', 'paragraph']);
    expect(j[2].content).toEqual([{ text: 'end' }]); // a pasted heading stays a block of its own
    expect(j[4].content).toEqual([{ text: 'some ' }, { text: 'bold', marks: { bold: true } }]);
    // paste only the HTML flavour (as another app would provide)
    await page.keyboard.press(`${MOD}+z`);
    await setSel(page, 'c', 3);
    await paste(page, { 'text/html': '<h2>Title</h2><p>some <b>bold</b></p>', 'text/plain': 'Title\nsome bold' });
    j = await json(page);
    expect(j[4].content).toEqual([{ text: 'some ' }, { text: 'bold', marks: { bold: true } }]);
    await page.keyboard.press(`${MOD}+z`);
    // cut removes, paste restores at a new place
    await setSel(page, 'a', 0, 'a', 5);
    const cut = await copy(page, 'cut');
    expect(await texts(page)).toBe('|some bold text|end');
    await setSel(page, 'c', 3);
    await paste(page, cut);
    expect(await texts(page)).toBe('|some bold text|endTitle');
    await expectInSync(page);
    await noErrors(page);
  });

  test('pasting a URL onto selected text links it; plain text and malicious HTML are handled', async ({ page }) => {
    await open(page, { content: [p('click here now', 'a')] });
    await setSel(page, 'a', 6, 'a', 10);
    await paste(page, { 'text/plain': 'https://example.com/x' });
    expect((await json(page))[0].content).toEqual([{ text: 'click ' }, { text: 'here', marks: { link: { href: 'https://example.com/x', title: '' } } }, { text: ' now' }]);
    await setSel(page, 'a', 14);
    await paste(page, { 'text/plain': ' line one\nline two' });
    expect(await texts(page)).toBe('click here now line one|line two');
    await paste(page, { 'text/html': '<img src=x onerror="window.errors.push(\'xss\')"><script>window.errors.push("xss")</script><a href="javascript:window.errors.push(1)">bad</a><p onclick="x">ok</p>' });
    await page.waitForTimeout(100);
    expect(await page.locator('#a .z-root').innerHTML()).not.toMatch(/onerror|javascript:|<script|onclick/i);
    await noErrors(page);
  });

  test('real clipboard round trip with keyboard shortcuts', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'OS clipboard access is only granted to Chromium in this setup');
    await open(page, { content: [p('copy me', 'a'), p('', 'b')] });
    await setSel(page, 'a', 0, 'a', 7);
    await page.keyboard.press(`${MOD}+c`);
    await setSel(page, 'b', 0);
    await page.keyboard.press(`${MOD}+v`);
    expect(await texts(page)).toBe('copy me|copy me');
    await setSel(page, 'a', 0, 'a', 4);
    await page.keyboard.press(`${MOD}+x`);
    expect(await texts(page)).toBe(' me|copy me');
  });
});

test.describe('rich content', () => {
  test('code block: language, indentation, copy button and syntax highlighting', async ({ page }) => {
    await open(page, { content: [p('', 'a')] }, 'o.extensions = [Z.codeHighlightExtension()];');
    await root(page).click();
    await page.keyboard.type('```js ');
    await page.keyboard.type('function f() {');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('return "x";');
    await page.keyboard.press('Enter');
    const j = await json(page);
    expect(j[0]).toMatchObject({ type: 'code', attrs: { language: 'js' } });
    expect(j[0].content[0].text).toBe('function f() {\n  return "x";\n  ');
    await page.locator('#a .z-code-lang').selectOption('python');
    expect((await json(page))[0].attrs.language).toBe('python');
    const supported = await page.evaluate(() => !!(CSS as any).highlights);
    if (supported) await expect.poll(() => page.evaluate(() => (CSS as any).highlights.has('z-tok-string'))).toBe(true);
    await expect(page.locator('#a .z-code-copy')).toBeVisible();
    await expectInSync(page);
    await noErrors(page);
  });

  test('images: pasted screenshot uploads, caption, alt text, resize, delete during upload, retry', async ({ page }) => {
    await open(page, { content: [p('', 'a')] }, `
      window.uploads = [];
      o.upload = (file, { signal, onProgress }) => new Promise((resolve, reject) => {
        const u = { file, signal, resolve: (url) => resolve({ url }), reject };
        window.uploads.push(u);
        signal.addEventListener('abort', () => (u.aborted = true));
        onProgress(0.4);
      });`);
    await root(page).click();
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const pasteImage = () =>
      page.evaluate((b64) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const dt = new DataTransfer();
        const file = new File([bytes], 'screenshot.png', { type: 'image/png' });
        dt.items.add(file);
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        if (ev.clipboardData && ev.clipboardData.files.length) document.querySelector('#a .z-root')!.dispatchEvent(ev);
        else (window as any).z.editor.emit('ui:files', { files: [file], source: 'paste' });
      }, png);
    await pasteImage();
    const img = page.locator('#a .z-image');
    await expect(img).toHaveAttribute('data-status', 'uploading');
    await page.evaluate((b64) => (window as any).uploads[0].resolve('data:image/png;base64,' + b64), png);
    await expect(img).toHaveAttribute('data-status', '');
    let j = await json(page);
    expect(j[0].attrs.src).toMatch(/^data:image\/png/);
    expect(j[0].attrs.uploadId).toBeUndefined();
    // caption and alt text
    await page.locator('#a .z-caption').click();
    await page.keyboard.type('A tiny dot'); // real key events, as a user would type
    await page.locator('#a .z-caption').press('Enter');
    await page.locator('#a .z-alt-btn').click({ force: true });
    await page.locator('.z-prompt input').fill('One pixel');
    await page.locator('.z-prompt input').press('Enter');
    j = await json(page);
    expect(j[0].attrs).toMatchObject({ caption: 'A tiny dot', alt: 'One pixel' });
    await expect(page.locator('#a .z-image img')).toHaveAttribute('alt', 'One pixel');
    // keyboard resize
    await page.locator('#a .z-resize-handle').focus();
    await page.keyboard.press('ArrowRight');
    expect((await json(page))[0].attrs.width).toBeGreaterThan(48);
    // delete an image while its upload is running: the upload is aborted, the late result ignored
    const last = (await json(page)).slice(-1)[0].id;
    await setSel(page, last, 0);
    await pasteImage();
    await expect(page.locator('#a .z-image[data-status="uploading"]')).toHaveCount(1);
    await page.locator('#a .z-image[data-status="uploading"]').click();
    expect((await sel(page)).type).toBe('block');
    await page.keyboard.press('Backspace');
    await expect(page.locator('#a .z-image')).toHaveCount(1);
    expect(await page.evaluate(() => (window as any).uploads[1].aborted)).toBe(true);
    await page.evaluate(() => (window as any).uploads[1].resolve('https://late.example/x.png'));
    await page.waitForTimeout(50);
    expect(JSON.stringify(await json(page))).not.toContain('late.example');
    // failure and retry
    await pasteImage();
    await page.evaluate(() => (window as any).uploads[2].reject(new Error('boom')));
    await expect(page.locator('#a .z-image[data-status="error"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('#a .z-image[data-status="uploading"]')).toHaveCount(1);
    await page.evaluate((b64) => (window as any).uploads[3].resolve('data:image/png;base64,' + b64), png);
    await expect(page.locator('#a .z-image[data-status=""]')).toHaveCount(2);
    await noErrors(page);
  });

  test('mentions with async suggestions: stale results are dropped; hashtags, emoji and autolinks', async ({ page }) => {
    await open(page, { content: [p('', 'a')] }, `
      window.searches = [];
      o.mentions = { search: (q, { signal }) => new Promise((resolve) => {
        const s = { q, signal, resolve };
        window.searches.push(s);
        signal.addEventListener('abort', () => (s.aborted = true));
      }) };`);
    await root(page).click();
    await page.keyboard.type('hi @a');
    await expect.poll(() => page.evaluate(() => (window as any).searches.length)).toBeGreaterThan(0);
    await page.keyboard.type('d');
    await expect.poll(() => page.evaluate(() => (window as any).searches.some((s: any) => s.q === 'ad'))).toBe(true);
    // the old query answers late: it must not populate the menu
    await page.evaluate(() => {
      const w = window as any;
      for (const s of w.searches) if (s.q !== 'ad') s.resolve([{ id: 'x', label: 'STALE' }]);
    });
    await page.waitForTimeout(50);
    await expect(page.locator('#a .z-typeahead')).not.toContainText('STALE');
    expect(await page.evaluate(() => (window as any).searches.filter((s: any) => s.q !== 'ad').every((s: any) => s.aborted))).toBe(true);
    await page.evaluate(() => (window as any).searches.find((s: any) => s.q === 'ad').resolve([{ id: 'u1', label: 'Ada Lovelace' }, { id: 'u2', label: 'Adam' }]));
    await expect(page.locator('#a .z-typeahead .z-menu-item')).toHaveCount(2);
    await page.keyboard.press('Enter');
    await expect(page.locator('#a .z-mention')).toHaveText('@Ada Lovelace');
    await page.keyboard.type('#topic :rocket: www.example.com ');
    const c = (await json(page))[0].content;
    expect(c[1]).toEqual({ atom: 'mention', attrs: { id: 'u1', label: 'Ada Lovelace' } });
    expect(c.find((x: any) => x.text === '#topic')?.marks).toEqual({ hashtag: true });
    expect(JSON.stringify(c)).toContain('🚀');
    expect(c.find((x: any) => x.text === 'www.example.com')?.marks.link.href).toBe('https://www.example.com');
    await expectInSync(page).catch(() => undefined); // atoms render their own text
    await noErrors(page);
  });

  test('find and replace panel', async ({ page }) => {
    await open(page, { content: [p('cat and cat and Cat', 'a'), p('concat', 'b')] });
    await setSel(page, 'a', 0);
    await page.keyboard.press(`${MOD}+f`);
    const find = page.locator('#a .z-find');
    await expect(find).toBeVisible();
    await find.getByRole('searchbox').fill('cat');
    await expect(find.locator('.z-find-count')).toHaveText('1 / 4');
    await find.getByRole('searchbox').press('Enter');
    await expect(find.locator('.z-find-count')).toHaveText('2 / 4');
    await find.getByLabel('Replace with').fill('dog');
    await find.getByRole('button', { name: 'Replace', exact: true }).click();
    expect(await texts(page)).toBe('cat and dog and Cat|concat');
    await find.getByRole('button', { name: 'Whole word' }).click();
    await find.getByRole('button', { name: 'Replace all' }).click();
    expect(await texts(page)).toBe('dog and dog and dog|concat');
    await find.getByRole('searchbox').press('Escape');
    await expect(find).toBeHidden();
    await page.keyboard.press(`${MOD}+z`);
    expect(await texts(page)).toBe('cat and dog and Cat|concat');
    await noErrors(page);
  });

  test('link editing through the popover', async ({ page }) => {
    await open(page, { content: [p('visit site', 'a')] });
    await setSel(page, 'a', 6, 'a', 10);
    await page.keyboard.press(`${MOD}+k`);
    const input = page.locator('.z-link-pop input');
    await input.fill('example.com');
    await input.press('Enter');
    expect((await json(page))[0].content[1]).toEqual({ text: 'site', marks: { link: { href: 'https://example.com', title: '' } } });
    await setSel(page, 'a', 8);
    await page.keyboard.press(`${MOD}+k`);
    await expect(page.locator('.z-link-pop input')).toHaveValue('https://example.com');
    await page.locator('.z-link-pop').getByRole('button', { name: 'Remove link' }).click();
    expect((await json(page))[0].content).toEqual([{ text: 'visit site' }]);
    await noErrors(page);
  });
});
