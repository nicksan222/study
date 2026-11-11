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

import { plainBlock } from '@study/contracts/sources/document';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { assert } from 'vite-plus/test';

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

testStable(
  'empty document creation replays its exact key and descriptions use guarded independent metadata',
  async () => {
    const location = await createTestDatabase();
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

          assert.strictEqual(replay.id, original.id);
          assert.ok(original.version);
          assert.ok(replay.version);
          assert.strictEqual(replay.version.id, original.version.id);
          assert.strictEqual(original.version.pageId, original.id);
          assert.ok(
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

          assert.ok(description.description === 'A short summary');
          assert.strictEqual(description.headVersionId, original.version.id);
          assert.ok(
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
          assert.ok(
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
