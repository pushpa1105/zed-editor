import type { Block, DocJSON } from './model';
import type { MarkSpec, NodeSpec, Schema } from './schema';
import type { CommandFn, Editor, EditorMode, Transaction } from './editor';

/** Engine extension API version. Bumped on breaking changes to the extension contract. */
export const API_VERSION = 1;

export interface InputRule {
  name?: string;
  /** tested against the text of the current block before the caret (must end with `$`) */
  match: RegExp;
  /** apply the rule; `from`/`to` are offsets of the match in `block` */
  run: (editor: Editor, match: RegExpExecArray, ctx: { block: Block; from: number; to: number }) => boolean;
  /** also run inside code blocks (default false) */
  inCode?: boolean;
}

export interface PasteData {
  text: string;
  html: string;
  files: File[];
  /** internal structured clipboard payload, if present */
  json?: any;
}
export interface PasteRule {
  name?: string;
  /** handle the paste and return true to stop further processing */
  run: (editor: Editor, data: PasteData) => boolean;
}

export interface ToolbarItem {
  id: string;
  /** items with the same group are rendered together */
  group?: string;
  /** label key (looked up in editor labels) or literal text */
  label: string;
  /** icon name from the icon set, or raw SVG markup */
  icon?: string;
  type?: 'button' | 'select' | 'color' | 'custom';
  /** command name to execute, with `args` */
  command?: string;
  args?: any[];
  run?: (editor: Editor, value?: any) => void;
  active?: (editor: Editor) => boolean;
  enabled?: (editor: Editor) => boolean;
  /** select / color: current value */
  value?: (editor: Editor) => string;
  options?: { value: string; label: string }[];
  /** custom: build the control */
  render?: (editor: Editor) => HTMLElement;
  shortcut?: string;
  /** show in the floating selection toolbar too */
  floating?: boolean;
  order?: number;
}

export interface SlashItem {
  id: string;
  title: string;
  description?: string;
  keywords?: string[];
  icon?: string;
  group?: string;
  /** insert / convert. `blockId` is the block that held the slash query (already cleared). */
  run: (editor: Editor, ctx: { blockId: string }) => void;
  order?: number;
}

export interface BlockAction {
  id: string;
  label: string;
  icon?: string;
  run: (editor: Editor, ids: string[]) => void;
  enabled?: (editor: Editor, ids: string[]) => boolean;
}

export interface TypeaheadItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  [extra: string]: any;
}
export interface TypeaheadSource {
  name: string;
  /** character that opens the menu, e.g. '@' */
  trigger: string;
  /** allow spaces inside the query (default false) */
  allowSpaces?: boolean;
  /** only open at block start (slash menu style) */
  debounce?: number;
  /** may be async; `signal` aborts when the query changes or the menu closes */
  search: (query: string, ctx: { signal: AbortSignal; editor: Editor }) => TypeaheadItem[] | Promise<TypeaheadItem[]>;
  /** replace the query range [from, to) in block `id` */
  select: (editor: Editor, item: TypeaheadItem, range: { id: string; from: number; to: number }) => void;
  renderItem?: (item: TypeaheadItem) => HTMLElement | string;
  emptyLabel?: string;
}

export interface Extension {
  name: string;
  /** informational package version */
  version?: string;
  /** version of this extension's node data; saved into documents and passed to `migrate` */
  schemaVersion?: number;
  /** engine extension API version this extension was written for (default: current) */
  apiVersion?: number;
  /** names of extensions that must be installed (and set up first) */
  requires?: string[];
  /** higher priority keymaps / rules run first (default 0) */
  priority?: number;
  /** allow replacing node / mark / command definitions registered by earlier extensions */
  override?: boolean;
  nodes?: NodeSpec[];
  marks?: MarkSpec[];
  /** add behaviour to an existing node without replacing it */
  extendNode?: Record<string, (spec: NodeSpec) => NodeSpec>;
  extendMark?: Record<string, (spec: MarkSpec) => MarkSpec>;
  commands?: Record<string, CommandFn>;
  /** key (e.g. 'Mod-b', 'Shift-Enter') -> command name or handler returning true when handled */
  keymap?: Record<string, string | ((editor: Editor, event?: any) => boolean)>;
  inputRules?: InputRule[];
  pasteRules?: PasteRule[];
  toolbar?: ToolbarItem[];
  slashItems?: SlashItem[];
  blockActions?: BlockAction[];
  typeahead?: TypeaheadSource[];
  labels?: Record<string, string>;
  /** upgrade documents saved with an older `schemaVersion` of this extension */
  migrate?: (doc: DocJSON, fromVersion: number) => DocJSON;
  /** structural fix-ups run inside each transaction; return true if steps were added */
  normalize?: (tr: Transaction) => boolean | void;
  /** called once per editor; return a cleanup function */
  setup?: (editor: Editor) => void | (() => void);
}

export interface ResolvedExtensions {
  extensions: Extension[];
  commands: Record<string, CommandFn>;
  keymaps: { key: string; run: (editor: Editor, event?: any) => boolean; priority: number; ext: string }[];
  inputRules: InputRule[];
  pasteRules: PasteRule[];
  toolbar: ToolbarItem[];
  slashItems: SlashItem[];
  blockActions: BlockAction[];
  typeaheads: TypeaheadSource[];
  labels: Record<string, string>;
  normalizers: ((tr: Transaction) => boolean | void)[];
}

/** Normalize 'ctrl+B', 'Mod-b', 'Cmd-Shift-Z' to 'Mod-Shift-z' style with fixed modifier order. */
export function normalizeKey(key: string): string {
  const parts = key.split(/[-+](?!$)/);
  let k = parts.pop()!;
  if (k.length === 1) k = k.toLowerCase();
  if (k === 'Space') k = ' ';
  const mods = new Set(
    parts.map((p) => {
      const m = p.toLowerCase();
      if (m === 'cmd' || m === 'meta' || m === 'ctrl' || m === 'control' || m === 'mod') return 'Mod';
      if (m === 'alt' || m === 'option') return 'Alt';
      if (m === 'shift') return 'Shift';
      return p;
    }),
  );
  return (mods.has('Mod') ? 'Mod-' : '') + (mods.has('Alt') ? 'Alt-' : '') + (mods.has('Shift') ? 'Shift-' : '') + k;
}

/**
 * Order extensions (dependencies first, then by priority), detect conflicts and merge their
 * contributions. An extension with the same name as an earlier one replaces it, which lets
 * hosts reconfigure a default extension.
 */
export function resolveExtensions(list: Extension[], schema: Schema): ResolvedExtensions {
  const byName = new Map<string, Extension>();
  for (const e of list) {
    if (!e || !e.name) throw new Error('zeditor: extension without a name');
    if ((e.apiVersion ?? API_VERSION) > API_VERSION)
      throw new Error(`zeditor: extension "${e.name}" needs extension API v${e.apiVersion}, this engine provides v${API_VERSION}`);
    byName.delete(e.name);
    byName.set(e.name, e);
  }
  const ordered: Extension[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (e: Extension, chain: string[]) => {
    const s = state.get(e.name);
    if (s === 2) return;
    if (s === 1) throw new Error(`zeditor: circular extension dependency: ${[...chain, e.name].join(' -> ')}`);
    state.set(e.name, 1);
    for (const dep of e.requires ?? []) {
      const d = byName.get(dep);
      if (!d) throw new Error(`zeditor: extension "${e.name}" requires "${dep}", which is not installed`);
      visit(d, [...chain, e.name]);
    }
    state.set(e.name, 2);
    ordered.push(e);
  };
  for (const e of byName.values()) visit(e, []);

  const out: ResolvedExtensions = {
    extensions: ordered,
    commands: {},
    keymaps: [],
    inputRules: [],
    pasteRules: [],
    toolbar: [],
    slashItems: [],
    blockActions: [],
    typeaheads: [],
    labels: {},
    normalizers: [],
  };
  const owner = new Map<string, string>();
  const claim = (kind: string, name: string, e: Extension) => {
    const key = kind + ':' + name;
    const prev = owner.get(key);
    if (prev && prev !== e.name && !e.override)
      throw new Error(`zeditor: ${kind} "${name}" is defined by both "${prev}" and "${e.name}". Set \`override: true\` on "${e.name}" to replace it.`);
    owner.set(key, e.name);
  };
  for (const e of ordered) {
    for (const n of e.nodes ?? []) {
      claim('node', n.type, e);
      schema.nodes.set(n.type, { ...n, extension: e.name });
    }
    for (const m of e.marks ?? []) {
      claim('mark', m.type, e);
      schema.marks.set(m.type, { ...m, extension: e.name });
    }
    for (const t in e.extendNode ?? {}) {
      const cur = schema.nodes.get(t);
      if (!cur) throw new Error(`zeditor: extension "${e.name}" extends unknown node "${t}"`);
      schema.nodes.set(t, e.extendNode![t](cur));
    }
    for (const t in e.extendMark ?? {}) {
      const cur = schema.marks.get(t);
      if (!cur) throw new Error(`zeditor: extension "${e.name}" extends unknown mark "${t}"`);
      schema.marks.set(t, e.extendMark![t](cur));
    }
    for (const c in e.commands ?? {}) {
      claim('command', c, e);
      out.commands[c] = e.commands![c];
    }
    if (e.schemaVersion !== undefined) schema.extensionVersions[e.name] = e.schemaVersion;
    if (e.migrate) schema.extensionMigrations[e.name] = e.migrate;
    Object.assign(out.labels, e.labels);
    if (e.normalize) out.normalizers.push(e.normalize);
    const replaceById = <T extends { id: string }>(arr: T[], items: T[] | undefined) => {
      for (const it of items ?? []) {
        const i = arr.findIndex((x) => x.id === it.id);
        if (i >= 0) arr[i] = it;
        else arr.push(it);
      }
    };
    replaceById(out.toolbar, e.toolbar);
    replaceById(out.slashItems, e.slashItems);
    replaceById(out.blockActions, e.blockActions);
    for (const t of e.typeahead ?? []) {
      const i = out.typeaheads.findIndex((x) => x.name === t.name);
      if (i >= 0) out.typeaheads[i] = t;
      else out.typeaheads.push(t);
    }
  }
  // priority-ordered behaviour: higher first; later-registered first among equals
  const byPriority = [...ordered].reverse().sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const e of byPriority) {
    for (const k in e.keymap ?? {}) {
      const v = e.keymap![k];
      const run = typeof v === 'string' ? (ed: Editor) => ed.exec(v) : v;
      out.keymaps.push({ key: normalizeKey(k), run, priority: e.priority ?? 0, ext: e.name });
    }
    out.inputRules.push(...(e.inputRules ?? []));
    out.pasteRules.push(...(e.pasteRules ?? []));
  }
  const ord = (a: { order?: number }, b: { order?: number }) => (a.order ?? 100) - (b.order ?? 100);
  out.toolbar.sort(ord);
  out.slashItems.sort(ord);
  return out;
}

export function defineExtension<T extends Extension>(ext: T): T {
  return ext;
}
export type { EditorMode };
