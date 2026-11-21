import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // ../shared/extensions.js lives outside this app: resolve the editor from this app's node_modules
  resolve: { dedupe: ['@z-packages/zeditor', 'react', 'react-dom'] },
  server: { fs: { allow: ['..'] }, port: 4174 },
  base: './',
});
