import { workflowEvents } from '@study/db';
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
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';

import { Notes } from '#server/features/notes/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { decodeEvent } from '#server/platform/workflows/events';
import { withTestPublication } from '#testing/publication';

let context: ServerContext;

test.beforeEach(async ({ databases }) => {
  const location = await databases();

  context = new ServerContext(await location.open());
});

test.afterEach(() => context.close());

function services() {
  return Layer.mergeAll(Notes.layer, Sources.layer, Settings.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );
}

test.stable(
  'conversion deduplicates requests, preserves originals and retains results after edits',
  async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Notes;
        const note = yield* c.createNote({ title: 'Conversion' });
        const noteMessage = yield* c.postMessage({
          noteId: note.id,
          text: 'A broken\nparagraph [1].',
          requestReply: false
        });
        const input = {
          messageId: noteMessage.id,
          expectedActiveVersionId: noteMessage.activeVersionId!,
          strategyId: 'chatgpt'
        };
        const receipt = yield* c.convertMessage(input);

        test.expect(yield* c.convertMessage(input)).toEqual(receipt);
        const pending = yield* c.message(noteMessage.id);

        test.expect(pending.activeVersionId).toBe(noteMessage.activeVersionId);
        test.expect(pending.versions).toHaveLength(2);
        yield* c.editMessage({ messageId: noteMessage.id, text: 'My newer edit.' });
        const edited = yield* c.message(noteMessage.id);

        yield* withTestPublication(
          context,
          c.publishReply({
            requestId: receipt.requestId,
            text: 'A broken paragraph [1].',
            citations: []
          })
        );
        const completed = yield* c.message(noteMessage.id);

        test.expect(completed.activeVersionId).toBe(edited.activeVersionId);
        test.expect(completed.versions.find((v) => v.id === receipt.versionId)).toMatchObject({
          text: 'A broken paragraph [1].',
          status: 'complete',
          basedOn: noteMessage.activeVersionId,
          origin: 'convert'
        });
        test.expect(completed.versions[0]?.text).toBe('A broken\nparagraph [1].');
        test.expect(yield* c.convertMessage(input)).toEqual(receipt);
      }).pipe(Effect.provide(services()))
    );
  }
);

test.stable(
  'automatic conversion is opt-in and uses the same durable request as the button',
  async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Notes;
        const settings = yield* Settings;
        const note = yield* c.createNote({ title: 'Automatic' });
        const manual = yield* c.postMessage({
          noteId: note.id,
          text: 'Two\nlines.',
          requestReply: false
        });

        test.expect(manual.versions).toHaveLength(1);
        test
          .expect(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .some(
                (event) => event.type === 'NoteGenerationRequested' && event.messageId === manual.id
              )
          )
          .toBe(false);
        yield* settings.saveWorkspacePreferences({
          ...(yield* settings.workspacePreferences()),
          textConversionMode: 'automatic'
        });
        const automatic = yield* c.postMessage({
          noteId: note.id,
          text: 'More\nlines.',
          requestReply: false
        });

        test.expect(automatic.versions).toHaveLength(2);
        const input = {
          messageId: automatic.id,
          expectedActiveVersionId: automatic.activeVersionId!,
          strategyId: 'chatgpt'
        };
        const receipt = yield* c.convertMessage(input);

        test
          .expect(receipt.versionId)
          .toBe(automatic.versions.find((version) => version.origin === 'convert')?.id);

        test.expect((yield* c.message(automatic.id)).versions).toHaveLength(2);
        test
          .expect(
            (yield* c.replySnapshot({ requestId: receipt.requestId })).generation?.conversion
              ?.strategyId
          )
          .toBe('chatgpt');
        const unavailable = yield* Effect.result(
          c.convertMessage({ ...input, strategyId: 'missing' })
        );

        test.expect(unavailable._tag).toBe('Failure');
      }).pipe(Effect.provide(services()))
    );
  }
);

test.stable(
  'failed conversions retain their payload, unblock replies and support exact retry or discard',
  async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Notes;
        const note = yield* c.createNote({ title: 'Recovery' });
        const noteMessage = yield* c.postMessage({
          noteId: note.id,
          text: 'Broken\ntext.',
          requestReply: false
        });
        const input = {
          messageId: noteMessage.id,
          expectedActiveVersionId: noteMessage.activeVersionId!,
          strategyId: 'chatgpt'
        };
        const receipt = yield* c.convertMessage(input);

        test
          .expect((yield* Effect.result(c.requestReply({ noteId: note.id })))._tag)
          .toBe('Failure');

        yield* withTestPublication(context, c.failConversion(receipt).pipe(Effect.asVoid));
        const failed = yield* c.message(noteMessage.id);

        test.expect(failed.versions.at(-1)).toMatchObject({
          status: 'failed',
          generationRequestId: receipt.requestId
        });
        test.expect(failed.activeVersionId).toBe(noteMessage.activeVersionId);
        test.expect((yield* c.requestReply({ noteId: note.id })).requestId).toBeTruthy();
        const rewrite = yield* c.rewriteMessage({ messageId: noteMessage.id, origin: 'improve' });

        test
          .expect(
            (yield* c.message(noteMessage.id)).versions.find(
              (version) => version.id === receipt.versionId
            )?.status
          )
          .toBe('failed');
        test.expect((yield* Effect.result(c.convertMessage(input)))._tag).toBe('Failure');
        yield* withTestPublication(context, c.abandonReply(rewrite).pipe(Effect.asVoid));

        test.expect(yield* c.convertMessage(input)).toEqual(receipt);
        test.expect(yield* c.convertMessage(input)).toEqual(receipt);
        const events = context.db.orm
          .select()
          .from(workflowEvents)
          .all()
          .map((row) => decodeEvent(row.payload))
          .filter(
            (event) =>
              event.type === 'NoteGenerationRequested' && event.requestId === receipt.requestId
          );

        test.expect(events).toHaveLength(2);
        test.expect((yield* c.message(noteMessage.id)).versions.at(-1)?.status).toBe('pending');
        yield* withTestPublication(context, c.failConversion(receipt).pipe(Effect.asVoid));
        yield* c.deleteMessageVersion({ messageId: noteMessage.id, versionId: receipt.versionId });
        test.expect((yield* c.message(noteMessage.id)).versions).toHaveLength(1);
      }).pipe(Effect.provide(services()))
    );
  }
);

test.stable('failed conversion retry rejects a base version that is no longer active', async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const c = yield* Notes;
      const note = yield* c.createNote({ title: 'Stale conversion' });
      const noteMessage = yield* c.postMessage({
        noteId: note.id,
        text: 'Original\ntext.',
        requestReply: false
      });
      const input = {
        messageId: noteMessage.id,
        expectedActiveVersionId: noteMessage.activeVersionId!,
        strategyId: 'chatgpt'
      };
      const receipt = yield* c.convertMessage(input);

      yield* withTestPublication(context, c.failConversion(receipt).pipe(Effect.asVoid));
      yield* c.editMessage({ messageId: noteMessage.id, text: 'A newer edit.' });
      const edited = yield* c.message(noteMessage.id);
      const events = context.db.orm.select().from(workflowEvents).all();
      const error = yield* c
        .convertMessage(input)
        .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => null }));

      test.expect(error?.kind).toBe('invalid_input');
      test.expect(yield* c.message(noteMessage.id)).toEqual(edited);
      test
        .expect(edited.versions.find((version) => version.id === receipt.versionId)?.status)
        .toBe('failed');
      test.expect(context.db.orm.select().from(workflowEvents).all()).toEqual(events);
    }).pipe(Effect.provide(services()))
  );
});

test.stable(
  'Ask schedules automatic conversion once after capturing its original reply input',
  async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Notes;
        const settings = yield* Settings;
        const manualNote = yield* c.createNote({ title: 'Manual Ask' });
        const manual = yield* c.ask({
          noteId: manualNote.id,
          intentKey: 'manual-ask',
          expectedSelectionRevision: 0n,
          text: 'Manual\ninput.'
        });

        test.expect((yield* c.message(manual.userMessageId)).versions).toHaveLength(1);
        yield* settings.saveWorkspacePreferences({
          ...(yield* settings.workspacePreferences()),
          textConversionMode: 'automatic'
        });
        const note = yield* c.createNote({ title: 'Automatic Ask' });
        const input = {
          noteId: note.id,
          intentKey: 'automatic-ask',
          expectedSelectionRevision: 0n,
          text: 'Original\nAsk input.'
        };
        const asked = yield* c.ask(input);
        const noteMessage = yield* c.message(asked.userMessageId);

        test.expect(noteMessage.versions).toHaveLength(2);
        test.expect(noteMessage.activeVersionId).toBe(asked.userVersionId);
        const conversion = noteMessage.versions.find((version) => version.origin === 'convert')!;

        test.expect(conversion).toMatchObject({ status: 'pending', basedOn: asked.userVersionId });
        test.expect((yield* c.replySnapshot(asked)).messages.at(-1)).toMatchObject({
          messageId: noteMessage.id,
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
              event.type === 'NoteGenerationRequested' && event.messageId === noteMessage.id
          );

        test.expect(conversionEvents).toHaveLength(1);
        test.expect(conversionEvents[0]).toMatchObject({
          versionId: conversion.id,
          operation: 'rewrite'
        });
        const receipt = yield* c.convertMessage({
          messageId: noteMessage.id,
          expectedActiveVersionId: asked.userVersionId,
          strategyId: 'chatgpt'
        });

        test.expect(receipt.versionId).toBe(conversion.id);
        yield* withTestPublication(context, c.failConversion(receipt).pipe(Effect.asVoid));
        const events = context.db.orm.select().from(workflowEvents).all();

        test.expect(yield* c.ask(input)).toEqual(asked);
        test.expect(context.db.orm.select().from(workflowEvents).all()).toEqual(events);
        test
          .expect(
            (yield* c.message(noteMessage.id)).versions.find(
              (version) => version.id === conversion.id
            )?.status
          )
          .toBe('failed');
      }).pipe(Effect.provide(services()))
    );
  }
);
