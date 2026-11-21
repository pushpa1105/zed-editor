/**
 * Vue 3 adapter (render functions only, so the package needs no SFC compiler).
 * The editor owns its document; Vue owns configuration and chrome.
 */
import { Teleport, defineComponent, h, inject, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch, markRaw, type Component, type InjectionKey, type PropType, type Ref, type ShallowRef } from 'vue';
import { createEditor, getEditorState, subscribe, CreateEditorOptions, EditorState, ZEditor as Instance } from './index';
import type { Editor } from './core/editor';
import type { Block } from './core/model';
import type { NodeRenderer, InlineRenderer, NodeViewHandle } from './view/render';

const KEY: InjectionKey<ShallowRef<Instance | null>> = Symbol('zeditor');

/** The editor instance provided by the nearest <ZEditor> (a shallow ref, null until mounted). */
export function useEditor(): ShallowRef<Instance | null> {
  return inject(KEY, shallowRef(null));
}

/** Reactive editor state. Accepts an instance, an editor, or a ref to either. */
export function useEditorState(source: Ref<Instance | Editor | null | undefined> | Instance | Editor | null): ShallowRef<EditorState | null> {
  const state = shallowRef<EditorState | null>(null);
  let off: (() => void) | null = null;
  const bind = (value: Instance | Editor | null | undefined) => {
    off?.();
    off = null;
    const editor: Editor | null = value ? ((value as Instance).editor ?? (value as Editor)) : null;
    if (!editor) {
      state.value = null;
      return;
    }
    state.value = getEditorState(editor);
    off = subscribe(editor, () => {
      state.value = getEditorState(editor);
    });
  };
  if (source && typeof source === 'object' && 'value' in source) watch(source as Ref<any>, bind, { immediate: true });
  else bind(source as Instance | Editor | null);
  onBeforeUnmount(() => off?.());
  return state;
}

/** Slot for the editable part of a custom node view: mounts the element the editor renders into. */
export const NodeContent = defineComponent({
  name: 'ZNodeContent',
  props: { element: { type: Object as PropType<HTMLElement | null>, default: null } },
  setup(props) {
    const host = ref<HTMLElement | null>(null);
    const place = () => {
      if (host.value && props.element && props.element.parentNode !== host.value) host.value.appendChild(props.element);
    };
    onMounted(place);
    watch(() => props.element, place);
    return () => h('div', { ref: host, style: 'display:contents' });
  },
});

interface PortalEntry {
  key: string;
  container: HTMLElement;
  component: Component;
  props: Record<string, any>;
}

export const ZEditor = defineComponent({
  name: 'ZEditor',
  props: {
    /** options for `createEditor` (read once at mount) */
    options: { type: Object as PropType<Omit<CreateEditorOptions, 'element'>>, default: () => ({}) },
    mode: { type: String as PropType<'classic' | 'block'>, default: undefined },
    readOnly: { type: Boolean, default: undefined },
    /** Vue components for block node types (teleported into the document) */
    nodeViews: { type: Object as PropType<Record<string, Component>>, default: () => ({}) },
    /** Vue components for inline atom types */
    inlineViews: { type: Object as PropType<Record<string, Component>>, default: () => ({}) },
  },
  emits: {
    ready: (_z: Instance) => true,
    change: (_editor: Editor) => true,
    selection: (_editor: Editor) => true,
  },
  setup(props, { emit, slots, expose }) {
    const host = ref<HTMLElement | null>(null);
    const instance = shallowRef<Instance | null>(null);
    const portals = shallowRef<PortalEntry[]>([]);
    provide(KEY, instance);
    const live = new Map<string, PortalEntry>();
    let seq = 0;
    let disposed = false;
    const flush = () => {
      if (!disposed) portals.value = [...live.values()];
    };
    onMounted(() => {
      const o = props.options;
      const renderers: Record<string, NodeRenderer> = { ...(o.renderers ?? {}) };
      for (const type of Object.keys(props.nodeViews)) {
        renderers[type] = (block: Block, ctx): NodeViewHandle => {
          const spec = ctx.editor.schema.node(type);
          const dom = document.createElement('div');
          dom.className = 'z-vue-node';
          const slot = spec && spec.kind !== 'atom' ? document.createElement('div') : null;
          if (slot) slot.className = spec!.kind === 'text' ? 'z-content' : 'z-vue-children';
          if (spec?.kind === 'atom') dom.contentEditable = 'false';
          const key = 'n' + seq++;
          let id = block.id;
          const make = (b: Block): PortalEntry => ({
            key,
            container: dom,
            component: markRaw(props.nodeViews[type] as object) as Component,
            props: {
              editor: markRaw(ctx.editor),
              block: { id: b.id, type: b.type, attrs: b.attrs },
              contentElement: slot,
              updateAttrs: (attrs: Record<string, any>) => void ctx.editor.exec('setBlockAttrs', id, attrs),
            },
          });
          live.set(key, make(block));
          flush();
          return {
            dom,
            contentDOM: spec?.kind === 'text' ? slot! : undefined,
            childrenDOM: spec?.kind === 'container' ? slot! : undefined,
            update: (b) => {
              id = b.id;
              live.set(key, make(b));
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
      for (const type of Object.keys(props.inlineViews)) {
        inlineRenderers[type] = (atom, ctx) => {
          const dom = document.createElement('span');
          dom.className = 'z-vue-inline';
          const key = 'i' + seq++;
          live.set(key, { key, container: dom, component: markRaw(props.inlineViews[type] as object) as Component, props: { editor: markRaw(ctx.editor), atom } });
          flush();
          return dom;
        };
      }
      const z = createEditor({
        ...o,
        mode: props.mode ?? o.mode,
        readOnly: props.readOnly ?? o.readOnly,
        element: host.value!,
        renderers,
        inlineRenderers,
        onChange: (e) => {
          o.onChange?.(e);
          emit('change', e);
        },
        onSelectionChange: (e) => {
          o.onSelectionChange?.(e);
          emit('selection', e);
        },
      });
      z.editor.on('transaction', () => {
        let changed = false;
        for (const [k, e] of live) if (k[0] === 'i' && !e.container.isConnected) changed = live.delete(k) || changed;
        if (changed) flush();
      });
      instance.value = markRaw(z) as Instance;
      emit('ready', z);
    });
    watch(
      () => props.mode,
      (m) => m && instance.value && instance.value.editor.mode !== m && instance.value.setMode(m),
    );
    watch(
      () => props.readOnly,
      (r) => r !== undefined && instance.value && instance.value.setReadOnly(r),
    );
    onBeforeUnmount(() => {
      disposed = true;
      instance.value?.destroy();
      instance.value = null;
      live.clear();
    });
    expose({ instance });
    return () => [
      slots.default?.({ instance: instance.value }),
      h('div', { ref: host, class: 'z-vue-host' }),
      ...portals.value.map((p) => h(Teleport, { to: p.container, key: p.key }, [h(p.component as any, p.props)])),
    ];
  },
});

export type { Instance as ZEditorInstance, EditorState };
