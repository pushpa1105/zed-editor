/**
 * Optional syntax highlighting for code blocks. Loaded only when imported.
 *
 * A small generic tokenizer (comments, strings, numbers, keywords, function calls, tags)
 * covers the common languages. Tokens are painted with the CSS Custom Highlight API, so the
 * editable DOM is never modified; browsers without that API show plain code.
 * Hosts with heavier needs can register their own tokenizer per language.
 */
import type { Extension } from './core/extension';
import type { Editor } from './core/editor';
import type { HighlightRange } from './view/view';

export type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'tag';
export interface Token {
  from: number;
  to: number;
  type: TokenType;
}
export type Tokenizer = (code: string) => Token[];

const KW: Record<string, string> = {
  javascript:
    'async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield',
  typescript:
    'abstract any as async await boolean break case catch class const continue declare default delete do else enum export extends false finally for from function if implements import in infer instanceof interface is keyof let namespace never new null number of private protected public readonly return static string super switch this throw true try type typeof undefined unknown var void while yield',
  python:
    'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self',
  java: 'abstract boolean break byte case catch char class const continue default do double else enum extends false final finally float for if implements import instanceof int interface long native new null package private protected public return short static super switch synchronized this throw throws true try var void volatile while',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while NULL',
  cpp: 'auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false float for friend if inline int long namespace new noexcept nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while',
  csharp:
    'abstract as async await base bool break byte case catch char class const continue decimal default delegate do double else enum event false finally float for foreach get if in int interface internal is long namespace new null object out override private protected public readonly ref return set static string struct switch this throw true try typeof using var virtual void while',
  go: 'break case chan const continue default defer else fallthrough false for func go goto if import interface map nil package range return select struct switch true type var',
  rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  ruby: 'alias and begin break case class def do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true unless until when while yield',
  php: 'abstract and array as break case catch class const continue declare default do echo else elseif extends false final finally fn for foreach function global if implements include interface namespace new null or private protected public require return static switch throw true try use var while',
  sql: 'select from where and or not insert into values update set delete create table alter drop index join left right inner outer on as group by order having limit offset union distinct null is in like between case when then else end primary key foreign references default',
  bash: 'if then else elif fi for while until do done case esac function in return exit export local readonly echo cd',
  swift: 'as break case catch class continue default defer do else enum extension false for func guard if import in init let nil private protocol public return self static struct super switch throw true try var where while',
  kotlin: 'as break class continue do else false for fun if in interface is null object override package private protected public return super this throw true try typealias val var when while',
  json: 'true false null',
  yaml: 'true false null yes no',
};
const HASH_COMMENT = new Set(['python', 'ruby', 'bash', 'yaml']);
const DASH_COMMENT = new Set(['sql']);
const MARKUP = new Set(['html', 'xml']);
const kwCache = new Map<string, Set<string>>();

function markup(code: string): Token[] {
  const out: Token[] = [];
  const re = /<!--[\s\S]*?-->|<\/?[A-Za-z][\w:-]*|\/?>|"[^"]*"|'[^']*'/g;
  let m: RegExpExecArray | null;
  let inTag = false;
  while ((m = re.exec(code))) {
    const t = m[0];
    if (t.startsWith('<!--')) out.push({ from: m.index, to: m.index + t.length, type: 'comment' });
    else if (t[0] === '<') {
      inTag = true;
      out.push({ from: m.index, to: m.index + t.length, type: 'tag' });
    } else if (t === '>' || t === '/>') {
      if (inTag) out.push({ from: m.index, to: m.index + t.length, type: 'tag' });
      inTag = false;
    } else if (inTag) out.push({ from: m.index, to: m.index + t.length, type: 'string' });
  }
  return out;
}

/** Built-in tokenizer. Unknown languages get strings / numbers / comments only. */
export function tokenize(code: string, language: string): Token[] {
  const lang = language === 'js' || language === 'jsx' ? 'javascript' : language === 'ts' || language === 'tsx' ? 'typescript' : language === 'py' ? 'python' : language === 'sh' || language === 'shell' ? 'bash' : language === 'c++' ? 'cpp' : language === 'c#' ? 'csharp' : language;
  if (lang === 'plain' || lang === 'markdown' || !code) return [];
  if (MARKUP.has(lang)) return markup(code);
  let kws = kwCache.get(lang);
  if (!kws) kwCache.set(lang, (kws = new Set((KW[lang] ?? '').split(' ').filter(Boolean))));
  const ci = lang === 'sql';
  const line = HASH_COMMENT.has(lang) ? '#[^\\n]*' : DASH_COMMENT.has(lang) ? '--[^\\n]*' : lang === 'css' ? '(?!)' : '\\/\\/[^\\n]*';
  const block = HASH_COMMENT.has(lang) ? '(?!)' : '\\/\\*[\\s\\S]*?(?:\\*\\/|$)';
  const re = new RegExp(`(${line}|${block})|("(?:[^"\\\\\\n]|\\\\.)*"?|'(?:[^'\\\\\\n]|\\\\.)*'?|\`(?:[^\`\\\\]|\\\\.)*\`?)|(\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b|\\b0x[\\da-fA-F]+\\b)|([A-Za-z_$][\\w$]*)(\\s*\\()?`, 'g');
  const out: Token[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    if (m[1]) out.push({ from: m.index, to: m.index + m[1].length, type: 'comment' });
    else if (m[2]) out.push({ from: m.index, to: m.index + m[2].length, type: 'string' });
    else if (m[3]) out.push({ from: m.index, to: m.index + m[3].length, type: 'number' });
    else if (m[4]) {
      const word = ci ? m[4].toLowerCase() : m[4];
      if (kws.has(word)) out.push({ from: m.index, to: m.index + m[4].length, type: 'keyword' });
      else if (m[5]) out.push({ from: m.index, to: m.index + m[4].length, type: 'function' });
      if (m[5]) re.lastIndex -= m[5].length;
    }
  }
  return out;
}

export interface CodeHighlightOptions {
  /** custom tokenizers by language name; they take precedence over the built-in one */
  tokenizers?: Record<string, Tokenizer>;
  /** skip highlighting for code blocks longer than this many characters (default 20000) */
  maxLength?: number;
}

export function codeHighlightExtension(opts: CodeHighlightOptions = {}): Extension {
  return {
    name: 'codeHighlight',
    requires: ['code'],
    setup: (editor: Editor) => {
      const max = opts.maxLength ?? 20000;
      // tokens are cached per block content array (replaced on every edit)
      const cache = new WeakMap<object, Token[]>();
      let off: (() => void) | null = null;
      const attach = (view: any) => {
        off?.();
        off = view.addHighlightSource('code', () => {
          const out: Record<string, HighlightRange[]> = {};
          for (const b of editor.doc.descendants()) {
            if (b.type !== 'code' || !b.content || !b.length || b.length > max) continue;
            let tokens = cache.get(b.content);
            if (!tokens) {
              const lang = b.attrs.language ?? 'plain';
              const text = b.text;
              try {
                tokens = (opts.tokenizers?.[lang] ?? ((c: string) => tokenize(c, lang)))(text);
              } catch {
                tokens = [];
              }
              cache.set(b.content, tokens);
            }
            for (const t of tokens) (out['z-tok-' + t.type] ??= []).push({ id: b.id, from: t.from, to: t.to });
          }
          return out;
        });
      };
      if (editor.view) attach(editor.view);
      const offMount = editor.on('mount', (ev: any) => attach(ev.view));
      // language changes do not replace the content array: drop cached tokens for that block
      const offChange = editor.on('transaction', (ev) => {
        for (const id of ev.tr.dirty) {
          const b = editor.doc.get(id);
          if (b?.type === 'code' && b.content) cache.delete(b.content);
        }
      });
      return () => {
        off?.();
        offMount();
        offChange();
      };
    },
  };
}
