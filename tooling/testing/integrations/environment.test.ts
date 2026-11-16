/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies isolated integration build inputs without starting provider software.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Excludes dependencies and credentials while preserving authored files.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ These filesystem checks use isolated temporary outputs and never connect to Docker.      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { test } from '@study/testing';

import { buildContext } from './environment.ts';
import { fs, path, run } from './filesystem.ts';

test.stable('default build context resolves the workspace from the server package', async () => {
  const serverRoot = path.resolve(import.meta.dirname, '../../../apps/server');
  const previousDirectory = process.cwd();

  try {
    process.chdir(serverRoot);
    await using context = await buildContext();

    test.expect(await Bun.file(path.join(context.path, 'package.json')).json()).toMatchObject({
      name: 'study-workspace'
    });
    test
      .expect(await Bun.file(path.join(context.path, 'apps/client/package.json')).json())
      .toMatchObject({
        name: '@study/client'
      });
    test.expect(await run(fs.exists(path.join(context.path, 'bun.lock')))).toBe(true);
  } finally {
    process.chdir(previousDirectory);
  }
});

test.stable(
  'build contexts preserve sources below a dist parent and omit secrets and dependencies',
  async () => {
    await using temporary = await test.temporaryDirectory({ prefix: 'study-build-context-' });
    const root = path.join(temporary.path, 'dist', 'checkout');

    for (const file of [
      'package.json',
      'bun.lock',
      'vite.config.ts',
      'apps/server/package.json',
      'apps/client/package.json',
      'apps/desktop/package.json',
      'tooling/package.json',
      'packages/integrations/src/provider.ts',
      'packages/integrations/.env.secret',
      'packages/integrations/node_modules/dep/index.js',
      'tooling/.turbo/turbo-test.log',
      'tooling/test-results/run/trace.zip',
      'packages/db/coverage/report.json',
      'packages/db/.fallow/cache',
      'packages/db/__pycache__/fixture.pyc'
    ]) {
      const target = path.join(root, file);

      await run(fs.makeDirectory(path.dirname(target), { recursive: true }));
      await Bun.write(target, file);
    }

    await using context = await buildContext(root);

    test
      .expect(
        await Bun.file(path.join(context.path, 'packages/integrations/src/provider.ts')).text()
      )
      .toBe('packages/integrations/src/provider.ts');
    test
      .expect(await run(fs.exists(path.join(context.path, 'packages/integrations/.env.secret'))))
      .toBe(false);
    test
      .expect(await run(fs.exists(path.join(context.path, 'packages/integrations/node_modules'))))
      .toBe(false);

    for (const generated of [
      'tooling/.turbo',
      'tooling/test-results',
      'packages/db/coverage',
      'packages/db/.fallow',
      'packages/db/__pycache__'
    ])
      test.expect(await run(fs.exists(path.join(context.path, generated)))).toBe(false);

    test.expect(await run(fs.exists(path.join(context.path, 'bun.lock')))).toBe(true);
  }
);

test.stable('the integration install layer contains every locked workspace manifest', async () => {
  const root = new URL('../../../', import.meta.url);
  const lock = Bun.JSON5.parse(await Bun.file(new URL('bun.lock', root)).text()) as {
    workspaces: Record<string, unknown>;
  };
  const dockerfile = await Bun.file(new URL('Dockerfile', import.meta.url)).text();
  const installLayer = dockerfile.split('RUN bun install')[0]!;
  const inputs = [...installLayer.matchAll(/^COPY(?: --\S+)* (.+)$/gm)].flatMap((match) =>
    match[1]!.split(/\s+/).slice(0, -1)
  );

  test
    .expect(inputs)
    .toEqual(
      test.expect.arrayContaining(
        Object.keys(lock.workspaces).map((workspace) =>
          workspace ? `${workspace}/package.json` : 'package.json'
        )
      )
    );
});
