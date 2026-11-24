/**
 * Persistence helpers: autosave with draft recovery, uploads, and a "latest wins" async runner
 * used by typeahead menus. All host I/O goes through functions the host provides.
 */
import type { Editor } from '../core/editor';
import { Attrs, DocJSON, newId } from '../core/model';

/* ------------------------------------------------------------------ latest-wins runner */

export interface LatestRunner<T> {
  /** Run a query. Resolves with `{ stale: true }` if a newer query started meanwhile. */
  run(query: string): Promise<{ stale: boolean; query: string; result?: T; error?: unknown }>;
  cancel(): void;
}
/** Wraps an async search so only the latest request can deliver results; older ones are aborted. */
export function latestRunner<T>(search: (query: string, signal: AbortSignal) => T | Promise<T>, debounce = 0): LatestRunner<T> {
  let seq = 0;
  let ctrl: AbortController | null = null;
  let timer: any = null;
  return {
    run(query) {
      const my = ++seq;
      ctrl?.abort();
      const c = (ctrl = new AbortController());
      if (timer) clearTimeout(timer);
      return new Promise((resolve) => {
        const go = async () => {
          if (my !== seq) return resolve({ stale: true, query });
          try {
            const result = await search(query, c.signal);
            resolve(my === seq && !c.signal.aborted ? { stale: false, query, result } : { stale: true, query });
          } catch (error) {
            resolve(my === seq && !c.signal.aborted ? { stale: false, query, error } : { stale: true, query });
          }
        };
        if (debounce > 0) {
          timer = setTimeout(go, debounce);
          c.signal.addEventListener('abort', () => resolve({ stale: true, query }), { once: true });
        } else void go();
      });
    },
    cancel() {
      seq++;
      ctrl?.abort();
      if (timer) clearTimeout(timer);
    },
  };
}

/* ------------------------------------------------------------------ autosave */

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'offline';

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface AutosaveOptions {
  /** persist the document. Reject (or throw) on failure. `signal` aborts when the autosave is destroyed. */
  save: (doc: DocJSON, ctx: { revision: number; signal: AbortSignal }) => Promise<unknown> | unknown;
  /** quiet period after the last edit before saving (ms, default 800) */
  debounce?: number;
  /** save at least this often while edits keep coming (ms, default 5000) */
  maxWait?: number;
  /** keep a local draft under this key until the save succeeds */
  draftKey?: string;
  /** defaults to localStorage when available */
  draftStorage?: DraftStorage;
  /** retry delays after a failed save (ms). Default [1000, 3000, 10000, 30000] */
  retryDelays?: number[];
  onStatus?: (status: SaveStatus, error?: unknown) => void;
  isOnline?: () => boolean;
}
export interface Draft {
  doc: DocJSON;
  savedAt: number;
}
export interface Autosave {
  readonly status: SaveStatus;
  readonly error: unknown;
  /** save now (if dirty) and resolve when the document as of this call is persisted or failed */
  flush(): Promise<boolean>;
  retry(): Promise<boolean>;
  /** a local draft newer than what was last confirmed saved, if any */
  getDraft(): Draft | null;
  /** load the draft into the editor (undoable) */
  recoverDraft(): boolean;
  clearDraft(): void;
  subscribe(fn: (status: SaveStatus) => void): () => void;
  destroy(): void;
}

export function createAutosave(editor: Editor, opts: AutosaveOptions): Autosave {
  const debounce = opts.debounce ?? 800;
  const maxWait = opts.maxWait ?? 5000;
  const delays = opts.retryDelays ?? [1000, 3000, 10000, 30000];
  const storage: DraftStorage | null = opts.draftStorage ?? (typeof localStorage !== 'undefined' ? safeStorage() : null);
  const online = opts.isOnline ?? (() => (typeof navigator === 'undefined' || navigator.onLine !== false));
  const ctrl = new AbortController();
  const subs = new Set<(s: SaveStatus) => void>();
  let status: SaveStatus = 'saved';
  let error: unknown = null;
  /** highest revision confirmed persisted. A late response for an older revision never lowers it. */
  let savedRevision = editor.revision;
  let inFlight: Promise<boolean> | null = null;
  let timer: any = null;
  let firstDirtyAt = 0;
  let failures = 0;
  let destroyed = false;

  const setStatus = (s: SaveStatus, e: unknown = null) => {
    error = e;
    if (s === status) return;
    status = s;
    opts.onStatus?.(s, e ?? undefined);
    subs.forEach((f) => f(s));
    editor.emit('save', { status: s, error: e });
  };
  const writeDraft = () => {
    if (!opts.draftKey || !storage) return;
    try {
      storage.setItem(opts.draftKey, JSON.stringify({ doc: editor.getJSON(), savedAt: Date.now() }));
    } catch {
      /* quota: drafts are best effort */
    }
  };
  const clearDraft = () => {
    if (opts.draftKey && storage) {
      try {
        storage.removeItem(opts.draftKey);
      } catch {
        /* ignore */
      }
    }
  };
  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void doSave(), ms);
  };
  const doSave = (): Promise<boolean> => {
    if (destroyed) return Promise.resolve(false);
    // queued behind a running save: continue only if it succeeded — after a failure the retry
    // delay decides when to try again, not the callers that were waiting
    if (inFlight) return inFlight.then((ok) => (ok && editor.revision > savedRevision ? doSave() : ok));
    if (editor.revision <= savedRevision) {
      setStatus('saved');
      return Promise.resolve(true);
    }
    if (timer) clearTimeout(timer);
    timer = null;
    const revision = editor.revision;
    const doc = editor.getJSON();
    setStatus('saving');
    inFlight = (async () => {
      try {
        await opts.save(doc, { revision, signal: ctrl.signal });
        if (destroyed) return false;
        savedRevision = Math.max(savedRevision, revision);
        failures = 0;
        firstDirtyAt = 0;
        if (editor.revision > savedRevision) {
          // edits arrived while saving: the response is "late" relative to them — stay dirty
          setStatus('dirty');
          firstDirtyAt = Date.now();
          schedule(debounce);
        } else {
          clearDraft();
          setStatus('saved');
        }
        return true;
      } catch (e) {
        if (destroyed) return false;
        setStatus(online() ? 'error' : 'offline', e);
        const d = delays[Math.min(failures, delays.length - 1)];
        failures++;
        if (d !== undefined) schedule(d);
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const offChange = editor.on('change', (ev) => {
    if (ev.origin === 'load') {
      // a freshly loaded document is the saved state
      savedRevision = editor.revision;
      setStatus('saved');
      return;
    }
    writeDraft();
    if (status !== 'saving') setStatus(status === 'offline' && !online() ? 'offline' : 'dirty');
    const now = Date.now();
    if (!firstDirtyAt) firstDirtyAt = now;
    schedule(Math.max(0, Math.min(debounce, firstDirtyAt + maxWait - now)));
  });
  const onOnline = () => {
    if (editor.revision > savedRevision) void doSave();
  };
  const g: any = typeof window !== 'undefined' ? window : null;
  g?.addEventListener('online', onOnline);

  const getDraft = (): Draft | null => {
    if (!opts.draftKey || !storage) return null;
    try {
      const raw = storage.getItem(opts.draftKey);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object' || !d.doc || !Array.isArray(d.doc.blocks)) return null;
      if (JSON.stringify(d.doc.blocks) === JSON.stringify(editor.getJSON().blocks)) return null;
      return { doc: d.doc, savedAt: +d.savedAt || 0 };
    } catch {
      return null;
    }
  };

  return {
    get status() {
      return status;
    },
    get error() {
      return error;
    },
    flush: () => doSave(),
    retry: () => {
      failures = 0;
      return doSave();
    },
    getDraft,
    recoverDraft() {
      const d = getDraft();
      if (!d) return false;
      editor.setJSON(d.doc, { history: true, origin: 'local' });
      return true;
    },
    clearDraft,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      ctrl.abort();
      offChange();
      g?.removeEventListener('online', onOnline);
      subs.clear();
    },
  };
}
function safeStorage(): DraftStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ uploads */

export interface UploadResult {
  url: string;
  name?: string;
  size?: number;
  mime?: string;
  alt?: string;
  width?: number;
}
/** Host upload function. Must honour `signal`; report progress as a 0..1 fraction. */
export type UploadHandler = (file: File, ctx: { signal: AbortSignal; onProgress: (fraction: number) => void }) => Promise<UploadResult>;

export interface UploadsOptions {
  upload: UploadHandler;
  /** reject files larger than this many bytes */
  maxSize?: number;
  /** return false to reject a file */
  accept?: (file: File) => boolean;
  /** create a preview URL for an image (default URL.createObjectURL) */
  preview?: (file: File) => string;
  revokePreview?: (url: string) => void;
}
export interface Uploads {
  /** insert placeholder blocks and start uploading. Returns the upload ids. */
  uploadFiles(files: Iterable<File>, at?: { after?: string; replace?: string }): string[];
  retry(uploadId: string): boolean;
  cancel(uploadId: string): boolean;
  /** 0..1, or undefined when unknown / finished */
  progress(uploadId: string): number | undefined;
  pending(): string[];
  destroy(): void;
}

interface Job {
  id: string;
  file: File;
  ctrl: AbortController | null;
  progress: number;
  state: 'uploading' | 'done' | 'error' | 'cancelled';
  result?: UploadResult;
  preview?: string;
  isImage: boolean;
}

/**
 * Upload manager.
 *  - a placeholder block (image or file) is inserted immediately, tagged with `uploadId`
 *  - deleting the block while its upload runs aborts the upload
 *  - a result that arrives after its block was removed is kept, so undoing the removal
 *    shows the finished upload instead of a dead placeholder
 *  - failures leave the block in `status: 'error'` for `retry`
 * The final attribute update is not an undo step.
 */
export function createUploads(editor: Editor, opts: UploadsOptions): Uploads {
  const jobs = new Map<string, Job>();
  const mk = opts.preview ?? ((f: File) => (typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(f) : ''));
  const revoke = opts.revokePreview ?? ((u: string) => typeof URL !== 'undefined' && URL.revokeObjectURL && u.startsWith('blob:') && URL.revokeObjectURL(u));

  const blockOf = (uploadId: string) => {
    for (const b of editor.doc.descendants()) if (b.attrs.uploadId === uploadId) return b;
    return null;
  };
  const patch = (uploadId: string, attrs: Attrs) => {
    const b = blockOf(uploadId);
    if (!b) return false;
    return editor.update((tr) => void tr.setAttrs(b.id, attrs), { history: false, origin: 'upload' });
  };
  const finalAttrs = (job: Job): Attrs => {
    const r = job.result!;
    return job.isImage
      ? { src: r.url, uploadId: undefined, status: undefined, ...(r.alt ? { alt: r.alt } : {}), ...(r.width ? { width: r.width } : {}) }
      : { url: r.url, name: r.name ?? job.file.name, size: r.size ?? job.file.size, mime: r.mime ?? job.file.type, uploadId: undefined, status: undefined };
  };
  const start = (job: Job) => {
    job.state = 'uploading';
    job.progress = 0;
    const ctrl = (job.ctrl = new AbortController());
    editor.emit('upload', { id: job.id, state: 'uploading', progress: 0 });
    Promise.resolve()
      .then(() =>
        opts.upload(job.file, {
          signal: ctrl.signal,
          onProgress: (p) => {
            if (job.ctrl !== ctrl || ctrl.signal.aborted) return;
            job.progress = Math.max(0, Math.min(1, p));
            editor.emit('upload', { id: job.id, state: 'uploading', progress: job.progress });
          },
        }),
      )
      .then(
        (result) => {
          // a result from a cancelled or superseded attempt is ignored
          if (job.ctrl !== ctrl || ctrl.signal.aborted || editor.destroyed) return;
          job.state = 'done';
          job.result = result;
          job.ctrl = null;
          patch(job.id, finalAttrs(job));
          if (job.preview) revoke(job.preview);
          editor.emit('upload', { id: job.id, state: 'done', progress: 1 });
        },
        (err) => {
          if (job.ctrl !== ctrl || editor.destroyed) return;
          job.ctrl = null;
          if (ctrl.signal.aborted) return;
          job.state = 'error';
          patch(job.id, { status: 'error' });
          editor.emit('upload', { id: job.id, state: 'error', error: err });
        },
      );
  };

  // react to document changes: removed placeholders abort; restored ones are reconciled
  const off = editor.on('change', (ev) => {
    if (ev.origin === 'upload') return;
    const present = new Set<string>();
    for (const b of editor.doc.descendants()) if (b.attrs.uploadId) present.add(b.attrs.uploadId);
    for (const job of jobs.values()) {
      if (job.state === 'uploading' && !present.has(job.id)) {
        job.ctrl?.abort();
        job.ctrl = null;
        job.state = 'cancelled';
        editor.emit('upload', { id: job.id, state: 'cancelled' });
      }
    }
    for (const id of present) {
      const job = jobs.get(id);
      const b = blockOf(id)!;
      if (job?.state === 'done') patch(id, finalAttrs(job));
      else if ((!job || job.state === 'cancelled') && b.attrs.status !== 'error') patch(id, { status: 'error' });
    }
  });

  return {
    uploadFiles(files, at) {
      const ids: string[] = [];
      if (editor.readOnly) return ids;
      let after = at?.after;
      let replace = at?.replace;
      for (const file of files) {
        if (opts.maxSize && file.size > opts.maxSize) {
          editor.emit('upload', { id: '', state: 'rejected', reason: 'size', file });
          continue;
        }
        if (opts.accept && !opts.accept(file)) {
          editor.emit('upload', { id: '', state: 'rejected', reason: 'type', file });
          continue;
        }
        const isImage = /^image\//.test(file.type) && !!editor.schema.node('image');
        if (!isImage && !editor.schema.node('file')) continue;
        const id = 'u' + newId();
        const job: Job = { id, file, ctrl: null, progress: 0, state: 'uploading', isImage };
        if (isImage) job.preview = mk(file);
        jobs.set(id, job);
        const block = isImage
          ? editor.schema.create('image', { src: job.preview ?? '', alt: '', uploadId: id, status: 'uploading' })
          : editor.schema.create('file', { name: file.name, size: file.size, mime: file.type, uploadId: id, status: 'uploading' });
        if (!editor.exec('insertBlocks', [block], { after, replace })) {
          jobs.delete(id);
          continue;
        }
        replace = undefined;
        after = block.id;
        ids.push(id);
        start(job);
      }
      return ids;
    },
    retry(uploadId) {
      const job = jobs.get(uploadId);
      if (!job || job.state === 'uploading' || job.state === 'done' || !blockOf(uploadId)) return false;
      patch(uploadId, { status: 'uploading' });
      start(job);
      return true;
    },
    cancel(uploadId) {
      const job = jobs.get(uploadId);
      if (!job) return false;
      const b = blockOf(uploadId);
      if (b) editor.exec('deleteBlocks', [b.id]);
      else job.ctrl?.abort();
      return true;
    },
    progress: (uploadId) => {
      const j = jobs.get(uploadId);
      return j && j.state === 'uploading' ? j.progress : undefined;
    },
    pending: () => [...jobs.values()].filter((j) => j.state === 'uploading').map((j) => j.id),
    destroy() {
      off();
      for (const j of jobs.values()) {
        j.ctrl?.abort();
        if (j.preview) revoke(j.preview);
      }
      jobs.clear();
    },
  };
}
