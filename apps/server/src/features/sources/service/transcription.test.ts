/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks source speech behavior through real persisted application state.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates typed inputs and preserves explicit operation ownership.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps application policy outside shared inference and persistence mechanisms.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { expect } from 'vite-plus/test';

import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

testStable(
  'audio is retained for manual transcription unless automatic transcription is enabled',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const settings = yield* Settings;
          const input = {
            name: 'lecture.wav',
            bytes: new TextEncoder().encode('RIFF0000WAVE'),
            projectId: null
          };
          const source = yield* sources.createSource(input);
          const count = () =>
            context.db.orm.get<{ n: bigint }>(
              sql`SELECT count(*) n FROM workflow_events WHERE type='SourceProcessingRequested'`
            )!.n;

          expect(count()).toBe(0n);
          yield* sources.requestSourceProcessing({ id: source.id, expectedRevision: 1 });
          expect(count()).toBe(1n);
          yield* settings.saveWorkspacePreferences({
            ...(yield* settings.workspacePreferences()),
            autoTranscribeAudio: true
          });
          yield* sources.createSource(input);
          expect(count()).toBe(2n);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(Sources.layer, Settings.layer).pipe(
              Layer.provideMerge(Layer.succeed(Database, { store: context }))
            )
          )
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
