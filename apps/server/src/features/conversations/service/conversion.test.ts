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

import { workflowEvents } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { decodeEvent } from '#server/platform/workflows/events';
import { withTestPublication } from '#testing/publication';

let location: ReturnType<typeof createTestDatabase>;

let context: ServerContext;

beforeEach(() => {
  location = createTestDatabase();
  context = new ServerContext(location.open());
});

afterEach(() => {
  context.close();
  location.cleanup();
});

function services() {
  return Layer.mergeAll(Conversations.layer, Sources.layer, Settings.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );
}

testStable(
  'conversion deduplicates requests, preserves originals and retains results after edits',
  async () => {
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
      }).pipe(Effect.provide(services()))
    );
  }
);

testStable(
  'automatic conversion is opt-in and uses the same durable request as the button',
  async () => {
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
        expect(
          context.db.orm
            .select()
            .from(workflowEvents)
            .all()
            .map((row) => decodeEvent(row.payload))
            .some(
              (event) =>
                event.type === 'ConversationGenerationRequested' && event.messageId === manual.id
            )
        ).toBe(false);
        yield* settings.saveWorkspacePreferences({
          ...(yield* settings.workspacePreferences()),
          textConversionMode: 'automatic'
        });
        const automatic = yield* c.postMessage({
          sessionId: session.id,
          text: 'More\nlines.',
          requestReply: false
        });

        expect(automatic.versions).toHaveLength(2);
        const input = {
          messageId: automatic.id,
          expectedActiveVersionId: automatic.activeVersionId!,
          strategyId: 'chatgpt'
        };
        const receipt = yield* c.convertMessage(input);

        expect(receipt.versionId).toBe(
          automatic.versions.find((version) => version.origin === 'convert')?.id
        );

        expect((yield* c.message(automatic.id)).versions).toHaveLength(2);
        expect(
          (yield* c.replySnapshot({ requestId: receipt.requestId })).generation?.conversion
            ?.strategyId
        ).toBe('chatgpt');
        const unavailable = yield* Effect.result(
          c.convertMessage({ ...input, strategyId: 'missing' })
        );

        expect(unavailable._tag).toBe('Failure');
      }).pipe(Effect.provide(services()))
    );
  }
);

testStable(
  'failed conversions retain their payload, unblock replies and support exact retry or discard',
  async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Conversations;
        const session = yield* c.createSession({ title: 'Recovery' });
        const note = yield* c.postMessage({
          sessionId: session.id,
          text: 'Broken\ntext.',
          requestReply: false
        });
        const input = {
          messageId: note.id,
          expectedActiveVersionId: note.activeVersionId!,
          strategyId: 'chatgpt'
        };
        const receipt = yield* c.convertMessage(input);

        expect((yield* Effect.result(c.requestReply({ sessionId: session.id })))._tag).toBe(
          'Failure'
        );

        yield* withTestPublication(context, c.failConversion(receipt).pipe(Effect.asVoid));
        const failed = yield* c.message(note.id);

        expect(failed.versions.at(-1)).toMatchObject({
          status: 'failed',
          generationRequestId: receipt.requestId
        });
        expect(failed.activeVersionId).toBe(note.activeVersionId);
        expect((yield* c.requestReply({ sessionId: session.id })).requestId).toBeTruthy();
        const rewrite = yield* c.rewriteMessage({ messageId: note.id, origin: 'improve' });

        expect(
          (yield* c.message(note.id)).versions.find((version) => version.id === receipt.versionId)
            ?.status
        ).toBe('failed');
        expect((yield* Effect.result(c.convertMessage(input)))._tag).toBe('Failure');
        yield* withTestPublication(context, c.abandonReply(rewrite).pipe(Effect.asVoid));

        expect(yield* c.convertMessage(input)).toEqual(receipt);
        expect(yield* c.convertMessage(input)).toEqual(receipt);
        const events = context.db.orm
          .select()
          .from(workflowEvents)
          .all()
          .map((row) => decodeEvent(row.payload))
          .filter(
            (event) =>
              event.type === 'ConversationGenerationRequested' &&
              event.requestId === receipt.requestId
          );

        expect(events).toHaveLength(2);
        expect((yield* c.message(note.id)).versions.at(-1)?.status).toBe('pending');
        yield* withTestPublication(context, c.failConversion(receipt).pipe(Effect.asVoid));
        yield* c.deleteMessageVersion({ messageId: note.id, versionId: receipt.versionId });
        expect((yield* c.message(note.id)).versions).toHaveLength(1);
      }).pipe(Effect.provide(services()))
    );
  }
);

testStable('failed conversion retry rejects a base version that is no longer active', async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const c = yield* Conversations;
      const session = yield* c.createSession({ title: 'Stale conversion' });
      const note = yield* c.postMessage({
        sessionId: session.id,
        text: 'Original\ntext.',
        requestReply: false
      });
      const input = {
        messageId: note.id,
        expectedActiveVersionId: note.activeVersionId!,
        strategyId: 'chatgpt'
      };
      const receipt = yield* c.convertMessage(input);

      yield* withTestPublication(context, c.failConversion(receipt).pipe(Effect.asVoid));
      yield* c.editMessage({ messageId: note.id, text: 'A newer edit.' });
      const edited = yield* c.message(note.id);
      const events = context.db.orm.select().from(workflowEvents).all();
      const error = yield* c
        .convertMessage(input)
        .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => null }));

      expect(error?.kind).toBe('invalid_input');
      expect(yield* c.message(note.id)).toEqual(edited);
      expect(edited.versions.find((version) => version.id === receipt.versionId)?.status).toBe(
        'failed'
      );
      expect(context.db.orm.select().from(workflowEvents).all()).toEqual(events);
    }).pipe(Effect.provide(services()))
  );
});

testStable(
  'Ask schedules automatic conversion once after capturing its original reply input',
  async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Conversations;
        const settings = yield* Settings;
        const manualSession = yield* c.createSession({ title: 'Manual Ask' });
        const manual = yield* c.ask({
          sessionId: manualSession.id,
          intentKey: 'manual-ask',
          expectedSelectionRevision: 0n,
          text: 'Manual\ninput.'
        });

        expect((yield* c.message(manual.userMessageId)).versions).toHaveLength(1);
        yield* settings.saveWorkspacePreferences({
          ...(yield* settings.workspacePreferences()),
          textConversionMode: 'automatic'
        });
        const session = yield* c.createSession({ title: 'Automatic Ask' });
        const input = {
          sessionId: session.id,
          intentKey: 'automatic-ask',
          expectedSelectionRevision: 0n,
          text: 'Original\nAsk input.'
        };
        const asked = yield* c.ask(input);
        const note = yield* c.message(asked.userMessageId);

        expect(note.versions).toHaveLength(2);
        expect(note.activeVersionId).toBe(asked.userVersionId);
        const conversion = note.versions.find((version) => version.origin === 'convert')!;

        expect(conversion).toMatchObject({ status: 'pending', basedOn: asked.userVersionId });
        expect((yield* c.replySnapshot(asked)).messages.at(-1)).toMatchObject({
          messageId: note.id,
          versionId: asked.userVersionId,
          text: 'Original\nAsk input.'
        });
        const conversionEvents = context.db.orm
          .select()
          .from(workflowEvents)
          .all()
          .map((row) => decodeEvent(row.payload))
          .filter(
            (event) =>
              event.type === 'ConversationGenerationRequested' && event.messageId === note.id
          );

        expect(conversionEvents).toHaveLength(1);
        expect(conversionEvents[0]).toMatchObject({
          versionId: conversion.id,
          operation: 'rewrite'
        });
        const receipt = yield* c.convertMessage({
          messageId: note.id,
          expectedActiveVersionId: asked.userVersionId,
          strategyId: 'chatgpt'
        });

        expect(receipt.versionId).toBe(conversion.id);
        yield* withTestPublication(context, c.failConversion(receipt).pipe(Effect.asVoid));
        const events = context.db.orm.select().from(workflowEvents).all();

        expect(yield* c.ask(input)).toEqual(asked);
        expect(context.db.orm.select().from(workflowEvents).all()).toEqual(events);
        expect(
          (yield* c.message(note.id)).versions.find((version) => version.id === conversion.id)
            ?.status
        ).toBe('failed');
      }).pipe(Effect.provide(services()))
    );
  }
);
