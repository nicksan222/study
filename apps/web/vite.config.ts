import { studyRpcProxy } from '@study/tooling/development/rpc-proxy';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  root: Bun.fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    tanstackRouter({
      target: 'react',
      quoteStyle: 'single',
      routesDirectory: Bun.fileURLToPath(new URL('./src/routes', import.meta.url)),
      generatedRouteTree: Bun.fileURLToPath(new URL('./src/routeTree.gen.ts', import.meta.url)),
      autoCodeSplitting: true
    }),
    react(),
    tailwindcss()
  ],
  clearScreen: false,
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Host edits on Docker bind mounts do not reliably emit filesystem events.
    watch: { usePolling: await Bun.file('/.dockerenv').exists(), interval: 300 },
    proxy: studyRpcProxy(process.env.STUDY_SERVER_URL ?? 'http://127.0.0.1:5201')
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    silent: 'passed-only',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      '../../packages/ui/src/**/*.test.{ts,tsx}',
      '../../packages/localization/test/**/*.test.tsx'
    ],
    restoreMocks: true
  }
});
