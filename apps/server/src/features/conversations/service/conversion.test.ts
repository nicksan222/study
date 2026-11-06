/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Tests conversion receipts and preservation of original message versions.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks durable deduplication and concurrent message edits.                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use public services with migrated temporary SQLite databases.                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { withTestPublication } from '#testing/publication';

testStable(
  'conversion deduplicates requests, preserves originals and retains results after edits',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const session = yield* c.createSession({ title: 'Conversion' });
          const note = yield* c.postMessage({
            sessionId: session.id,
            text: 'A broken\nparagraph [1].',
            requestReply: false
          });
          const input = {
            messageId: note.id,
            expectedActiveVersionId: note.activeVersionId!,
            strategyId: 'chatgpt'
          };
          const receipt = yield* c.convertMessage(input);

          expect(yield* c.convertMessage(input)).toEqual(receipt);
          const pending = yield* c.message(note.id);

          expect(pending.activeVersionId).toBe(note.activeVersionId);
          expect(pending.versions).toHaveLength(2);
          yield* c.editMessage({ messageId: note.id, text: 'My newer edit.' });
          const edited = yield* c.message(note.id);

          yield* withTestPublication(
            context,
            c.publishReply({
              requestId: receipt.requestId,
              text: 'A broken paragraph [1].',
              citations: []
            })
          );
          const completed = yield* c.message(note.id);

          expect(completed.activeVersionId).toBe(edited.activeVersionId);
          expect(completed.versions.find((v) => v.id === receipt.versionId)).toMatchObject({
            text: 'A broken paragraph [1].',
            status: 'complete',
            basedOn: note.activeVersionId,
            origin: 'convert'
          });
          expect(completed.versions[0]?.text).toBe('A broken\nparagraph [1].');
          expect(yield* c.convertMessage(input)).toEqual(receipt);
        }).pipe(
          Effect.provide(Layer.mergeAll(Conversations.layer, Sources.layer, Settings.layer)),
          Effect.provide(Layer.succeed(Database, { store: context }))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'automatic conversion is opt-in and uses the same durable request as the button',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const settings = yield* Settings;
          const session = yield* c.createSession({ title: 'Automatic' });
          const manual = yield* c.postMessage({
            sessionId: session.id,
            text: 'Two\nlines.',
            requestReply: false
          });

          expect(manual.versions).toHaveLength(1);
          yield* settings.saveWorkspacePreferences({
            ...(yield* settings.workspacePreferences()),
            textConversionMode: 'automatic'
          });
          const automatic = yield* c.postMessage({
            sessionId: session.id,
            text: 'More\nlines.',
            requestReply: false
          });
          const input = {
            messageId: automatic.id,
            expectedActiveVersionId: automatic.activeVersionId!,
            strategyId: 'chatgpt'
          };
          const receipt = yield* c.convertMessage(input);

          expect((yield* c.message(automatic.id)).versions).toHaveLength(2);
          expect(
            (yield* c.replySnapshot({ requestId: receipt.requestId })).generation?.conversion
              ?.strategyId
          ).toBe('chatgpt');
          const unavailable = yield* Effect.result(
            c.convertMessage({ ...input, strategyId: 'missing' })
          );

          expect(unavailable._tag).toBe('Failure');
        }).pipe(
          Effect.provide(Layer.mergeAll(Conversations.layer, Sources.layer, Settings.layer)),
          Effect.provide(Layer.succeed(Database, { store: context }))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
