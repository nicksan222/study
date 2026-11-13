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

import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { buildContext } from './environment.ts';
import { fs, path, run } from './filesystem.ts';

testStable('default build context resolves the workspace from the server package', async () => {
  const serverRoot = path.resolve(import.meta.dirname, '../..');
  const previousDirectory = process.cwd();
  let context: string | undefined;

  try {
    process.chdir(serverRoot);
    context = await buildContext();
    expect(await Bun.file(path.join(context, 'package.json')).json()).toMatchObject({
      name: 'study-workspace'
    });
    expect(await Bun.file(path.join(context, 'apps/client/package.json')).json()).toMatchObject({
      name: '@study/client'
    });
    expect(await run(fs.exists(path.join(context, 'bun.lock')))).toBe(true);
  } finally {
    process.chdir(previousDirectory);

    if (context) await run(fs.remove(context, { recursive: true, force: true }));
  }
});

testStable(
  'build contexts preserve sources below a dist parent and omit secrets and dependencies',
  async () => {
    const temporary = await run(fs.makeTempDirectory({ prefix: 'study-build-context-' }));
    const root = path.join(temporary, 'dist', 'checkout');
    let context: string | undefined;

    try {
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
        'packages/integrations/node_modules/dep/index.js'
      ]) {
        const target = path.join(root, file);

        await run(fs.makeDirectory(path.dirname(target), { recursive: true }));
        await Bun.write(target, file);
      }

      context = await buildContext(root);
      expect(
        await Bun.file(path.join(context, 'packages/integrations/src/provider.ts')).text()
      ).toBe('packages/integrations/src/provider.ts');
      expect(await run(fs.exists(path.join(context, 'packages/integrations/.env.secret')))).toBe(
        false
      );
      expect(await run(fs.exists(path.join(context, 'packages/integrations/node_modules')))).toBe(
        false
      );
      expect(await run(fs.exists(path.join(context, 'bun.lock')))).toBe(true);
    } finally {
      if (context) await run(fs.remove(context, { recursive: true, force: true }));

      await run(fs.remove(temporary, { recursive: true, force: true }));
    }
  }
);
