import { ThemesRpc } from '@study/contracts';
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
import { test } from '@study/testing';
import { Effect, Layer, Option } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Themes } from '#server/features/themes/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { testLiveQueries } from '#testing/live-queries';

import { ThemesRpcLive } from './index.ts';

test.stable('native themes RPC exposes the catalog and typed failures', async ({ databases }) => {
  const location = await databases();
  const context = new ServerContext(await location.open());
  const handlers = ThemesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
    Layer.provide(Themes.layer),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(ThemesRpc, { flatten: true });

          test.assert.ok(
            (yield* Effect.flip(client('themes.theme', { id: 'missing' }))).kind === 'not_found'
          );
          test.assert.ok(Option.isNone(yield* client('themes.findTheme', { id: 'missing' })));
          test.assert.ok(
            (yield* Effect.flip(client('themes.importTheme', { json: '{}' }))).kind ===
              'invalid_input'
          );
          yield* client('themes.importTheme', {
            json: JSON.stringify({ version: 1, id: 'rpc-test', name: 'RPC' })
          });
          yield* client('themes.selectTheme', { id: 'rpc-test' });
          test.assert.strictEqual(yield* client('themes.selectedTheme', {}), 'rpc-test');
          test.assert.ok((yield* client('themes.theme', { id: 'rpc-test' })).name === 'RPC');
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});
