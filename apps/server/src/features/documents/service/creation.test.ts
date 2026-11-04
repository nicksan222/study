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

import { Documents } from '#server/features/documents/index';
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
    const layer = Documents.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const documents = yield* Documents;
          const input = {
            title: 'Untitled document',
            document,
            createKey: 'empty-document-create',
            inputs: [],
            citations: []
          };
          const original = yield* documents.create(input);
          const replay = yield* documents.create(input);

          assert.equal(replay.id, original.id);
          assert.ok(original.version);
          assert.ok(replay.version);
          assert.equal(replay.version.id, original.version.id);
          assert.equal(original.version.documentId, original.id);
          assert.equal(
            (yield* Effect.flip(documents.create({ ...input, title: 'Different intent' }))).kind,
            'invalid_input'
          );
          const description = yield* documents.updateMetadata({
            id: original.id,
            title: original.title,
            expectedTitle: original.title,
            description: 'A short summary',
            expectedDescription: null
          });

          assert.equal(description.description, 'A short summary');
          assert.equal(description.headVersionId, original.version.id);
          assert.equal(
            (yield* Effect.flip(
              documents.updateMetadata({
                id: original.id,
                title: original.title,
                expectedTitle: original.title,
                description: 'Stale overwrite',
                expectedDescription: null
              })
            )).kind,
            'invalid_input'
          );
          assert.equal(
            (yield* documents.updateMetadata({
              id: original.id,
              title: original.title,
              expectedTitle: original.title,
              description: null,
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
