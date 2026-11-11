import { StudyRpc } from '@study/contracts/rpc';
import { Language } from '@study/contracts/settings/types';
import { createTestDatabase } from '@study/db/testing';
import { makeStudyClient } from '@study/server/client';
import { App, serve } from '@study/server/runtime';
import { studyRpcProxy } from '@study/tooling/development/rpc-proxy';
import { Effect } from 'effect';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { createServer } from 'vite-plus';

type Cleanup = () => void | Promise<void>;

/** Each invocation owns the entire stack, including resources acquired before a startup failure. */
export async function withWebE2e(run: (fixture: { page: Page }) => Promise<void>): Promise<void> {
  const cleanup: Cleanup[] = [];
  const failures: unknown[] = [];

  try {
    const database = await createTestDatabase();

    cleanup.push(() => database.cleanup());
    const app = await App.open({ path: database.path });

    cleanup.push(() => app.close());
    const server = await serve(app);

    cleanup.push(() => server.close());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
          const settings = yield* client['settings.appSettings']({});

          yield* client['settings.saveAppSettings']({
            ...settings,
            language: Language.ENGLISH,
            onboarded: true
          });
        })
      )
    );
    const web = await createServer({
      configFile: Bun.fileURLToPath(new URL('../../../vite.config.ts', import.meta.url)),
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        hmr: false,
        proxy: studyRpcProxy(server.url)
      }
    });

    cleanup.push(() => web.close());
    await web.listen();
    const address = web.httpServer?.address();

    if (!address || typeof address === 'string') throw new Error('Vite did not open a TCP port');

    const browser = await chromium.launch();

    cleanup.push(() => browser.close());
    const context = await browser.newContext({
      baseURL: `http://127.0.0.1:${address.port}`,
      locale: 'en-US'
    });

    cleanup.push(() => context.close());
    const page = await context.newPage();

    page.on('pageerror', (error) => failures.push(error));
    await run({ page });
  } catch (error) {
    failures.push(error);
  } finally {
    for (const close of cleanup.reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
  }

  if (failures.length) throw new AggregateError(failures, 'Web E2E failed');
}
