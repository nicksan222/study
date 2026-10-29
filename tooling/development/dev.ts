import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { App, serve } from '@study/server/runtime';
import { createServer } from 'vite-plus';
import type { ViteDevServer } from 'vite-plus';

const root = resolve(import.meta.dirname, '../..');

const database = process.env.STUDY_DATABASE ?? resolve(root, 'target/web/study.sqlite');

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
  app.workers.start();
  web = await createServer({
    configFile: resolve(root, 'apps/web/vite.config.ts'),
    server: { proxy: { '/trpc': { target: server.url } } }
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
