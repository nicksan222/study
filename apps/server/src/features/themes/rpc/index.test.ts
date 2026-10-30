import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ThemesRpc } from '@study/contracts/themes/rpc';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Option } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Themes } from '#server/features/themes/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { ThemesRpcLive } from './index.ts';

test('native themes RPC exposes the catalog and typed failures', async () => {
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

          assert.equal(
            (yield* Effect.flip(client('themes.theme', { id: 'missing' }))).kind,
            'not_found'
          );
          assert.ok(Option.isNone(yield* client('themes.findTheme', { id: 'missing' })));
          assert.equal(
            (yield* Effect.flip(client('themes.importTheme', { json: '{}' }))).kind,
            'invalid_input'
          );
          yield* client('themes.importTheme', {
            json: JSON.stringify({ version: 1, id: 'rpc-test', name: 'RPC' })
          });
          yield* client('themes.selectTheme', { id: 'rpc-test' });
          assert.equal(yield* client('themes.selectedTheme', {}), 'rpc-test');
          assert.equal((yield* client('themes.theme', { id: 'rpc-test' })).name, 'RPC');
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
