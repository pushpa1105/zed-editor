/**
 * Browser entry point: the ready-made editor (`createEditor`), the view, and the default UI
 * parts so hosts can assemble their own interface. Everything from the headless entry is
 * re-exported.
 */
import { Editor } from './core/editor';
import type { MarkSet } from './core/model';
import type { Selection } from './core/selection';
import { isCollapsed } from './core/selection';
import { typingMarks, selectedRanges, focusBlock } from './core/commands';
import { sliceInline } from './core/model';
import { defaultExtensions, HeadlessOptions } from './core';
import { EditorView, ViewOptions } from './view/view';
import { createToolbar, createFloatingToolbar, createLinkPopover, UIHandle } from './ui/toolbar';
import { createTypeahead, createBlockHandles } from './ui/menus';
import { createFindPanel, createStatusBar, createPageTabs, createTableTools, createMediaUI, revealBlock } from './ui/panels';
import { createAutosave, createUploads, Autosave, AutosaveOptions, UploadHandler, Uploads, UploadsOptions } from './features/persist';
import { getPages, activePage } from './core/builtin';
import { setIcons } from './ui/icons';
import { h } from './view/dom';

export interface EditorState {
  mode: 'classic' | 'block';
  readOnly: boolean;
  selection: Selection | null;
  /** marks active at the caret, or common to the whole selection */
  marks: MarkSet;
  /** type of the block holding the selection focus */
  blockType: string | null;
  blockAttrs: Record<string, any>;
  canUndo: boolean;
  canRedo: boolean;
  isEmpty: boolean;
  focused: boolean;
  /** increments with every document change */
  revision: number;
  pages: { id: string; title: string }[];
  activePage: string | null;
  suggesting: boolean;
}

const stateCache = new WeakMap<Editor, { key: number; state: EditorState }>();
const tick = new WeakMap<Editor, number>();

/**
 * Immutable snapshot of what controls usually render from. The same object is returned until
 * the editor emits `update`, so it can back `useSyncExternalStore` and Vue refs directly.
 */
export function getEditorState(editor: Editor): EditorState {
  const key = tick.get(editor) ?? 0;
  const hit = stateCache.get(editor);
  if (hit && hit.key === key) return hit.state;
  const sel = editor.selection;
  let marks: MarkSet = {};
  const fb = focusBlock(editor);
  if (sel?.type === 'text' && isCollapsed(sel) && fb) marks = { ...(typingMarks(editor, fb, sel.focus.offset) ?? {}) };
  else if (sel) {
    let first = true;
    for (const r of selectedRanges(editor)) {
      for (const c of sliceInline(r.block.content, r.from, r.to)) {
        if (first) {
          marks = { ...(c.marks ?? {}) };
          first = false;
        } else for (const k of Object.keys(marks)) if (JSON.stringify(c.marks?.[k]) !== JSON.stringify(marks[k])) delete marks[k];
      }
      if (!first && !Object.keys(marks).length) break;
    }
  }
  const block = fb ?? (sel?.type === 'block' ? editor.doc.get(sel.ids[0]) ?? null : null);
  const state: EditorState = {
    mode: editor.mode,
    readOnly: editor.readOnly,
    selection: sel,
    marks,
    blockType: block?.type ?? null,
    blockAttrs: block ? { ...block.attrs } : {},
    canUndo: editor.canUndo(),
    canRedo: editor.canRedo(),
    isEmpty: editor.isEmpty,
    focused: !!editor.view?.hasFocus(),
    revision: editor.revision,
    pages: getPages(editor).map((p) => ({ id: p.id, title: p.attrs.title ?? '' })),
    activePage: activePage(editor)?.id ?? null,
    suggesting: !!editor.storage.suggest?.active,
  };
  stateCache.set(editor, { key, state });
  return state;
}

/** Subscribe to state changes (document, selection, mode, focus...). Returns an unsubscribe function. */
export function subscribe(editor: Editor, fn: () => void): () => void {
  const bump = () => {
    tick.set(editor, (tick.get(editor) ?? 0) + 1);
    fn();
  };
  const offs = [editor.on('update', bump), editor.on('focus', bump), editor.on('blur', bump)];
  return () => offs.forEach((o) => o());
}

export interface CreateEditorOptions extends HeadlessOptions, ViewOptions {
  /** element (or selector) to mount into */
  element: HTMLElement | string;
  /** attach to an existing headless editor instead of creating one (the caller keeps ownership) */
  editor?: Editor;
  /**
   * Default controls. `false` renders only the editable surface (headless UI);
   * individual parts can be switched off or configured.
   */
  ui?:
    | false
    | {
        /** `false`, or the item ids to show ('|' = separator) */
        toolbar?: boolean | string[];
        floatingToolbar?: boolean | string[];
        slashMenu?: 'block' | 'always' | false;
        blockHandles?: boolean;
        tableTools?: boolean;
        find?: boolean;
        statusBar?: boolean;
        pageTabs?: boolean;
      };
  /** 'auto' follows prefers-color-scheme */
  theme?: 'light' | 'dark' | 'auto';
  /** skip the default visual theme; structural styles still apply */
  unstyled?: boolean;
  /** replace icons by name with SVG markup */
  icons?: Record<string, string>;
  /** host upload function; enables pasted / dropped / picked files */
  upload?: UploadHandler;
  uploadOptions?: Omit<UploadsOptions, 'upload'>;
  autosave?: AutosaveOptions;
  /** render LaTeX into an element (e.g. with KaTeX). Without it equations show their source. */
  renderMath?: (tex: string, el: HTMLElement, display: boolean) => void;
  /** max height of the scroll area, e.g. '60vh' */
  maxHeight?: string;
  onChange?: (editor: Editor) => void;
  onSelectionChange?: (editor: Editor) => void;
  onReady?: (instance: ZEditor) => void;
}

export interface ZEditor {
  readonly editor: Editor;
  readonly view: EditorView;
  /** outer element created inside the mount point */
  readonly element: HTMLElement;
  readonly commands: Editor['commands'];
  readonly uploads: Uploads | null;
  readonly autosave: Autosave | null;
  getJSON(): ReturnType<Editor['getJSON']>;
  setJSON(doc: unknown): string[];
  getState(): EditorState;
  subscribe(fn: () => void): () => void;
  setMode(mode: 'classic' | 'block'): void;
  setReadOnly(readOnly: boolean): void;
  focus(): void;
  destroy(): void;
}

/** Mount a ready-made editor. */
export function createEditor(options: CreateEditorOptions): ZEditor {
  const mount = typeof options.element === 'string' ? (document.querySelector(options.element) as HTMLElement | null) : options.element;
  if (!mount) throw new Error('zeditor: mount element not found');
  const owns = !options.editor;
  const editor =
    options.editor ??
    new Editor({
      ...options,
      baseExtensions: options.baseExtensions ?? defaultExtensions(options.features, { mentions: options.mentions, characterLimit: options.characterLimit }),
    });
  if (options.renderMath) editor.storage.renderMath = options.renderMath;
  const ui = options.ui === false ? null : { toolbar: true, floatingToolbar: true, slashMenu: 'block' as const, blockHandles: true, tableTools: true, find: true, statusBar: false, pageTabs: true, ...(options.ui ?? {}) };

  const theme = options.theme ?? 'light';
  const wrapper = h('div', { class: 'zeditor' + (options.unstyled ? '' : ' z-theme'), 'data-mode': editor.mode, 'data-theme': theme });
  const top = h('div', { class: 'z-top' });
  const scroll = h('div', { class: 'z-scroll' });
  if (options.maxHeight) scroll.style.maxHeight = options.maxHeight;
  const content = h('div', { class: 'z-editable' });
  if (options.placeholder ?? editor.label('placeholder')) content.dataset.placeholder = options.placeholder ?? editor.label('placeholder');
  const bottom = h('div', { class: 'z-bottom' });
  scroll.append(content);
  wrapper.append(top, scroll, bottom);
  mount.append(wrapper);

  const view = new EditorView(editor, content, options);
  const parts: { destroy(): void }[] = [];
  let toolbar: UIHandle | null = null;
  const uploads = options.upload ? createUploads(editor, { upload: options.upload, ...(options.uploadOptions ?? {}) }) : null;
  const autosave = options.autosave ? createAutosave(editor, options.autosave) : null;
  if (ui) {
    if (ui.toolbar) {
      toolbar = createToolbar(editor, { items: Array.isArray(ui.toolbar) ? ui.toolbar : undefined, icons: options.icons });
      top.append(toolbar.dom);
      parts.push(toolbar);
    }
    if (ui.pageTabs && editor.hasExtension('pages')) parts.push(createPageTabs(editor, top));
    if (ui.find) parts.push(createFindPanel(editor, top));
    if (ui.floatingToolbar) parts.push(createFloatingToolbar(editor, wrapper, { items: Array.isArray(ui.floatingToolbar) ? ui.floatingToolbar : undefined, icons: options.icons, when: () => editor.mode === 'block' || !ui.toolbar }));
    parts.push(createTypeahead(editor, wrapper, { slash: ui.slashMenu, icons: options.icons }));
    if (ui.blockHandles) parts.push(createBlockHandles(editor, wrapper, { icons: options.icons }));
    if (ui.tableTools && editor.hasExtension('tables')) parts.push(createTableTools(editor, wrapper));
    if (ui.statusBar) parts.push(createStatusBar(editor, bottom));
    parts.push(createLinkPopover(editor, wrapper));
    parts.push(createMediaUI(editor, wrapper, uploads));
  } else {
    // headless UI: typeahead sources still need a menu only if the host renders one; uploads still work
    parts.push({ destroy: editor.on('ui:files', (ev: any) => void uploads?.uploadFiles(ev.files)) });
    parts.push({ destroy: editor.on('ui:retryUpload', (ev: any) => void uploads?.retry(ev.id)) });
  }
  const offs = [
    editor.on('mode', () => {
      wrapper.dataset.mode = editor.mode;
    }),
    editor.on('change', () => options.onChange?.(editor)),
    editor.on('selection', () => options.onSelectionChange?.(editor)),
  ];
  editor.emit('mount', { view, element: wrapper });
  // direct links to blocks: #<block id>
  if (typeof location !== 'undefined' && location.hash.length > 1) {
    const id = decodeURIComponent(location.hash.slice(1));
    if (editor.doc.get(id)) setTimeout(() => revealBlock(editor, id), 0);
  }
  let destroyed = false;
  const instance: ZEditor = {
    editor,
    view,
    element: wrapper,
    commands: editor.commands,
    uploads,
    autosave,
    getJSON: () => editor.getJSON(),
    setJSON: (doc) => editor.setJSON(doc),
    getState: () => getEditorState(editor),
    subscribe: (fn) => subscribe(editor, fn),
    setMode: (m) => editor.setMode(m),
    setReadOnly: (r) => editor.setReadOnly(r),
    focus: () => view.focus(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offs.forEach((o) => o());
      for (const p of parts.reverse()) p.destroy();
      autosave?.destroy();
      uploads?.destroy();
      view.destroy();
      wrapper.remove();
      if (owns) editor.destroy();
    },
  };
  options.onReady?.(instance);
  return instance;
}

export * from './core';
export { EditorView } from './view/view';
export type { ViewOptions, HighlightRange, HighlightSource } from './view/view';
export type { NodeRenderer, NodeViewHandle, InlineRenderer, MarkRenderer, RenderContext } from './view/render';
export { nodeRenderers, inlineRenderers, markRenderers, inlinePrompt, renderMath } from './view/render';
export { h as el, keyName, formatShortcut, place } from './view/dom';
export { createToolbar, createFloatingToolbar, createLinkPopover, PALETTE, HIGHLIGHTS } from './ui/toolbar';
export type { ToolbarOptions, UIHandle } from './ui/toolbar';
export { createTypeahead, createBlockHandles } from './ui/menus';
export { createFindPanel, createStatusBar, createPageTabs, createTableTools, createMediaUI, createReviewPanel, revealBlock } from './ui/panels';
export { icon, setIcons } from './ui/icons';
export { copyPayload, cutPayload, pasteData, insertContent, insertInlineContent, parseTSV, tableToMatrix, MIME as CLIPBOARD_MIME } from './core/clipboard';
void setIcons;
