import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { App, serve } from '@study/server/runtime';
import { createServer } from 'vite-plus';
import type { ViteDevServer } from 'vite-plus';

import { developmentDatabasePath } from './database-path.ts';
import { studyRpcProxy } from './rpc-proxy.ts';

const root = resolve(import.meta.dirname, '../..');

const database = developmentDatabasePath();

await mkdir(dirname(database), { recursive: true });

const app = await App.open({ path: database });

let server: Awaited<ReturnType<typeof serve>> | undefined;

let web: ViteDevServer | undefined;

let closing: Promise<void> | undefined;

const close = () =>
  (closing ??= (async () => {
    try {
      await web?.close();
    } finally {
      try {
        await server?.close();
      } finally {
        await app.close();
      }
    }
  })());

try {
  server = await serve(app);
  await app.workers.start();
  web = await createServer({
    // Watch mode must not observe Vite's disposable bundled configuration files.
    configLoader: 'native',
    configFile: resolve(root, 'apps/web/vite.config.ts'),
    server: { proxy: studyRpcProxy(server.url) }
  });
  await web.listen();
  web.printUrls();
} catch (error) {
  await close();

  throw error;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}
