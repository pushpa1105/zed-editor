/**
 * Block-level change events.
 *
 * Every committed transaction is a list of low-level steps (text edits, attribute changes,
 * inserts, removes). For syncing with a backend or reacting to edits it is easier to know
 * which *blocks* were created, updated, deleted or moved. `summarizeTransaction` derives that
 * from the steps and their inverses; the editor emits the result as the `blocks` event and as
 * one `block:*` event per block (only when someone listens: the summary is not computed
 * otherwise).
 */
import type { Attrs, Block, BlockJSON, Doc } from './model';
import type { Step } from './steps';

/** Where a block sits: parent (`null` = top level), index among its siblings, previous sibling. */
export interface BlockPosition {
  parentId: string | null;
  index: number;
  /** id of the previous sibling, `null` when the block is first (handy for "insert after" APIs) */
  afterId: string | null;
}

export interface BlockCreated extends BlockPosition {
  id: string;
  type: string;
  /** the block as JSON, children included (descendants are not reported separately) */
  json: BlockJSON;
  /** ids of the block and all of its descendants */
  ids: string[];
}

export type BlockChangeKind = 'content' | 'attrs' | 'type';

export interface BlockUpdated {
  id: string;
  type: string;
  /** what changed: the text ('content'), the attributes ('attrs'), the block type ('type') */
  changes: BlockChangeKind[];
  /** attributes before and after the transaction (present when attrs or type changed) */
  attrsBefore?: Attrs;
  attrsAfter?: Attrs;
  typeBefore?: string;
  /** database rows: ids of the properties whose cell value changed */
  cells?: string[];
  block: Block;
}

export interface BlockDeleted {
  id: string;
  type: string;
  /** where it was before the transaction */
  parentId: string | null;
  index: number;
  /** the deleted block as JSON, children included */
  json: BlockJSON;
  /** ids of the block and all of its descendants */
  ids: string[];
}

export interface BlockMoved {
  id: string;
  type: string;
  from: { parentId: string | null; index: number };
  to: BlockPosition;
}

export interface BlockCompleted {
  id: string;
  type: string;
  block: Block;
}

export interface BlockChanges {
  /** who made the change: 'local', 'remote', 'history', 'paste', 'load', 'remap' or a custom origin */
  origin: string;
  created: BlockCreated[];
  updated: BlockUpdated[];
  deleted: BlockDeleted[];
  moved: BlockMoved[];
  /** blocks whose `checked` attribute became true (check-list items) */
  completed: BlockCompleted[];
  /** blocks whose `checked` attribute became false */
  uncompleted: BlockCompleted[];
}

const top = (id: string | undefined): string | null => (!id || id === 'root' ? null : id);
const walkJSON = (j: BlockJSON, fn: (j: BlockJSON) => void) => {
  fn(j);
  j.children?.forEach((c) => walkJSON(c, fn));
};
export function positionOf(b: Block): BlockPosition {
  const p = b.parent;
  const index = p?.children ? p.children.indexOf(b) : 0;
  return { parentId: top(p?.id), index, afterId: index > 0 ? p!.children![index - 1].id : null };
}
const sameJSON = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Net block changes of one transaction. `steps[i]` was applied with inverse `inverse[i]`;
 * `doc` is the document after the transaction.
 */
export function summarizeTransaction(steps: Step[], inverse: Step[], doc: Doc, origin: string): BlockChanges {
  // first thing that happened to each id, and whether it existed before the transaction
  const existedBefore = new Map<string, boolean>();
  const seen = (id: string, before: boolean) => {
    if (!existedBefore.has(id)) existedBefore.set(id, before);
  };
  const removedJSON = new Map<string, { json: BlockJSON; parentId: string | null; index: number; topLevel: boolean }>();
  const insertedTop = new Set<string>();
  const content = new Set<string>();
  const attrsBefore = new Map<string, { attrs?: Attrs; type?: string }>();
  steps.forEach((s, i) => {
    const inv = inverse[i];
    if (s.t === 'text') {
      seen(s.id, true);
      content.add(s.id);
    } else if (s.t === 'attrs') {
      seen(s.id, true);
      if (!attrsBefore.has(s.id) && inv?.t === 'attrs') attrsBefore.set(s.id, { attrs: inv.attrs, type: inv.type });
    } else if (s.t === 'insert') {
      s.blocks.forEach((b) => {
        insertedTop.add(b.id);
        walkJSON(b, (j) => seen(j.id, false));
      });
    } else if (s.t === 'remove' && inv?.t === 'insert') {
      inv.blocks.forEach((b, k) => {
        walkJSON(b, (j) => {
          seen(j.id, true);
          if (!removedJSON.has(j.id)) removedJSON.set(j.id, { json: j, parentId: top(s.parent), index: s.index + k, topLevel: j === b });
        });
      });
    }
  });

  const out: BlockChanges = { origin, created: [], updated: [], deleted: [], moved: [], completed: [], uncompleted: [] };
  const createdIds = new Set<string>();
  // created: did not exist before, exists now. Only the topmost of a created subtree is listed.
  for (const [id, before] of existedBefore) {
    if (before) continue;
    const b = doc.get(id);
    if (!b) continue;
    createdIds.add(id);
  }
  for (const id of createdIds) {
    const b = doc.get(id)!;
    if (b.parent && createdIds.has(b.parent.id)) continue;
    const json = b.toJSON();
    const ids: string[] = [];
    walkJSON(json, (j) => ids.push(j.id));
    out.created.push({ id, type: b.type, json, ids, ...positionOf(b) });
  }
  // deleted: existed before, gone now. Topmost only.
  const deletedIds = new Set<string>();
  for (const id of removedJSON.keys()) if (existedBefore.get(id) && !doc.has(id)) deletedIds.add(id);
  for (const id of deletedIds) {
    const r = removedJSON.get(id)!;
    // a descendant of another deleted block is part of that block's json
    let nested = false;
    for (const [pid, pr] of removedJSON) {
      if (pid !== id && deletedIds.has(pid) && pr.json.children && containsId(pr.json, id)) {
        nested = true;
        break;
      }
    }
    if (nested) continue;
    const ids: string[] = [];
    walkJSON(r.json, (j) => ids.push(j.id));
    out.deleted.push({ id, type: r.json.type, parentId: r.parentId, index: r.index, json: r.json, ids });
  }
  // moved: removed and inserted again somewhere else (descendants travelling along are not listed)
  for (const [id, r] of removedJSON) {
    const b = doc.get(id);
    if (!b || !r.topLevel || !insertedTop.has(id) || !existedBefore.get(id)) continue;
    const to = positionOf(b);
    if (to.parentId === r.parentId && to.index === r.index) {
      // put back in place: an update if its own data changed
      if (!sameJSON({ ...r.json, children: undefined }, { ...b.toJSON(), children: undefined })) content.add(id);
      continue;
    }
    out.moved.push({ id, type: b.type, from: { parentId: r.parentId, index: r.index }, to });
  }
  // updated: existed before and after, its own text / attrs / type changed
  const updatedIds = new Set<string>([...content, ...attrsBefore.keys()]);
  for (const id of updatedIds) {
    const b = doc.get(id);
    if (!b || createdIds.has(id)) continue;
    const changes: BlockChangeKind[] = [];
    const u: BlockUpdated = { id, type: b.type, changes, block: b };
    if (content.has(id)) changes.push('content');
    const before = attrsBefore.get(id);
    if (before) {
      if (before.type !== undefined && before.type !== b.type) {
        changes.push('type');
        u.typeBefore = before.type;
      }
      if (before.attrs !== undefined && !sameJSON(before.attrs, b.attrs)) changes.push('attrs');
      if (changes.includes('attrs') || changes.includes('type')) {
        u.attrsBefore = before.attrs ?? b.attrs;
        u.attrsAfter = b.attrs;
      }
      if (b.type === 'db_row' && before.attrs) {
        const was = before.attrs.cells ?? {};
        const now = b.attrs.cells ?? {};
        const keys = new Set([...Object.keys(was), ...Object.keys(now)]);
        u.cells = [...keys].filter((k) => !sameJSON(was[k], now[k]));
      }
      const c0 = before.attrs?.checked === true;
      const c1 = b.attrs?.checked === true;
      if (before.attrs !== undefined && c0 !== c1) (c1 ? out.completed : out.uncompleted).push({ id, type: b.type, block: b });
    }
    if (changes.length) out.updated.push(u);
  }
  return out;
}

function containsId(j: BlockJSON, id: string): boolean {
  if (!j.children) return false;
  for (const c of j.children) if (c.id === id || containsId(c, id)) return true;
  return false;
}

export const isEmptyChanges = (c: BlockChanges): boolean => !c.created.length && !c.updated.length && !c.deleted.length && !c.moved.length;

/** names of the per-block events, for `editor.on(...)` */
export const BLOCK_EVENTS = ['blocks', 'block:created', 'block:updated', 'block:deleted', 'block:moved', 'block:completed', 'block:uncompleted'] as const;
