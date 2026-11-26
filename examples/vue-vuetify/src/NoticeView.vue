<script setup>
// Host rendering for the shared `notice` block: a Vuetify alert instead of the default DOM.
// The block's child blocks stay fully editable inside <NodeContent>.
import { computed } from 'vue';
import { NodeContent } from '@buffmomo/zeditor/vue';

const props = defineProps({
  editor: { type: Object, required: true },
  block: { type: Object, required: true },
  contentElement: { type: Object, default: null },
  updateAttrs: { type: Function, required: true },
});
const types = { tip: 'info', warning: 'warning', danger: 'error' };
const type = computed(() => types[props.block.attrs.tone] ?? 'info');
const tones = ['tip', 'warning', 'danger'];
</script>

<template>
  <v-alert :type="type" variant="tonal" border="start" class="my-2 notice-alert" :data-tone="block.attrs.tone">
    <template #title>
      <!-- controls inside the document must be marked so the editor ignores their input -->
      <div contenteditable="false" data-z-ignore class="d-flex align-center ga-2 w-100">
        <input
          class="notice-title flex-grow-1"
          aria-label="Notice title"
          :value="block.attrs.title"
          :readonly="editor.readOnly"
          @change="updateAttrs({ title: $event.target.value })"
          @keydown.stop
        />
        <v-btn-toggle :model-value="block.attrs.tone" density="compact" variant="outlined" mandatory aria-label="Notice tone" @update:model-value="updateAttrs({ tone: $event })">
          <v-btn v-for="t in tones" :key="t" :value="t" size="x-small">{{ t }}</v-btn>
        </v-btn-toggle>
      </div>
    </template>
    <NodeContent :element="contentElement" />
  </v-alert>
</template>

<style scoped>
.notice-title {
  font: inherit;
  font-weight: 700;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  min-width: 0;
}
</style>
