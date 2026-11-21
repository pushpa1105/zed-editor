import { Page, expect } from '@playwright/test';

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

export async function open(page: Page, options: Record<string, any> = {}, setup?: string) {
  await page.goto('/packages/zeditor/test/browser/harness.html');
  await page.waitForFunction(() => (window as any).ready === true);
  await page.evaluate(
    ([opts, code]) => {
      const w = window as any;
      const o: any = { ...(opts as any) };
      if (code) new Function('o', 'Z', 'shared', code as string)(o, w.Z, w.shared);
      w.mount(o);
    },
    [options, setup ?? ''] as const,
  );
}
export const root = (page: Page) => page.locator('#a .z-root');
export const json = (page: Page) => page.evaluate(() => (window as any).z.getJSON().blocks);
export const sel = (page: Page) => page.evaluate(() => (window as any).z.editor.selection);
/** texts of all text blocks joined by | */
export const texts = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const b of (window as any).z.editor.doc.descendants()) if (b.content) out.push(b.text);
    return out.join('|');
  });
export const domText = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('#a .z-content')).map((e) => (e as HTMLElement).innerText.replace(/\n$/, '')).join('|'));
export async function setSel(page: Page, a: string, ao: number, f = a, fo = ao) {
  await page.evaluate(([a, ao, f, fo]) => {
    const z = (window as any).z;
    z.focus();
    z.editor.setSelection({ type: 'text', anchor: { id: a, offset: ao }, focus: { id: f, offset: fo } });
    z.view.syncSelectionToDOM(true);
  }, [a, ao, f, fo] as const);
}
/** model and DOM must describe the same text */
export async function expectInSync(page: Page) {
  expect(await domText(page)).toBe(await texts(page));
}
export const noErrors = async (page: Page) => expect(await page.evaluate(() => (window as any).errors)).toEqual([]);
export const p = (text: string, id: string) => ({ id, type: 'paragraph', content: text ? [{ text }] : [] });
