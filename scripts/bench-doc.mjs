// Deterministic documents for benchmarks and profiling.
function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(' ');
/** Deterministic document: paragraphs (some formatted), headings, list items, a table every 200 blocks. */
export function makeDoc(n, seed = 42) {
  const r = mulberry(seed);
  const words = (k) => Array.from({ length: k }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ');
  const blocks = [];
  for (let i = 0; i < n; i++) {
    const id = 'b' + i;
    const kind = r();
    if (i % 200 === 199) {
      blocks.push({ id, type: 'table', children: [0, 1, 2].map((row) => ({ id: `${id}r${row}`, type: 'table_row', children: [0, 1, 2].map((c) => ({ id: `${id}r${row}c${c}`, type: 'table_cell', children: [{ id: `${id}r${row}c${c}p`, type: 'paragraph', content: [{ text: words(3) }] }] })) })) });
    } else if (kind < 0.1) blocks.push({ id, type: 'heading', attrs: { level: 2 }, content: [{ text: words(5) }] });
    else if (kind < 0.3) blocks.push({ id, type: 'list', attrs: { kind: 'bullet' }, content: [{ text: words(10) }] });
    else blocks.push({ id, type: 'paragraph', content: [{ text: words(12) + ' ' }, { text: words(4), marks: { bold: true } }, { text: ' ' + words(14) }] });
  }
  return blocks;
}
