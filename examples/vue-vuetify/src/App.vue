<script setup>
import { computed, markRaw, ref, shallowRef } from 'vue';
import { ZEditor, useEditorState } from '@z-packages/zeditor/vue';
import { mdiFormatBold, mdiFormatItalic, mdiFormatUnderline, mdiCodeTags, mdiUndo, mdiRedo, mdiFormatListBulleted, mdiFormatListNumbered, mdiFormatListChecks, mdiTable, mdiAlertBoxOutline, mdiLink } from '@mdi/js';
import { issueRefExtension, calloutExtension, SHARED_DOCUMENT } from '../../shared/extensions.js';
import NoticeView from './NoticeView.vue';

const KEY = 'zeditor-vue-example';
const saved = localStorage.getItem(KEY);

// read once at mount: the editor owns its document from then on
const options = {
  content: saved ? JSON.parse(saved) : SHARED_DOCUMENT,
  extensions: [issueRefExtension(), calloutExtension()],
  // the built-in toolbar is switched off: the Vuetify toolbar below replaces it
  ui: { toolbar: false, statusBar: true },
  placeholder: 'Write something…',
};
const nodeViews = { notice: markRaw(NoticeView) };
// a re-mounted editor starts from what was saved last
const currentOptions = () => ({ ...options, content: JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? options.content });

const instance = shallowRef(null);
const state = useEditorState(instance);
const mode = ref('classic');
const counter = ref(0);
const editorKey = ref(0); // changing the key unmounts and re-mounts the editor component
function onReady(z) {
  instance.value = z;
  window.__z = z; // handy in the console
}

const cmd = computed(() => instance.value?.commands);
const marks = [
  { id: 'bold', icon: mdiFormatBold, label: 'Bold' },
  { id: 'italic', icon: mdiFormatItalic, label: 'Italic' },
  { id: 'underline', icon: mdiFormatUnderline, label: 'Underline' },
  { id: 'code', icon: mdiCodeTags, label: 'Inline code' },
];
const activeMarks = computed(() => marks.filter((m) => state.value?.marks[m.id]).map((m) => m.id));
const blockTypes = [
  { title: 'Paragraph', value: 'paragraph' },
  { title: 'Heading 1', value: 'heading:1' },
  { title: 'Heading 2', value: 'heading:2' },
  { title: 'Heading 3', value: 'heading:3' },
  { title: 'Quote', value: 'quote' },
  { title: 'Code block', value: 'code' },
];
const blockType = computed(() => {
  const s = state.value;
  if (!s?.blockType) return 'paragraph';
  return s.blockType === 'heading' ? 'heading:' + s.blockAttrs.level : s.blockType;
});
function setBlockType(value) {
  const [type, level] = value.split(':');
  cmd.value.setBlockType(type, level ? { level: Number(level) } : undefined);
  instance.value.focus();
}
function list(kind) {
  cmd.value.toggleBlockType('list', { kind });
  instance.value.focus();
}
// keep the text selection when a toolbar button is pressed with the pointer
const keep = (e) => e.preventDefault();

function save() {
  localStorage.setItem(KEY, JSON.stringify(instance.value.getJSON()));
}
function reload() {
  instance.value.setJSON(JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? SHARED_DOCUMENT);
}
</script>

<template>
  <v-app>
    <v-main>
      <v-container style="max-width: 900px">
        <h1 class="text-h5 mb-3">zeditor — Vue 3 + Vuetify</h1>
        <div class="d-flex flex-wrap ga-2 mb-3" role="group" aria-label="Editor controls">
          <v-btn-toggle v-model="mode" mandatory density="comfortable" color="primary" aria-label="Editing mode">
            <v-btn value="classic">Classic</v-btn>
            <v-btn value="block">Blocks</v-btn>
          </v-btn-toggle>
          <v-btn @click="save">Save</v-btn>
          <v-btn @click="reload">Reload saved</v-btn>
          <v-btn @click="instance.setJSON(SHARED_DOCUMENT)">Load shared document</v-btn>
          <v-btn variant="text" @click="counter++">Re-render ({{ counter }})</v-btn>
          <v-btn variant="text" data-testid="remount" @click="save(); editorKey++">Remount editor</v-btn>
        </div>

        <v-card variant="outlined">
          <!-- custom toolbar: Vuetify controls driven by public state and commands -->
          <v-toolbar density="compact" color="surface" role="toolbar" aria-label="Formatting (Vuetify)">
            <v-btn :icon="mdiUndo" aria-label="Undo" :disabled="!state?.canUndo" @mousedown="keep" @click="cmd.undo()" />
            <v-btn :icon="mdiRedo" aria-label="Redo" :disabled="!state?.canRedo" @mousedown="keep" @click="cmd.redo()" />
            <v-divider vertical class="mx-1" />
            <v-select
              :model-value="blockType"
              :items="blockTypes"
              aria-label="Block type"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 180px"
              class="mx-1"
              @update:model-value="setBlockType"
            />
            <v-btn-toggle :model-value="activeMarks" multiple density="compact" aria-label="Text style">
              <v-btn v-for="m in marks" :key="m.id" :value="m.id" :icon="m.icon" :aria-label="m.label" :data-mark="m.id" @mousedown="keep" @click="cmd.toggleMark(m.id)" />
            </v-btn-toggle>
            <v-btn :icon="mdiLink" aria-label="Link" @mousedown="keep" @click="instance.editor.emit('ui:link')" />
            <v-divider vertical class="mx-1" />
            <v-btn :icon="mdiFormatListBulleted" aria-label="Bulleted list" @mousedown="keep" @click="list('bullet')" />
            <v-btn :icon="mdiFormatListNumbered" aria-label="Numbered list" @mousedown="keep" @click="list('ordered')" />
            <v-btn :icon="mdiFormatListChecks" aria-label="Checklist" @mousedown="keep" @click="list('check')" />
            <v-btn :icon="mdiTable" aria-label="Insert table" @mousedown="keep" @click="cmd.insertTable(3, 3)" />
            <v-btn :icon="mdiAlertBoxOutline" aria-label="Insert notice" data-testid="insert-notice" @mousedown="keep" @click="cmd.insertNotice()" />
          </v-toolbar>
          <v-divider />
          <ZEditor :key="editorKey" :options="currentOptions()" :mode="mode" :node-views="nodeViews" @ready="onReady" />
        </v-card>
        <p class="text-caption mt-2" data-testid="summary">revision {{ state?.revision ?? 0 }} · block: {{ state?.blockType ?? '–' }}</p>
      </v-container>
    </v-main>
  </v-app>
</template>

<style>
/* the Vuetify card supplies the frame */
.zeditor.z-theme {
  border: 0;
}
</style>
