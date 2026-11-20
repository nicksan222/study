import { studyRpcProxy } from '@study/tooling/development/rpc-proxy';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { defineConfig, normalizePath } from 'vite-plus';

const pdfPackage = Bun.pathToFileURL(Bun.resolveSync('pdfjs-dist/package.json', import.meta.dir));

const reactPdfPackage = Bun.pathToFileURL(
  Bun.resolveSync('react-pdf/package.json', import.meta.dir)
);

const pdfAsset = (entry: string) => normalizePath(Bun.fileURLToPath(new URL(entry, pdfPackage)));

const pdfAssets = ['cmaps', 'iccs', 'standard_fonts', 'wasm'].map((folder) => ({
  src: pdfAsset(folder),
  dest: `pdf-assets/${folder}`,
  rename: { stripBase: true } as const
}));

export default defineConfig({
  root: Bun.fileURLToPath(new URL('.', import.meta.url)),
  // The shared client also runs in system webviews that can lag modern browsers.
  resolve: {
    alias: [{ find: /^pdfjs-dist$/, replacement: pdfAsset('legacy/build/pdf.mjs') }]
  },
  plugins: [
    tanstackRouter({
      target: 'react',
      quoteStyle: 'single',
      routesDirectory: Bun.fileURLToPath(new URL('./src/routes', import.meta.url)),
      generatedRouteTree: Bun.fileURLToPath(new URL('./src/routeTree.gen.ts', import.meta.url)),
      autoCodeSplitting: true
    }),
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        ...pdfAssets,
        { src: pdfAsset('LICENSE'), dest: 'pdf-assets', rename: { stripBase: true } },
        {
          src: normalizePath(Bun.fileURLToPath(new URL('LICENSE', reactPdfPackage))),
          dest: 'pdf-assets',
          rename: { stripBase: true, name: 'LICENSE_REACT_PDF' }
        }
      ]
    })
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
    server: {
      deps: {
        // Setup-owned providers and app-lifetime state keep one identity when subjects reset.
        external: [
          /\/packages\/(?:contracts|ui)\/src\//,
          /\/apps\/client\/src\/(?:lib\/i18n|features\/assistant\/note|features\/note-workspace\/start-drafts\.queries)\.tsx?$/
        ]
      }
    },
    environment: 'jsdom',
    silent: 'passed-only',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      '../../packages/ui/src/**/*.test.{ts,tsx}',
      '../../packages/localization/test/**/*.test.tsx',
      '../../packages/testing/test/react.test.ts'
    ],
    restoreMocks: true
  }
});
