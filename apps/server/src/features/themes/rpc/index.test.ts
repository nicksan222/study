/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises theme catalog RPC calls, selection, import, and typed errors against     │
 * │ SQLite.                                                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises native themes RPC exposes the catalog and typed failures.                    │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { ThemesRpc } from '@study/contracts/themes/rpc';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Option } from 'effect';
import { RpcTest } from 'effect/rpc';
import { assert } from 'vite-plus/test';

import { Themes } from '#server/features/themes/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { ThemesRpcLive } from './index.ts';

testStable('native themes RPC exposes the catalog and typed failures', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const handlers = ThemesRpcLive.pipe(
    Layer.provide(Themes.layer),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(ThemesRpc, { flatten: true });

          assert.ok(
            (yield* Effect.flip(client('themes.theme', { id: 'missing' }))).kind === 'not_found'
          );
          assert.ok(Option.isNone(yield* client('themes.findTheme', { id: 'missing' })));
          assert.ok(
            (yield* Effect.flip(client('themes.importTheme', { json: '{}' }))).kind ===
              'invalid_input'
          );
          yield* client('themes.importTheme', {
            json: JSON.stringify({ version: 1, id: 'rpc-test', name: 'RPC' })
          });
          yield* client('themes.selectTheme', { id: 'rpc-test' });
          assert.strictEqual(yield* client('themes.selectedTheme', {}), 'rpc-test');
          assert.ok((yield* client('themes.theme', { id: 'rpc-test' })).name === 'RPC');
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
