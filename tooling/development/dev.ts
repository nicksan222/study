import { BunFileSystem } from '@effect/platform-bun';
import { BunPath } from '@effect/platform-bun';
import { Effect, FileSystem, Path } from 'effect';
import { createServer } from 'vite-plus';
import type { ViteDevServer } from 'vite-plus';

import { developmentDatabasePath } from './database-path.ts';
import { studyRpcProxy } from './rpc-proxy.ts';

const { dirname, resolve } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

const [major = 0, minor = 0, patch = 0] =
  process.versions.bun?.split(/[.-]/).slice(0, 3).map(Number) ?? [];

if (major < 1 || (major === 1 && (minor < 4 || (minor === 4 && patch < 4))))
  throw new Error(
    'Study requires Bun 1.4.4 or newer. Run bun upgrade, then bun install --frozen-lockfile.'
  );

const { App, serve } = await import('@study/server/runtime');

const root = resolve(import.meta.dirname, '../..');

const database = developmentDatabasePath();

await Effect.runPromise(
  Effect.provide(
    Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.makeDirectory(dirname(database), { recursive: true })
    ),
    BunFileSystem.layer
  )
);

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
