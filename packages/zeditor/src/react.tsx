/**
 * React adapter. The editor owns its document; React owns configuration and chrome.
 * Re-rendering the component never touches the document or the caret.
 */
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { createEditor, getEditorState, subscribe, CreateEditorOptions, EditorState, ZEditor as Instance } from './index';
import type { Editor } from './core/editor';
import type { Block, InlineAtom } from './core/model';
import type { NodeRenderer, InlineRenderer, NodeViewHandle } from './view/render';

export interface NodeViewProps {
  editor: Editor;
  /** current block (attrs, id, type). A new object identity is passed whenever attrs change. */
  block: { id: string; type: string; attrs: Record<string, any> };
  /** shallow-merge attrs into the block (undoable) */
  updateAttrs: (attrs: Record<string, any>) => void;
  /** element that holds the block's editable content / child blocks; place it with <NodeContent /> */
  contentElement: HTMLElement | null;
}
export interface InlineViewProps {
  editor: Editor;
  atom: InlineAtom;
}

/** Slot for the editable part of a custom node view (child blocks or inline content). */
export function NodeContent({ element, className }: { element: HTMLElement | null; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || !element) return;
    host.appendChild(element);
    return () => {
      if (element.parentNode === host) host.removeChild(element);
    };
  }, [element]);
  return <div ref={ref} className={className} style={{ display: 'contents' }} />;
}

interface PortalEntry {
  key: string;
  container: HTMLElement;
  render: () => React.ReactNode;
}

export interface ZEditorProps extends Omit<CreateEditorOptions, 'element' | 'renderers' | 'inlineRenderers'> {
  className?: string;
  style?: React.CSSProperties;
  /** React components for block node types (rendered through portals) */
  nodeViews?: Record<string, React.ComponentType<NodeViewProps>>;
  /** React components for inline atom types */
  inlineViews?: Record<string, React.ComponentType<InlineViewProps>>;
  /** DOM-level renderers, as accepted by `createEditor` */
  renderers?: Record<string, NodeRenderer>;
  inlineRenderers?: Record<string, InlineRenderer>;
  /** rendered inside the editor context, e.g. a custom toolbar */
  children?: React.ReactNode;
}

const Ctx = createContext<Instance | null>(null);
/** The editor instance from the nearest <ZEditor>, or null before it has mounted. */
export function useEditor(): Instance | null {
  return useContext(Ctx);
}

const EMPTY: EditorState = { mode: 'classic', readOnly: false, selection: null, marks: {}, blockType: null, blockAttrs: {}, canUndo: false, canRedo: false, isEmpty: true, focused: false, revision: 0, pages: [], activePage: null, suggesting: false };

/**
 * Subscribe to editor state. Pass a selector to re-render only when the selected value changes
 * (compared with Object.is; return primitives or stable references).
 */
export function useEditorState<T = EditorState>(instance: Instance | Editor | null | undefined, selector?: (s: EditorState) => T): T {
  const editor: Editor | null = instance ? ((instance as Instance).editor ?? (instance as Editor)) : null;
  const sub = useMemo(() => (fn: () => void) => (editor ? subscribe(editor, fn) : () => {}), [editor]);
  const get = () => {
    const s = editor ? getEditorState(editor) : EMPTY;
    return selector ? selector(s) : (s as unknown as T);
  };
  return useSyncExternalStore(sub, get, get);
}

/**
 * Mounts an editor. `content` is the *initial* document: later changes to that prop are
 * ignored on purpose (use `ref.current.setJSON()` to load another document), so parent
 * re-renders can never reset the document or the caret. `mode` and `readOnly` are live.
 */
export const ZEditor = forwardRef<Instance | null, ZEditorProps>(function ZEditor(props, ref) {
  const { className, style, nodeViews, inlineViews, children, mode, readOnly, ...options } = props;
  const host = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<Instance | null>(null);
  const [portals, setPortals] = useState<PortalEntry[]>([]);
  const latest = useRef({ options, nodeViews, inlineViews });
  latest.current = { options, nodeViews, inlineViews };

  useEffect(() => {
    if (!host.current) return;
    const live = new Map<string, PortalEntry>();
    let scheduled = false;
    let disposed = false;
    const flush = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!disposed) setPortals([...live.values()]);
      });
    };
    let seq = 0;
    const { options: o, nodeViews: nv, inlineViews: iv } = latest.current;
    const renderers: Record<string, NodeRenderer> = { ...(o.renderers ?? {}) };
    for (const type of Object.keys(nv ?? {})) {
      renderers[type] = (block: Block, ctx): NodeViewHandle => {
        const spec = ctx.editor.schema.node(type);
        const dom = document.createElement('div');
        dom.className = 'z-react-node';
        const slot = spec && spec.kind !== 'atom' ? document.createElement('div') : null;
        if (slot) slot.className = spec!.kind === 'text' ? 'z-content' : 'z-react-children';
        if (spec?.kind === 'atom') dom.contentEditable = 'false';
        const key = 'n' + seq++;
        let cur = { id: block.id, type: block.type, attrs: block.attrs };
        const entry: PortalEntry = {
          key,
          container: dom,
          render: () => {
            const C = latest.current.nodeViews?.[type];
            return C ? <C editor={ctx.editor} block={cur} contentElement={slot} updateAttrs={(attrs) => void ctx.editor.exec('setBlockAttrs', cur.id, attrs)} /> : null;
          },
        };
        live.set(key, entry);
        flush();
        return {
          dom,
          contentDOM: spec?.kind === 'text' ? slot! : undefined,
          childrenDOM: spec?.kind === 'container' ? slot! : undefined,
          update: (b) => {
            cur = { id: b.id, type: b.type, attrs: b.attrs };
            live.set(key, { ...entry });
            flush();
          },
          destroy: () => {
            live.delete(key);
            flush();
          },
        };
      };
    }
    const inlineRenderers: Record<string, InlineRenderer> = { ...(o.inlineRenderers ?? {}) };
    for (const type of Object.keys(iv ?? {})) {
      inlineRenderers[type] = (atom, ctx) => {
        const dom = document.createElement('span');
        dom.className = 'z-react-inline';
        const key = 'i' + seq++;
        live.set(key, {
          key,
          container: dom,
          render: () => {
            const C = latest.current.inlineViews?.[type];
            return C ? <C editor={ctx.editor} atom={atom} /> : null;
          },
        });
        flush();
        return dom;
      };
    }
    const z = createEditor({ ...o, mode, readOnly, element: host.current, renderers, inlineRenderers });
    // inline atom elements are discarded by the view without notice: drop portals whose container left the document
    const sweep = z.editor.on('transaction', () => {
      let changed = false;
      for (const [k, e] of live) if (k[0] === 'i' && !e.container.isConnected) changed = live.delete(k) || changed;
      if (changed) flush();
    });
    setInstance(z);
    return () => {
      disposed = true;
      sweep();
      z.destroy();
      setInstance(null);
      setPortals([]);
    };
    // the editor is created once per mount; configuration changes need a new `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (instance && mode && instance.editor.mode !== mode) instance.setMode(mode);
  }, [instance, mode]);
  useEffect(() => {
    if (instance && readOnly !== undefined && instance.editor.readOnly !== readOnly) instance.setReadOnly(readOnly);
  }, [instance, readOnly]);
  useImperativeHandle<Instance | null, Instance | null>(ref, () => instance, [instance]);

  return (
    <Ctx.Provider value={instance}>
      {children}
      <div ref={host} className={className} style={style} />
      {portals.filter((p) => p.container.isConnected || p.key[0] === 'n').map((p) => createPortal(p.render(), p.container, p.key))}
    </Ctx.Provider>
  );
});

export type { Instance as ZEditorInstance, EditorState };
