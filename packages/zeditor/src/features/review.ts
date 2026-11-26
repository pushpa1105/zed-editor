/**
 * Review features: anchored comment threads, suggestions (track changes) and restorable versions.
 *
 * Anchors are marks on the text, so they move with it:
 *  - text typed inside a commented range joins the range; text typed at its edges does not
 *  - moving / cutting and pasting the text inside the same editor moves the anchor
 *  - copying it duplicates the anchor (a thread may have several ranges)
 *  - deleting all anchored text orphans the thread: it stays in the store with its original
 *    quote and is reported with `anchored: false`; undoing the deletion re-anchors it
 */
import { Inline, MarkSet, newId, sliceInline, contentText, isAtom } from '../core/model';
import type { Editor } from '../core/editor';
import type { Extension } from '../core/extension';
import type { DocJSON } from '../core/model';
import { selectedRanges } from '../core/commands';
import { textSel } from '../core/selection';
import { esc } from '../core/html';

export interface ReviewUser {
  id: string;
  name: string;
  color?: string;
}

/* ------------------------------------------------------------------ permissions */

export interface Permissions {
  /** may change the document at all */
  canEdit?: (user: ReviewUser) => boolean;
  canComment?: (user: ReviewUser) => boolean;
  /** may resolve / delete threads or comments written by someone else */
  canModerate?: (user: ReviewUser) => boolean;
  /** may accept or reject suggestions */
  canReview?: (user: ReviewUser) => boolean;
}
const allow = () => true;

/* ------------------------------------------------------------------ comments */

export interface Comment {
  id: string;
  author: ReviewUser;
  body: string;
  createdAt: number;
  editedAt?: number;
}
export interface CommentThread {
  id: string;
  /** text that was selected when the thread was created */
  quote: string;
  comments: Comment[];
  resolved: boolean;
  createdAt: number;
}
/** Host storage adapter for threads. The default keeps them in memory. */
export interface CommentStore {
  list(): CommentThread[];
  get(id: string): CommentThread | undefined;
  put(thread: CommentThread): void;
  remove(id: string): void;
  subscribe(fn: () => void): () => void;
}
export function memoryCommentStore(initial: CommentThread[] = []): CommentStore {
  const map = new Map(initial.map((t) => [t.id, t]));
  const subs = new Set<() => void>();
  const fire = () => subs.forEach((f) => f());
  return {
    list: () => [...map.values()].sort((a, b) => a.createdAt - b.createdAt),
    get: (id) => map.get(id),
    put: (t) => {
      map.set(t.id, t);
      fire();
    },
    remove: (id) => {
      if (map.delete(id)) fire();
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export const commentsExtension: Extension = {
  name: 'comments',
  requires: ['base'],
  marks: [
    {
      type: 'comment',
      rank: 5,
      inclusive: false,
      attrs: { ids: { validate: (x) => (Array.isArray(x) ? x.filter((i) => typeof i === 'string' && /^[\w:.-]{1,64}$/.test(i)).slice(0, 50) : undefined) } },
      toHTML: (x) => [`<span data-comment="${esc((x.ids ?? []).join(' '))}">`, '</span>'],
      toMarkdown: () => ['', ''],
      parseHTML: [{ tag: 'span', match: (el) => !!el.attrs['data-comment'], getAttrs: (el) => ({ ids: el.attrs['data-comment'].split(/\s+/).filter(Boolean) }) }],
    },
  ],
  toolbar: [{ id: 'comment', group: 'review', label: 'comment.add', icon: 'comment', run: (e) => {
        if (e.hasListener('ui:comment')) return void e.emit('ui:comment');
        e.emit('ui:error', { message: e.label('comment.unavailable', 'Comments are not available in this editor.') });
        console.warn('[zeditor] the Comment button needs a comments UI: call createComments() and createReviewPanel(), or listen to "ui:comment" yourself, or disable it with features: { comments: false }');
      }, enabled: (e) => !!e.selection && e.selection.type === 'text' && !(e.selection.anchor.id === e.selection.focus.id && e.selection.anchor.offset === e.selection.focus.offset), floating: true, order: 80 }],
  labels: {
    'comment.add': 'Comment',
    'comment.placeholder': 'Add a comment…',
    'comment.reply': 'Reply',
    'comment.resolve': 'Resolve',
    'comment.reopen': 'Reopen',
    'comment.delete': 'Delete',
    'comment.orphaned': 'The commented text was deleted',
    'comment.panel': 'Comments',
    'comment.empty': 'No comments yet',
    'comment.send': 'Send',
  },
};

export interface AnchorRange {
  id: string;
  from: number;
  to: number;
}
export interface ThreadView extends CommentThread {
  anchored: boolean;
  ranges: AnchorRange[];
}

export interface CommentsController {
  /** create a thread anchored to the current text selection */
  addThread(body: string): CommentThread | null;
  reply(threadId: string, body: string): Comment | null;
  editComment(threadId: string, commentId: string, body: string): boolean;
  deleteComment(threadId: string, commentId: string): boolean;
  resolve(threadId: string, resolved?: boolean): boolean;
  removeThread(threadId: string): boolean;
  threads(): ThreadView[];
  anchors(threadId: string): AnchorRange[];
  /** threads whose anchor contains the caret */
  threadsAtSelection(): string[];
  /** move the selection to a thread's anchor */
  goTo(threadId: string): boolean;
  subscribe(fn: () => void): () => void;
  readonly store: CommentStore;
  destroy(): void;
}

export function createComments(editor: Editor, opts: { store?: CommentStore; user: ReviewUser; permissions?: Permissions }): CommentsController {
  if (!editor.schema.marks.has('comment')) throw new Error('zeditor: createComments needs commentsExtension');
  const store = opts.store ?? memoryCommentStore();
  const perms = opts.permissions ?? {};
  const can = (k: keyof Permissions) => (perms[k] ?? allow)(opts.user);
  const subs = new Set<() => void>();
  const fire = () => subs.forEach((f) => f());
  const offStore = store.subscribe(fire);
  const offChange = editor.on('change', fire);

  const allAnchors = (): Map<string, AnchorRange[]> => {
    const map = new Map<string, AnchorRange[]>();
    for (const b of editor.doc.descendants()) {
      if (!b.content) continue;
      let pos = 0;
      for (const c of b.content) {
        const len = isAtom(c) ? 1 : c.text.length;
        for (const id of (c.marks?.comment?.ids as string[]) ?? []) {
          const list = map.get(id) ?? [];
          const last = list[list.length - 1];
          if (last && last.id === b.id && last.to === pos) last.to = pos + len;
          else list.push({ id: b.id, from: pos, to: pos + len });
          map.set(id, list);
        }
        pos += len;
      }
    }
    return map;
  };
  const editMarks = (threadId: string, add: boolean, ranges = selectedRanges(editor)): boolean =>
    editor.update(
      (tr) => {
        const sel = editor.selection;
        const targets = add ? ranges : [...editor.doc.descendants()].filter((b) => b.content).map((b) => ({ block: b, from: 0, to: b.length }));
        for (const r of targets) {
          if (r.to <= r.from) continue;
          const parts = sliceInline(r.block.content, r.from, r.to);
          let changed = false;
          const next: Inline[] = parts.map((p) => {
            const ids: string[] = p.marks?.comment?.ids ?? [];
            const has = ids.includes(threadId);
            if (add === has) return p;
            changed = true;
            const nids = add ? [...ids, threadId] : ids.filter((i) => i !== threadId);
            const marks: MarkSet = { ...(p.marks ?? {}) };
            if (nids.length) marks.comment = { ids: nids };
            else delete marks.comment;
            return { ...p, marks: Object.keys(marks).length ? marks : undefined } as Inline;
          });
          if (changed) tr.step({ t: 'text', id: r.block.id, from: r.from, to: r.to, insert: next });
        }
        tr.select(sel);
      },
      // anchoring is not a content edit: keep it out of the user's undo stack
      { history: false, origin: 'comment' },
    );

  return {
    store,
    addThread(body) {
      if (!can('canComment') || !body.trim()) return null;
      const ranges = selectedRanges(editor).filter((r) => r.to > r.from && !editor.schema.node(r.block.type)?.code);
      if (!ranges.length) return null;
      const quote = ranges.map((r) => contentText(sliceInline(r.block.content, r.from, r.to), '')).join(' ').slice(0, 500);
      const now = Date.now();
      const thread: CommentThread = { id: 't' + newId(), quote, resolved: false, createdAt: now, comments: [{ id: 'c' + newId(), author: opts.user, body: body.trim(), createdAt: now }] };
      if (!editMarks(thread.id, true, ranges)) return null;
      store.put(thread);
      return thread;
    },
    reply(threadId, body) {
      const t = store.get(threadId);
      if (!t || !can('canComment') || !body.trim()) return null;
      const c: Comment = { id: 'c' + newId(), author: opts.user, body: body.trim(), createdAt: Date.now() };
      store.put({ ...t, comments: [...t.comments, c] });
      return c;
    },
    editComment(threadId, commentId, body) {
      const t = store.get(threadId);
      const c = t?.comments.find((x) => x.id === commentId);
      if (!t || !c || (c.author.id !== opts.user.id && !can('canModerate'))) return false;
      store.put({ ...t, comments: t.comments.map((x) => (x.id === commentId ? { ...x, body: body.trim(), editedAt: Date.now() } : x)) });
      return true;
    },
    deleteComment(threadId, commentId) {
      const t = store.get(threadId);
      const c = t?.comments.find((x) => x.id === commentId);
      if (!t || !c || (c.author.id !== opts.user.id && !can('canModerate'))) return false;
      const rest = t.comments.filter((x) => x.id !== commentId);
      if (!rest.length) return this.removeThread(threadId);
      store.put({ ...t, comments: rest });
      return true;
    },
    resolve(threadId, resolved = true) {
      const t = store.get(threadId);
      if (!t || (!can('canModerate') && t.comments[0]?.author.id !== opts.user.id)) return false;
      store.put({ ...t, resolved });
      return true;
    },
    removeThread(threadId) {
      const t = store.get(threadId);
      if (!t || (!can('canModerate') && t.comments[0]?.author.id !== opts.user.id)) return false;
      editMarks(threadId, false);
      store.remove(threadId);
      return true;
    },
    threads() {
      const a = allAnchors();
      return store.list().map((t) => ({ ...t, ranges: a.get(t.id) ?? [], anchored: (a.get(t.id)?.length ?? 0) > 0 }));
    },
    anchors: (threadId) => allAnchors().get(threadId) ?? [],
    threadsAtSelection() {
      const sel = editor.selection;
      if (!sel || sel.type !== 'text') return [];
      const b = editor.doc.get(sel.focus.id);
      if (!b?.content) return [];
      const o = sel.focus.offset;
      const part = sliceInline(b.content, Math.max(0, o - 1), o + 1);
      const ids = new Set<string>();
      for (const p of part) for (const id of (p.marks?.comment?.ids as string[]) ?? []) ids.add(id);
      return [...ids];
    },
    goTo(threadId) {
      const r = allAnchors().get(threadId)?.[0];
      if (!r) return false;
      editor.setSelection(textSel(r.id, r.from, r.id, r.to), { scroll: true });
      return true;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    destroy() {
      offStore();
      offChange();
      subs.clear();
    },
  };
}

/* ------------------------------------------------------------------ suggestions */

export const suggestionsExtension: Extension = {
  name: 'suggestions',
  requires: ['base'],
  marks: [
    {
      type: 'suggestion',
      rank: 6,
      inclusive: false,
      attrs: { id: { validate: (x) => (typeof x === 'string' && /^[\w:.-]{1,64}$/.test(x) ? x : undefined) }, kind: { validate: (x) => (x === 'insert' || x === 'delete' ? x : undefined) }, author: { default: '', validate: (x) => (typeof x === 'string' ? x.slice(0, 200) : undefined) }, at: { default: 0, validate: (x) => (Number.isFinite(+x) ? +x : undefined) } },
      toHTML: (x) => (x.kind === 'delete' ? [`<del data-suggestion="${esc(x.id)}" data-author="${esc(x.author)}">`, '</del>'] : [`<ins data-suggestion="${esc(x.id)}" data-author="${esc(x.author)}">`, '</ins>']),
      toMarkdown: () => ['', ''],
      parseHTML: [
        { tag: 'ins', match: (el) => !!el.attrs['data-suggestion'], getAttrs: (el) => ({ id: el.attrs['data-suggestion'], kind: 'insert', author: el.attrs['data-author'] ?? '' }), priority: 60 },
        { tag: 'del', match: (el) => !!el.attrs['data-suggestion'], getAttrs: (el) => ({ id: el.attrs['data-suggestion'], kind: 'delete', author: el.attrs['data-author'] ?? '' }), priority: 60 },
      ],
    },
  ],
  labels: { 'suggest.mode': 'Suggesting', 'suggest.accept': 'Accept', 'suggest.reject': 'Reject', 'suggest.acceptAll': 'Accept all', 'suggest.rejectAll': 'Reject all', 'suggest.inserted': 'Inserted', 'suggest.deleted': 'Deleted', 'suggest.panel': 'Suggestions' },
};

export interface Suggestion {
  id: string;
  kind: 'insert' | 'delete';
  author: string;
  at: number;
  text: string;
  ranges: AnchorRange[];
}
export interface SuggestionsController {
  /** while on, typing and deleting create suggestions instead of changing the text */
  setSuggesting(on: boolean): void;
  isSuggesting(): boolean;
  list(): Suggestion[];
  accept(id: string): boolean;
  reject(id: string): boolean;
  acceptAll(): number;
  rejectAll(): number;
  subscribe(fn: () => void): () => void;
  destroy(): void;
}

/**
 * Suggestions cover inline text insertions and deletions. Structural edits (splitting,
 * moving, converting blocks, table operations) made while suggesting are applied directly.
 */
export function createSuggestions(editor: Editor, opts: { user: ReviewUser; permissions?: Permissions }): SuggestionsController {
  if (!editor.schema.marks.has('suggestion')) throw new Error('zeditor: createSuggestions needs suggestionsExtension');
  const state = (editor.storage.suggest = { active: false, author: opts.user.name || opts.user.id });
  const perms = opts.permissions ?? {};
  const subs = new Set<() => void>();
  const fire = () => subs.forEach((f) => f());
  const off = editor.on('change', fire);

  const list = (): Suggestion[] => {
    const map = new Map<string, Suggestion>();
    for (const b of editor.doc.descendants()) {
      if (!b.content) continue;
      let pos = 0;
      for (const c of b.content) {
        const len = isAtom(c) ? 1 : c.text.length;
        const s = c.marks?.suggestion;
        if (s) {
          const key = s.id + ':' + s.kind;
          let cur = map.get(key);
          if (!cur) map.set(key, (cur = { id: s.id, kind: s.kind, author: s.author, at: s.at, text: '', ranges: [] }));
          cur.text += isAtom(c) ? '' : c.text;
          const last = cur.ranges[cur.ranges.length - 1];
          if (last && last.id === b.id && last.to === pos) last.to = pos + len;
          else cur.ranges.push({ id: b.id, from: pos, to: pos + len });
        }
        pos += len;
      }
    }
    return [...map.values()].sort((a, b) => a.at - b.at);
  };
  const resolve = (ids: string[] | null, accept: boolean): number => {
    if (!(perms.canReview ?? allow)(opts.user)) return 0;
    const items = list().filter((s) => !ids || ids.includes(s.id));
    if (!items.length) return 0;
    const was = state.active;
    state.active = false;
    try {
      editor.update((tr) => {
        const sel = editor.selection;
        // back to front so offsets stay valid
        const all = items.flatMap((s) => s.ranges.map((r) => ({ ...r, kind: s.kind }))).sort((a, b) => (a.id === b.id ? b.from - a.from : 0));
        for (const r of all) {
          const b = editor.doc.get(r.id)!;
          const remove = (r.kind === 'insert') !== accept;
          if (remove) tr.replaceText(r.id, r.from, r.to);
          else {
            const parts = sliceInline(b.content, r.from, r.to).map((p) => {
              const { suggestion: _s, ...rest } = p.marks ?? {};
              return { ...p, marks: Object.keys(rest).length ? rest : undefined } as Inline;
            });
            tr.step({ t: 'text', id: r.id, from: r.from, to: r.to, insert: parts });
          }
        }
        tr.select(sel);
      });
    } finally {
      state.active = was;
    }
    return items.length;
  };
  return {
    setSuggesting(on) {
      state.active = on;
      editor.emit('update');
      fire();
    },
    isSuggesting: () => state.active,
    list,
    accept: (id) => resolve([id], true) > 0,
    reject: (id) => resolve([id], false) > 0,
    acceptAll: () => resolve(null, true),
    rejectAll: () => resolve(null, false),
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    destroy() {
      off();
      subs.clear();
      state.active = false;
    },
  };
}

/* ------------------------------------------------------------------ versions */

export interface Version {
  id: string;
  label: string;
  createdAt: number;
  author?: ReviewUser;
  doc: DocJSON;
}
/** Host storage adapter for versions. May be async. */
export interface VersionStore {
  list(): Version[] | Promise<Version[]>;
  put(v: Version): void | Promise<void>;
  remove(id: string): void | Promise<void>;
}
export function memoryVersionStore(): VersionStore {
  const list: Version[] = [];
  return {
    list: () => [...list],
    put: (v) => void list.push(v),
    remove: (id) => {
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list.splice(i, 1);
    },
  };
}
export interface VersionsController {
  save(label?: string): Promise<Version>;
  list(): Promise<Version[]>;
  /** Replace the document with a saved version. This is one undoable edit. */
  restore(id: string): Promise<boolean>;
  remove(id: string): Promise<void>;
}
export function createVersions(editor: Editor, opts: { store?: VersionStore; user?: ReviewUser } = {}): VersionsController {
  const store = opts.store ?? memoryVersionStore();
  return {
    async save(label) {
      const now = Date.now();
      const v: Version = { id: 'v' + newId(), label: label ?? new Date(now).toISOString(), createdAt: now, author: opts.user, doc: editor.getJSON() };
      await store.put(v);
      editor.emit('version', { version: v });
      return v;
    },
    async list() {
      return [...(await store.list())].sort((a, b) => b.createdAt - a.createdAt);
    },
    async restore(id) {
      const v = (await store.list()).find((x) => x.id === id);
      if (!v || editor.readOnly) return false;
      editor.setJSON(v.doc, { history: true, origin: 'local' });
      return true;
    },
    async remove(id) {
      await store.remove(id);
    },
  };
}
