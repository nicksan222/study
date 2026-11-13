import { createTestDatabase } from '@study/db/testing';
import { App, serve } from '@study/server/runtime';
import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { owned } from './lifecycle.ts';

testStable('partial startup and body failures close all resources in reverse order', async () => {
  const closed: number[] = [];
  const original = new Error('startup');
  const result = owned(async (own) => {
    own(() => {
      closed.push(1);
    });
    own(() => {
      closed.push(2);

      throw new Error('cleanup');
    });

    throw original;
  });

  await expect(result).rejects.toMatchObject({ errors: [original, new Error('cleanup')] });
  expect(closed).toEqual([2, 1]);
});

testStable(
  'runner finalization closes partial startup and cleans acquisitions that finish late',
  async () => {
    let finalize: (() => Promise<void>) | undefined;
    let resume: (() => void) | undefined;
    const closed: string[] = [];
    const pending = owned(
      async (own) => {
        own(() => {
          closed.push('initial');
        });
        await new Promise<void>((resolve) => {
          resume = resolve;
        });
        own(() => {
          closed.push('late');
        });
      },
      (close) => {
        finalize = close;
      }
    );

    await finalize!();
    await finalize!();
    resume!();
    await expect(pending).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: 'E2E acquisition completed after teardown' }),
        expect.objectContaining({ message: 'E2E cancelled before cleanup completed' })
      ]
    });
    expect(closed).toEqual(['initial', 'late']);
  }
);

testStable(
  'provisional traces survive cleanup failure and cancellation but successful cleanup deletes them',
  async () => {
    for (const mode of ['success', 'cleanup-failure', 'review', 'cancel']) {
      const trace = Bun.file(`test-results/contracts/${crypto.randomUUID()}/trace.zip`);
      const cleanupError = new Error('context close failed');
      const resume = Promise.withResolvers<void>();
      let finalize: (() => Promise<void>) | undefined;
      const result = owned(
        async (own) => {
          own(() => {
            if (mode === 'cleanup-failure') throw cleanupError;
          });
          own(async () => {
            await Bun.write(trace, 'provisional trace');
          });

          if (mode === 'cancel') await resume.promise;
        },
        (close) => {
          finalize = close;
        },
        async () => {
          if (mode !== 'review') await trace.delete();
        }
      );

      if (mode === 'cancel') {
        await finalize!();
        resume.resolve();
      }

      if (mode === 'cleanup-failure')
        await expect(result).rejects.toMatchObject({ errors: [cleanupError] });
      else if (mode === 'cancel') await expect(result).rejects.toThrow();
      else await result;

      expect(await trace.exists()).toBe(mode !== 'success');
    }
  }
);

testStable(
  'cancellation during successful-body cleanup retains its provisional trace',
  async () => {
    const trace = Bun.file(`test-results/contracts/${crypto.randomUUID()}/trace.zip`);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let finalize: (() => Promise<void>) | undefined;
    const result = owned(
      async (own) => {
        own(async () => {
          entered.resolve();
          await release.promise;
        });
        own(async () => {
          await Bun.write(trace, 'trace');
        });
      },
      (close) => {
        finalize = close;
      },
      () => trace.delete()
    );

    await entered.promise;
    const cancelled = finalize!();

    release.resolve();
    await cancelled;
    await expect(result).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: 'E2E cancelled before cleanup completed' })]
    });
    expect(await trace.exists()).toBe(true);
  }
);

testStable(
  'failed E2E startup closes its running workers before removing the database',
  async () => {
    const failure = new Error('startup after workers');
    let app: App | undefined;
    let databaseRemoved = false;
    const result = owned(async (own) => {
      const database = await createTestDatabase();

      own(async () => {
        expect(app?.workers.started).toBe(false);
        await database.cleanup();
        databaseRemoved = true;
      });
      app = await App.open({ path: await database.prepare() });

      const opened = app;

      own(() => opened.close());

      const server = await serve(opened);

      own(() => server.close());
      await opened.workers.start();
      expect(opened.workers.started).toBe(true);

      throw failure;
    });

    await expect(result).rejects.toMatchObject({ errors: [failure] });
    expect(app?.workers.started).toBe(false);
    expect(databaseRemoved).toBe(true);
  }
);
