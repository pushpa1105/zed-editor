/**
 * Block-level sync with your own backend.
 *
 * `createBlockSync(editor, { push })` collects local block changes (from the `blocks` event),
 * waits until editing pauses, and calls `push(batch)` with the net result: blocks to upsert
 * (shallow: own type / attrs / text, plus parent and position), ids to delete, and the new
 * child order of every parent whose children changed. Failed pushes are retried with back-off
 * and nothing is lost meanwhile. `push` may answer with ids the server assigned
 * (`{ ids: { tempId: serverId } }`); the editor then renames those blocks.
 *
 * `applyBlockChanges(editor, batch)` applies a batch that came from the server (another user,
 * another tab). It is tagged with origin 'remote', so it is not pushed back.
 */
import type { Editor } from '../core/editor';
import type { Attrs, Block, BlockJSON, Inline } from '../core/model';
import type { BlockChanges } from '../core/events';

export interface SyncBlock {
  id: string;
  type: string;
  /** `null` for top-level blocks */
  parentId: string | null;
  index: number;
  /** previous sibling, `null` when first */
  afterId: string | null;
  attrs?: Attrs;
  /** inline content of text blocks */
  content?: Inline[];
}
export interface SyncBatch {
  /** created or changed blocks, parents before children */
  upserted: SyncBlock[];
  /** ids of deleted blocks (descendants included) */
  deleted: string[];
  /** new child order of each parent whose children changed (`parentId: null` = top level) */
  order: { parentId: string | null; children: string[] }[];
}
export type SyncStatus = 'idle' | 'pending' | 'saving' | 'error';
export interface BlockSyncOptions {
  /** send a batch to the server; reject / throw to retry later */
  push(batch: SyncBatch): Promise<void | { ids?: Record<string, string> }> | void;
  /** quiet time before a push, in ms (default 800) */
  delay?: number;
  /** longest wait while edits keep coming, in ms (default 5000) */
  maxDelay?: number;
  /** which change origins to push (default: all but 'remote', 'load' and 'remap') */
  shouldPush?(origin: string): boolean;
  onStatus?(status: SyncStatus, error?: unknown): void;
}
export interface BlockSync {
  /** push now (resolves when the pending changes are saved, or rejects on failure) */
  flush(): Promise<void>;
  /** number of blocks waiting to be pushed */
  readonly pending: number;
  readonly status: SyncStatus;
  destroy(): void;
}

const SKIP = new Set(['remote', 'load', 'remap']);

/** Shallow description of a block for a block store. */
export function toSyncBlock(b: Block): SyncBlock {
  const p = b.parent!;
  const index = p.children!.indexOf(b);
  const out: SyncBlock = { id: b.id, type: b.type, parentId: p.id === 'root' ? null : p.id, index, afterId: index > 0 ? p.children![index - 1].id : null };
  if (b.attrs && Object.keys(b.attrs).length) out.attrs = b.attrs;
  if (b.content) out.content = b.content;
  return out;
}

export function createBlockSync(editor: Editor, opts: BlockSyncOptions): BlockSync {
  const delay = opts.delay ?? 800;
  const maxDelay = opts.maxDelay ?? 5000;
  const shouldPush = opts.shouldPush ?? ((o: string) => !SKIP.has(o));
  let dirty = new Set<string>();
  let deleted = new Set<string>();
  let parents = new Set<string>(); // 'root' for top level
  /** created since the last successful push: deleting them again needs no request */
  let fresh = new Set<string>();
  let status: SyncStatus = 'idle';
  let timer: any = 0;
  let first = 0;
  let inflight: Promise<void> | null = null;
  let failures = 0;
  let destroyed = false;

  const setStatus = (s: SyncStatus, err?: unknown) => {
    if (s === status && s !== 'error') return;
    status = s;
    opts.onStatus?.(s, err);
    editor.emit('sync:status', { status: s, error: err });
  };
  const parentKey = (id: string | null) => id ?? 'root';
  const schedule = (wait = delay) => {
    if (destroyed) return;
    clearTimeout(timer);
    const now = Date.now();
    if (!first) first = now;
    const left = Math.max(0, Math.min(wait, first + maxDelay - now));
    timer = setTimeout(() => void run().catch(() => {}), left);
  };

  const onBlocks = (c: BlockChanges) => {
    if (!shouldPush(c.origin)) return;
    for (const x of c.created) {
      for (const id of x.ids) {
        dirty.add(id);
        fresh.add(id);
        deleted.delete(id);
      }
      parents.add(parentKey(x.parentId));
    }
    for (const x of c.updated) dirty.add(x.id);
    for (const x of c.moved) {
      dirty.add(x.id);
      parents.add(parentKey(x.from.parentId));
      parents.add(parentKey(x.to.parentId));
    }
    for (const x of c.deleted) {
      parents.add(parentKey(x.parentId));
      for (const id of x.ids) {
        dirty.delete(id);
        if (fresh.has(id)) fresh.delete(id);
        else deleted.add(id);
      }
    }
    if (dirty.size || deleted.size || parents.size) {
      setStatus('pending');
      schedule();
    }
  };

  const depth = (b: Block) => {
    let d = 0;
    for (let p = b.parent; p && p.id !== 'root'; p = p.parent) d++;
    return d;
  };
  const build = (): SyncBatch => {
    const blocks = [...dirty].map((id) => editor.doc.get(id)).filter((b): b is Block => !!b && !!b.parent);
    blocks.sort((a, b) => depth(a) - depth(b));
    const order: SyncBatch['order'] = [];
    for (const key of parents) {
      const p = key === 'root' ? editor.doc.root : editor.doc.get(key);
      if (p) order.push({ parentId: key === 'root' ? null : key, children: (p.children ?? []).map((c) => c.id) });
    }
    return { upserted: blocks.map(toSyncBlock), deleted: [...deleted], order };
  };

  const run = async (): Promise<void> => {
    clearTimeout(timer);
    timer = 0;
    if (destroyed) return;
    if (inflight) {
      // one request at a time: try again once the current one settles
      await inflight.catch(() => {});
      if (dirty.size || deleted.size || parents.size) return run();
      return;
    }
    if (!dirty.size && !deleted.size && !parents.size) {
      setStatus('idle');
      return;
    }
    const batch = build();
    const sent = { dirty, deleted, parents, fresh };
    dirty = new Set();
    deleted = new Set();
    parents = new Set();
    fresh = new Set();
    first = 0;
    setStatus('saving');
    inflight = (async () => {
      try {
        const res = await opts.push(batch);
        failures = 0;
        if (res && res.ids && Object.keys(res.ids).length) editor.remapIds(res.ids);
        setStatus(dirty.size || deleted.size || parents.size ? 'pending' : 'idle');
      } catch (err) {
        // put everything back (newer changes win) and retry with back-off
        for (const id of sent.dirty) if (!deleted.has(id)) dirty.add(id);
        for (const id of sent.deleted) if (!dirty.has(id)) deleted.add(id);
        for (const id of sent.parents) parents.add(id);
        for (const id of sent.fresh) fresh.add(id);
        failures++;
        setStatus('error', err);
        schedule(Math.min(30000, 1000 * 2 ** Math.min(failures - 1, 5)));
        throw err;
      } finally {
        inflight = null;
      }
    })();
    await inflight;
    if (dirty.size || deleted.size || parents.size) schedule();
  };

  const offs = [
    editor.on('blocks', onBlocks),
    editor.on('ids:remapped', ({ map }) => {
      const re = (s: Set<string>) => new Set([...s].map((id) => map[id] ?? id));
      dirty = re(dirty);
      parents = re(parents);
      fresh = re(fresh);
    }),
    editor.on('destroy', () => destroy()),
  ];
  const destroy = () => {
    destroyed = true;
    clearTimeout(timer);
    offs.forEach((o) => o());
  };
  return {
    flush: () => run(),
    get pending() {
      return dirty.size + deleted.size;
    },
    get status() {
      return status;
    },
    destroy,
  };
}

/**
 * Apply a batch received from the server. Blocks are created, updated, moved or deleted to
 * match; parents missing from the document put new blocks at the top level. Not an undo step;
 * tagged with origin 'remote' (pass another `origin` if you need to tell sources apart).
 */
export function applyBlockChanges(editor: Editor, batch: Partial<SyncBatch>, opts: { origin?: string } = {}): boolean {
  return editor.update(
    (tr) => {
      const doc = editor.doc;
      for (const id of batch.deleted ?? []) if (doc.has(id)) tr.remove(id);
      for (const s of batch.upserted ?? []) {
        const parent = s.parentId && doc.has(s.parentId) ? s.parentId : 'root';
        const p = doc.get(parent)!;
        const indexOf = () => {
          if (s.afterId !== undefined) {
            const prev = s.afterId ? doc.get(s.afterId) : null;
            if (s.afterId === null) return 0;
            if (prev && prev.parent === p) return p.children!.indexOf(prev) + 1;
          }
          return Math.min(Math.max(0, s.index ?? p.children?.length ?? 0), p.children?.length ?? 0);
        };
        const b = doc.get(s.id);
        if (!b) {
          const json: BlockJSON = { id: s.id, type: s.type };
          if (s.attrs) json.attrs = s.attrs;
          if (s.content) json.content = s.content;
          const [clean] = editor.schema.parse([json]).blocks.map((x) => x.toJSON());
          if (clean) tr.insert(parent, indexOf(), [{ ...clean, id: s.id }]);
          continue;
        }
        if (s.type !== b.type || (s.attrs && JSON.stringify(s.attrs) !== JSON.stringify(b.attrs))) tr.step({ t: 'attrs', id: b.id, ...(s.type !== b.type ? { type: s.type } : {}), attrs: s.attrs ?? b.attrs });
        if (s.content && b.content && JSON.stringify(s.content) !== JSON.stringify(b.content)) tr.replaceText(b.id, 0, b.length, s.content);
        if (b.parent !== p) {
          tr.move([b.id], parent, indexOf());
        }
      }
      for (const o of batch.order ?? []) {
        const key = o.parentId ?? 'root';
        const p = doc.get(key);
        if (!p?.children) continue;
        let at = 0;
        for (const id of o.children) {
          const c = doc.get(id);
          if (!c || c.parent !== p) continue;
          if (p.children.indexOf(c) !== at) tr.move([id], key, at);
          at++;
        }
      }
    },
    { origin: opts.origin ?? 'remote', history: false },
  );
}
