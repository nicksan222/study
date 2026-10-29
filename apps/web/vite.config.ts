import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    tanstackRouter({
      target: 'react',
      quoteStyle: 'single',
      routesDirectory: fileURLToPath(new URL('./src/routes', import.meta.url)),
      generatedRouteTree: fileURLToPath(new URL('./src/routeTree.gen.ts', import.meta.url)),
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
    proxy: {
      '/trpc': {
        target: process.env.STUDY_SERVER_URL ?? 'http://127.0.0.1:5201',
        configure: (proxy) => {
          // Browser requests enter through the same-origin Vite proxy.
          proxy.on('proxyReq', (request) => request.removeHeader('origin'));
        }
      }
    }
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      '../../packages/ui/src/**/*.test.{ts,tsx}',
      '../../packages/localization/test/**/*.test.tsx'
    ],
    restoreMocks: true
  }
});
