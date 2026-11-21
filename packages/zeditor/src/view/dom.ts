export type Child = Node | string | null | undefined | false;

/** Tiny hyperscript helper. `class`, `style` (string), `dataset`, `on*` listeners and attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Record<string, any> | null, ...children: Child[]): HTMLElementTagNameMap[K];
export function h(tag: string, props?: Record<string, any> | null, ...children: Child[]): HTMLElement;
export function h(tag: string, props?: Record<string, any> | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (props)
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'dataset') for (const d in v) el.dataset[d] = v[d];
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v; // only used with trusted, static markup (icons)
      else if (k === 'text') el.textContent = v;
      else if (k in el && k !== 'list' && k !== 'form' && typeof v !== 'string') (el as any)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '');

/** 'Mod-Shift-z' style key name for a keyboard event. */
export function keyName(e: KeyboardEvent): string {
  let k = e.key;
  if (k === ' ' || k === 'Spacebar') k = ' ';
  if (k.length === 1) k = k.toLowerCase();
  // with Alt held, e.key may be a composed character (macOS): fall back to the physical key
  if ((e.altKey || (e.shiftKey && k.length === 1 && !/[a-z]/.test(k))) && e.code) {
    if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
    else if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3).toLowerCase();
  }
  const mod = isMac ? e.metaKey : e.ctrlKey;
  return (mod ? 'Mod-' : '') + (e.altKey ? 'Alt-' : '') + (e.shiftKey ? 'Shift-' : '') + k;
}

/** Human readable shortcut, e.g. 'Mod-Shift-z' -> 'Ctrl+Shift+Z' / '⌘⇧Z'. */
export function formatShortcut(s: string): string {
  const parts = s.split('-');
  const key = parts.pop()!;
  const names = parts.map((p) => (p === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : p === 'Shift' ? (isMac ? '⇧' : 'Shift') : p === 'Alt' ? (isMac ? '⌥' : 'Alt') : p));
  names.push(key.length === 1 ? key.toUpperCase() : key);
  return names.join(isMac ? '' : '+');
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Position a floating element near an anchor rect, kept inside the viewport. Uses fixed positioning. */
export function place(el: HTMLElement, anchor: { left: number; top: number; bottom: number; right?: number }, opts: { above?: boolean; align?: 'start' | 'center' } = {}): void {
  el.style.position = 'fixed';
  el.style.left = '0px';
  el.style.top = '0px';
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let left = opts.align === 'center' ? (anchor.left + (anchor.right ?? anchor.left)) / 2 - r.width / 2 : anchor.left;
  left = clamp(left, 8, Math.max(8, vw - r.width - 8));
  let top = opts.above ? anchor.top - r.height - 8 : anchor.bottom + 6;
  if (opts.above && top < 8) top = anchor.bottom + 6;
  if (!opts.above && top + r.height > vh - 8 && anchor.top - r.height - 8 > 8) top = anchor.top - r.height - 8;
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(Math.max(8, top)) + 'px';
}
