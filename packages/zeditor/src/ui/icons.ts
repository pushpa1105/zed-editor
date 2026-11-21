/**
 * Built-in icon set (24x24, stroke based). Hosts can replace any icon with `setIcons`,
 * or per editor through the `icons` option.
 */
const P = (d: string, extra = '') => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${extra}<path d="${d}"/></svg>`;
const T = (text: string, size = 13) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><text x="12" y="17" text-anchor="middle" font-size="${size}" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">${text}</text></svg>`;

const icons: Record<string, string> = {
  undo: P('M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11'),
  redo: P('m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13'),
  bold: P('M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z'),
  italic: P('M19 4h-9M14 20H5M15 4 9 20'),
  underline: P('M6 4v6a6 6 0 0 0 12 0V4M4 20h16'),
  strike: P('M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16'),
  code: P('m16 18 6-6-6-6M8 6l-6 6 6 6'),
  'code-block': P('m10 9-3 3 3 3M14 15l3-3-3-3M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
  link: P('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'),
  sub: T('x₂'),
  sup: T('x²'),
  color: P('M4 20h16M9 4h6M12 4v10', ''),
  highlight: P('m9 11-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'),
  'list-bullet': P('M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01'),
  'list-ordered': P('M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'),
  'list-check': P('m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8'),
  'align-left': P('M21 6H3M15 12H3M17 18H3'),
  'align-center': P('M21 6H3M17 12H7M19 18H5'),
  'align-right': P('M21 6H3M21 12H9M21 18H7'),
  'align-justify': P('M3 6h18M3 12h18M3 18h18'),
  indent: P('m3 8 4 4-4 4M21 12H11M21 6H11M21 18H11'),
  outdent: P('m7 8-4 4 4 4M21 12H11M21 6H11M21 18H11'),
  table: P('M3 3h18v18H3zM3 9h18M3 15h18M12 3v18'),
  image: P('M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 15l-5-5L5 21'),
  divider: P('M3 12h18'),
  clear: P('M4 7V4h16v3M5 20h6M13 4 8 20M15 15l5 5M20 15l-5 5'),
  text: T('T', 15),
  h1: T('H1', 11),
  h2: T('H2', 11),
  h3: T('H3', 11),
  quote: P('M6 17h3l2-4V7H5v6h3zM14 17h3l2-4V7h-6v6h3z'),
  callout: P('M12 16v-4M12 8h.01M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
  toggle: P('m9 18 6-6-6-6'),
  chevron: P('m9 18 6-6-6-6'),
  columns: P('M3 3h18v18H3zM12 3v18'),
  page: P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6'),
  file: P('M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM13 2v7h7'),
  embed: P('M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM10 9l5 3-5 3z'),
  equation: T('∑', 15),
  comment: P('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'),
  copy: P('M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'),
  trash: P('M3 6h18M19 6l-1 14H6L5 6M8 6V4h8v2M10 11v6M14 11v6'),
  up: P('m18 15-6-6-6 6'),
  down: P('m6 9 6 6 6-6'),
  plus: P('M12 5v14M5 12h14'),
  grip: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`,
  search: P('m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14'),
  close: P('M18 6 6 18M6 6l12 12'),
  check: P('M20 6 9 17l-5-5'),
  more: P('M12 12h.01M19 12h.01M5 12h.01'),
  external: P('M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'),
  merge: P('M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M8 12h8M13 9l3 3-3 3M11 9l-3 3 3 3'),
};

/** Replace or add icons globally. Values are SVG markup (trusted, provided by the host). */
export function setIcons(map: Record<string, string>): void {
  Object.assign(icons, map);
}
/** SVG markup for an icon name; raw markup (starting with '<') is returned unchanged. */
export function icon(name: string | undefined, overrides?: Record<string, string>): string {
  if (!name) return '';
  if (name.trim().startsWith('<')) return name;
  return overrides?.[name] ?? icons[name] ?? '';
}
