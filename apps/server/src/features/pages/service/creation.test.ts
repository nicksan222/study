import { plainBlock } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Tests durable document creation and guarded material description updates.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies retry receipts and description concurrency against real SQLite.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses public feature services and the shared server test harness.                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';

import { Pages } from '#server/features/pages/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

const document = {
  blocks: [plainBlock('paragraph', '', { type: 'authored' })],
  meta: {
    extractor: null,
    extractorVersion: 1,
    provider: null,
    durationMs: null,
    pageCount: null,
    refiners: [],
    waitingFor: [],
    corrected: false,
    omissions: []
  }
};

test.stable(
  'empty document creation replays its exact key and descriptions use guarded independent metadata',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Pages.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const pages = yield* Pages;
          const input = {
            title: 'Untitled document',
            document,
            createKey: 'empty-document-create',
            inputs: [],
            citations: []
          };
          const original = yield* pages.create(input);
          const replay = yield* pages.create(input);

          test.assert.strictEqual(replay.id, original.id);
          test.assert.ok(original.version);
          test.assert.ok(replay.version);
          test.assert.strictEqual(replay.version.id, original.version.id);
          test.assert.strictEqual(original.version.pageId, original.id);
          test.assert.ok(
            (yield* Effect.flip(pages.create({ ...input, title: 'Different intent' }))).kind ===
              'invalid_input'
          );
          const description = yield* pages.updateMetadata({
            id: original.id,
            title: original.title,
            expectedTitle: original.title,
            description: 'A short summary',
            expectedDescription: null
          });

          test.assert.ok(description.description === 'A short summary');
          test.assert.strictEqual(description.headVersionId, original.version.id);
          test.assert.ok(
            (yield* Effect.flip(
              pages.updateMetadata({
                id: original.id,
                title: original.title,
                expectedTitle: original.title,
                description: 'Stale overwrite',
                expectedDescription: null
              })
            )).kind === 'invalid_input'
          );
          test.assert.ok(
            (yield* pages.updateMetadata({
              id: original.id,
              title: original.title,
              expectedTitle: original.title,
              description: null,
              expectedDescription: 'A short summary'
            })).description === null
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
