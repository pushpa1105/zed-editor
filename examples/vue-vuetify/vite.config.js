import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // ../shared/extensions.js lives outside this app: resolve the editor from this app's node_modules
  resolve: { dedupe: ['@z-packages/zeditor', 'vue'] },
  server: { fs: { allow: ['..'] }, port: 4175 },
  base: './',
});
