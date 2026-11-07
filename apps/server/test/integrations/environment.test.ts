/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies isolated integration build inputs without starting provider software.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Excludes dependencies and credentials while preserving authored files.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ These filesystem checks use synthetic temporary trees and never connect to Docker.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { buildContext } from './environment.ts';

testStable(
  'build contexts preserve sources below a dist parent and omit secrets and dependencies',
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'study-build-context-'));
    const root = join(temporary, 'dist', 'checkout');
    let context: string | undefined;

    try {
      for (const path of [
        'package.json',
        'bun.lock',
        'vite.config.ts',
        'apps/server/package.json',
        'apps/web/package.json',
        'apps/desktop/package.json',
        'tooling/package.json',
        'packages/integrations/src/provider.ts',
        'packages/integrations/.env.secret',
        'packages/integrations/node_modules/dep/index.js'
      ]) {
        const target = join(root, path);

        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, path);
      }

      context = await buildContext(root);
      expect(await readFile(join(context, 'packages/integrations/src/provider.ts'), 'utf8')).toBe(
        'packages/integrations/src/provider.ts'
      );
      expect(existsSync(join(context, 'packages/integrations/.env.secret'))).toBe(false);
      expect(existsSync(join(context, 'packages/integrations/node_modules'))).toBe(false);
      expect(existsSync(join(context, 'bun.lock'))).toBe(true);
    } finally {
      if (context) await rm(context, { recursive: true, force: true });

      await rm(temporary, { recursive: true, force: true });
    }
  }
);
