/**
 * A small, safe expression language for database formula properties. Parsed by hand
 * (no `eval`, no `Function`): numbers, strings, booleans, `prop("Name")`, arithmetic,
 * comparisons, `and` / `or` / `not`, and a fixed set of functions.
 *
 *   prop("Points") * 2
 *   if(prop("Done"), "✔ " + prop("Name"), prop("Name"))
 *   round(prop("Price") * prop("Qty"), 2)
 *   dateDiff(prop("Due"), today())
 */
export type FormulaValue = number | string | boolean | null;
type Node =
  | { k: 'lit'; v: FormulaValue }
  | { k: 'prop'; name: string }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] };

export class FormulaError extends Error {}

function tokenize(src: string): { t: string; v: string }[] {
  const out: { t: string; v: string }[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|&&|\|\||[-+*/%()<>,!]))/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new FormulaError(`Unexpected "${src.slice(i).trim()[0]}"`);
    i = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'num', v: m[1] });
    else if (m[2] !== undefined || m[3] !== undefined) out.push({ t: 'str', v: (m[2] ?? m[3]).replace(/\\(.)/g, '$1') });
    else if (m[4] !== undefined) out.push({ t: 'id', v: m[4] });
    else out.push({ t: 'op', v: m[5] });
    if (out.length > 500) throw new FormulaError('Formula too long');
  }
  return out;
}

const PREC: Record<string, number> = { or: 1, '||': 1, and: 2, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p];
    if (!t || (v !== undefined && t.v !== v)) throw new FormulaError(v ? `Expected "${v}"` : 'Unexpected end');
    p++;
    return t;
  };
  const primary = (): Node => {
    if (++depth > 60) throw new FormulaError('Formula too deeply nested');
    const t = eat();
    let node: Node;
    if (t.t === 'num') node = { k: 'lit', v: Number(t.v) };
    else if (t.t === 'str') node = { k: 'lit', v: t.v };
    else if (t.t === 'op' && t.v === '(') {
      node = expr(0);
      eat(')');
    } else if (t.t === 'op' && (t.v === '-' || t.v === '!')) node = { k: 'un', op: t.v, a: primary() };
    else if (t.t === 'id') {
      const name = t.v;
      if (name === 'true' || name === 'false') node = { k: 'lit', v: name === 'true' };
      else if (name === 'not') node = { k: 'un', op: '!', a: primary() };
      else if (peek()?.v === '(') {
        eat('(');
        const args: Node[] = [];
        if (peek()?.v !== ')')
          do args.push(expr(0));
          while (peek()?.v === ',' && eat(','));
        eat(')');
        if (name === 'prop') {
          if (args.length !== 1 || args[0].k !== 'lit' || typeof args[0].v !== 'string') throw new FormulaError('prop() takes a property name in quotes');
          node = { k: 'prop', name: args[0].v };
        } else {
          if (name !== 'if' && !Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) throw new FormulaError('Unknown function ' + name + '()');
          node = { k: 'call', fn: name, args };
        }
      } else throw new FormulaError(`Unknown name "${name}" — use prop("${name}")`);
    } else throw new FormulaError(`Unexpected "${t.v}"`);
    depth--;
    return node;
  };
  const expr = (min: number): Node => {
    let left = primary();
    for (;;) {
      const t = peek();
      const op = t && (t.t === 'op' || (t.t === 'id' && (t.v === 'and' || t.v === 'or'))) ? t.v : null;
      const prec = op ? PREC[op] : undefined;
      if (!op || prec === undefined || prec < min) break;
      eat();
      left = { k: 'bin', op, a: left, b: expr(prec + 1) };
    }
    return left;
  };
  if (!toks.length) return { k: 'lit', v: null };
  const ast = expr(0);
  if (p < toks.length) throw new FormulaError(`Unexpected "${toks[p].v}"`);
  return ast;
}

const num = (v: FormulaValue): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : v == null || v === '' ? 0 : Number(v));
const str = (v: FormulaValue): string => (v == null ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));
const truthy = (v: FormulaValue): boolean => !(v == null || v === false || v === '' || v === 0);
const days = (s: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : NaN;
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const FUNCTIONS: Record<string, (a: FormulaValue[]) => FormulaValue> = {
  concat: (a) => a.map(str).join(''),
  length: (a) => [...str(a[0])].length,
  lower: (a) => str(a[0]).toLowerCase(),
  upper: (a) => str(a[0]).toUpperCase(),
  contains: (a) => str(a[0]).toLowerCase().includes(str(a[1]).toLowerCase()),
  replace: (a) => str(a[0]).split(str(a[1])).join(str(a[2])),
  empty: (a) => !truthy(a[0]),
  toNumber: (a) => {
    const n = Number(a[0]);
    return Number.isFinite(n) ? n : null;
  },
  round: (a) => {
    const f = 10 ** Math.max(0, Math.min(10, Math.trunc(num(a[1] ?? 0))));
    return Math.round(num(a[0]) * f) / f;
  },
  floor: (a) => Math.floor(num(a[0])),
  ceil: (a) => Math.ceil(num(a[0])),
  abs: (a) => Math.abs(num(a[0])),
  min: (a) => (a.length ? Math.min(...a.map(num)) : null),
  max: (a) => (a.length ? Math.max(...a.map(num)) : null),
  today: () => iso(new Date()),
  now: () => iso(new Date()),
  /** whole days from the second date to the first */
  dateDiff: (a) => {
    const d = days(str(a[0])) - days(str(a[1]));
    return Number.isFinite(d) ? d : null;
  },
  dateAdd: (a) => {
    const d = days(str(a[0]));
    return Number.isFinite(d) ? new Date((d + Math.trunc(num(a[1]))) * 86400000).toISOString().slice(0, 10) : null;
  },
};
export const FORMULA_FUNCTIONS = ['if', ...Object.keys(FUNCTIONS)];

export function evaluate(node: Node, prop: (name: string) => FormulaValue): FormulaValue {
  switch (node.k) {
    case 'lit':
      return node.v;
    case 'prop':
      return prop(node.name);
    case 'un': {
      const a = evaluate(node.a, prop);
      return node.op === '-' ? -num(a) : !truthy(a);
    }
    case 'call': {
      if (node.fn === 'if') {
        if (node.args.length < 2) throw new FormulaError('if(condition, then, else)');
        return truthy(evaluate(node.args[0], prop)) ? evaluate(node.args[1], prop) : node.args[2] ? evaluate(node.args[2], prop) : null;
      }
      const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, node.fn) ? FUNCTIONS[node.fn] : null;
      if (!fn) throw new FormulaError(`Unknown function ${node.fn}()`);
      return fn(node.args.map((x) => evaluate(x, prop)));
    }
    case 'bin': {
      const { op } = node;
      if (op === 'and' || op === '&&') return truthy(evaluate(node.a, prop)) && truthy(evaluate(node.b, prop));
      if (op === 'or' || op === '||') return truthy(evaluate(node.a, prop)) || truthy(evaluate(node.b, prop));
      const a = evaluate(node.a, prop);
      const b = evaluate(node.b, prop);
      const bothNum = typeof a === 'number' && typeof b === 'number';
      switch (op) {
        case '+':
          return bothNum || (typeof a !== 'string' && typeof b !== 'string') ? num(a) + num(b) : str(a) + str(b);
        case '-':
          return num(a) - num(b);
        case '*':
          return num(a) * num(b);
        case '/':
          return num(b) === 0 ? null : num(a) / num(b);
        case '%':
          return num(b) === 0 ? null : num(a) % num(b);
        case '==':
          return bothNum ? a === b : str(a) === str(b);
        case '!=':
          return bothNum ? a !== b : str(a) !== str(b);
        case '<':
          return bothNum ? a < b : str(a) < str(b);
        case '>':
          return bothNum ? a > b : str(a) > str(b);
        case '<=':
          return bothNum ? a <= b : str(a) <= str(b);
        case '>=':
          return bothNum ? a >= b : str(a) >= str(b);
      }
      throw new FormulaError(`Unknown operator ${op}`);
    }
  }
}

const cache = new Map<string, Node | FormulaError>();
/** Parse (cached) and evaluate. Errors are returned as a `#ERR: …` string, never thrown. */
export function runFormula(src: string, prop: (name: string) => FormulaValue): FormulaValue {
  let ast = cache.get(src);
  if (!ast) {
    try {
      ast = parseFormula(src);
    } catch (e) {
      ast = e instanceof FormulaError ? e : new FormulaError('Invalid formula');
    }
    if (cache.size > 500) cache.clear();
    cache.set(src, ast);
  }
  if (ast instanceof FormulaError) return '#ERR: ' + ast.message;
  try {
    const v = evaluate(ast, prop);
    return typeof v === 'number' && !Number.isFinite(v) ? null : v;
  } catch (e: any) {
    return '#ERR: ' + (e instanceof FormulaError ? e.message : 'evaluation failed');
  }
}
/** `null` when the formula parses, otherwise the error message (for editors). */
export function checkFormula(src: string): string | null {
  try {
    parseFormula(src);
    return null;
  } catch (e: any) {
    return e?.message ?? 'Invalid formula';
  }
}
