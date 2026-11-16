import { createTestDatabase } from '@study/db/testing';
import { createTestResources } from '@study/testing/resources';
import { createTestApi, test as baseTest } from '@study/testing/vitest';

const runner = baseTest.stable
  .extend('resources', async ({ task: _task }, { onCleanup }) => {
    const resources = createTestResources();

    onCleanup(() => resources.close());

    return resources;
  })
  .extend('databases', async ({ resources }) => async (migrationsFolder?: string) => {
    const fixture = await createTestDatabase(migrationsFolder);
    const owned = resources.manage({ close: fixture.cleanup });

    return {
      dir: fixture.dir,
      path: fixture.path,
      prepare: fixture.prepare,
      open: (options) => resources.acquire(() => fixture.open(options)),
      cleanup: owned.close,
      [Symbol.asyncDispose]: owned.close
    };
  })
  .extend('database', async ({ databases }) => databases())
  .extend('db', async ({ database }) => database.open())
  .extend('createTestDatabase', { scope: 'worker' }, () => createTestDatabase);

/** One public test API for real, isolated Drizzle and SQLite tests. */
export const test: ReturnType<typeof createTestApi<typeof runner>> = createTestApi(runner);
