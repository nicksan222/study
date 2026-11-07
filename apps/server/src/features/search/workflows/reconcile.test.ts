/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates local semantic retrieval through typed feature capabilities and native │
 * │ workflows.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves current publication identities and validates searchable entity projections.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Runtime registration remains explicit and feature services own all content visibility    │
 * │ rules.                                                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { projectIdSchema } from '@study/contracts/ids';
import { projects } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import { expect } from 'vite-plus/test';

import { Search } from '#server/features/search/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { SearchConfiguration } from '#server/platform/search/configuration';
import { SearchStorage } from '#server/platform/search/storage';
import { workflowEngineLayer } from '#server/platform/workflows/engine';

import { searchReconciliation } from './reconcile.ts';

testStable(
  'native reconciliation workflow is restartable and replay does not duplicate embeddings',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    let calls = 0;
    const model = {
      chunkPassages: (text: string) => Effect.succeed([text]),
      maxChunkingInputLength: 2000000,
      identity: 'workflow-fixture-v1',
      dimensions: 3,
      embedQuery: () => Effect.succeed(new Float32Array([1, 0, 0])),
      embedPassages: (texts: readonly string[]) =>
        Effect.sync(() => {
          calls += texts.length;

          return texts.map(() => new Float32Array([1, 0, 0]));
        })
    };

    try {
      context.db.orm
        .insert(projects)
        .values({
          id: Schema.decodeUnknownSync(projectIdSchema)(1n),
          name: 'Workflow indexing',
          created_at: 1n,
          updated_at: 1n
        })
        .run();
      const run = Effect.gen(function* () {
        const reconciliation = searchReconciliation;

        return yield* reconciliation.definition
          .execute({ runId: 'test-reconcile' })
          .pipe(Effect.provide(reconciliation.layer));
      });
      const layers = Layer.mergeAll(
        Search.layer.pipe(
          Layer.provide(SearchStorage.layer),
          Layer.provide(Layer.succeed(SearchConfiguration, { model })),
          Layer.provide(Layer.succeed(Database, { store: context }))
        ),
        workflowEngineLayer(context)
      );

      expect(
        await Effect.runPromise(
          Effect.scoped(
            run.pipe(Effect.provide(layers), Effect.provideService(Database, { store: context }))
          )
        )
      ).toMatchObject({ embedded: 1 });
      expect(
        await Effect.runPromise(
          Effect.scoped(
            run.pipe(Effect.provide(layers), Effect.provideService(Database, { store: context }))
          )
        )
      ).toMatchObject({ embedded: 1 });
      expect(calls).toBe(1);
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
