import { createTestDatabase } from '@study/db/testing';
import { createTestResources } from '@study/testing/resources';
import { createTestApi, test as baseTest } from '@study/testing/vitest';

const runner = baseTest.unit.stable
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
      open: (...args: Parameters<typeof fixture.open>) =>
        resources.acquire(() => fixture.open(...args)),
      cleanup: owned.close,
      [Symbol.asyncDispose]: owned.close
    };
  })
  .extend('database', async ({ databases }) => databases())
  .extend('db', async ({ database }) => database.open())
  .extend('createTestDatabase', { scope: 'worker' }, () => createTestDatabase);

/** Database tests expose shared unit fixtures and isolated SQLite fixtures. */
export const test = {
  unit: baseTest.unit,
  server: createTestApi(runner)
};
