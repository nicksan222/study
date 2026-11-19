import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  root: Bun.fileURLToPath(new URL('.', import.meta.url)),
  base: '/study/mobile/',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true }
});
