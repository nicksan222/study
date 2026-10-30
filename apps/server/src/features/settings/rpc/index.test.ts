import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SettingsRpc } from '@study/contracts/settings/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { SettingsRpcLive } from './index.ts';

test('settings RPC exposes typed settings and maps service failures', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const handlers = SettingsRpcLive.pipe(
    Layer.provide(Settings.layer),
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(SettingsRpc, { flatten: true });

          assert.equal((yield* client('settings.appSettings', {})).zoomPercent, 100);
          yield* client('settings.saveReviewSettings', { newCardsPerDay: 33 });
          assert.equal((yield* client('settings.reviewSettings', {})).newCardsPerDay, 33);
          context.db.orm.run(
            sql`CREATE TRIGGER reject_review BEFORE INSERT ON preferences WHEN NEW.scope = 'review' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
          );
          assert.ok(
            (yield* Effect.flip(client('settings.saveReviewSettings', { newCardsPerDay: 44 }))).kind
          );
          assert.equal((yield* client('settings.reviewSettings', {})).newCardsPerDay, 33);
          assert.deepEqual(
            [...SettingsRpc.requests.keys()].sort(),
            [
              'settings.appSettings',
              'settings.llmSettings',
              'settings.materialSettings',
              'settings.reviewSettings',
              'settings.saveAppSettings',
              'settings.saveLlmSettings',
              'settings.saveMaterialSettings',
              'settings.saveReviewSettings'
            ].sort()
          );
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
