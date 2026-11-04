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

import assert from 'node:assert/strict';

import { plainBlock } from '@study/contracts/sources/document';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Effect, Layer } from 'effect';

import { Materials } from '#server/features/materials/index';
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
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Materials.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials;
          const input = {
            title: 'Untitled document',
            document,
            createKey: 'empty-document-create'
          };
          const original = yield* materials.createManualDocument(input);
          const replay = yield* materials.createManualDocument(input);

          assert.equal(replay.id, original.id);
          assert.equal(replay.version.id, original.version.id);
          assert.equal(original.version.kind, 'document');
          assert.equal(
            (yield* Effect.flip(
              materials.createManualDocument({ ...input, title: 'Different intent' })
            )).kind,
            'invalid_input'
          );
          const description = yield* materials.updateDescription({
            id: original.id,
            description: '  A short summary  ',
            expectedDescription: null
          });

          assert.equal(description.description, 'A short summary');
          assert.equal(description.version.id, original.version.id);
          assert.equal(
            (yield* materials.updateDescription({
              id: original.id,
              description: 'A short summary',
              expectedDescription: null
            })).description,
            'A short summary'
          );
          assert.equal(
            (yield* Effect.flip(
              materials.updateDescription({
                id: original.id,
                description: 'Stale overwrite',
                expectedDescription: null
              })
            )).kind,
            'invalid_input'
          );
          assert.equal(
            (yield* materials.updateDescription({
              id: original.id,
              description: ' ',
              expectedDescription: 'A short summary'
            })).description,
            null
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
