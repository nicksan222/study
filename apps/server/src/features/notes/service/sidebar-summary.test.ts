/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Covers note and message pagination, immutable versions, attachment ownership       │
 * │ and snapshots, reply and title context limits, outbox rollback, thread isolation,        │
 * │ validation, and explicit or mention-triggered replies.                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises pagination, ownership fences, captured context, and atomic outbox behavior.  │
 * │ - Uses database fixtures to verify service-visible invariants and failures.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses real SQLite fixtures and service dependencies; domain state remains owned │
 * │ by the feature implementation.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { plainBlock } from '@study/contracts/sources/document';
import { eq } from '@study/db';
import { workflow_executions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Notes } from '#server/features/notes/service/index';
import { Pages } from '#server/features/pages/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { withTestPublication } from '#testing/publication';

const meta = {
  language: null,
  originalFormat: 'text',
  extractor: null,
  extractorVersion: 1,
  provider: null,
  durationMs: null,
  pageCount: null,
  refiners: [],
  waitingFor: [],
  corrected: false,
  omissions: []
};

testStable(
  'sidebar summaries count distinct attached generated documents and report durable work',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Layer.merge(Notes.layer, Pages.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const library = yield* Pages;
          const note = yield* notes.createNote({ title: 'Study' });

          yield* notes.setNoteSettled({ id: note.id, settled: true });
          assert.ok((yield* notes.noteSummaries({})).items[0]?.settledOverride === true);
          yield* notes.setNoteSettled({ id: note.id, settled: true });
          assert.ok((yield* notes.noteSummaries({})).items[0]?.settledOverride === true);
          yield* notes.setNoteSettled({ id: note.id, settled: false });
          assert.ok((yield* notes.noteSummaries({})).items[0]?.settledOverride === false);
          const missing = yield* Effect.flip(
            notes.setNoteSettled({
              id: (note.id + 1000n) as typeof note.id,
              settled: true
            })
          );

          assert.ok(missing.kind === 'not_found');
          const document = {
            blocks: [plainBlock('paragraph', 'Notes', { type: 'authored' })],
            meta
          };

          yield* library.create({
            createKey: randomUUID(),
            title: 'Manual',
            document,
            noteId: note.id,
            inputs: [],
            citations: []
          });
          assert.strictEqual((yield* notes.noteSummaries({})).items[0]?.generatedPageCount, 0n);
          yield* withTestPublication(
            context,
            library
              .createGenerated({
                requestId: 'sidebar-generated',
                title: 'Generated',
                document: {
                  ...document,
                  blocks: [plainBlock('paragraph', 'Generated', { type: 'authored' })]
                },
                inputs: [],
                citations: [],
                operation: 'generate',
                instruction: 'Generate',
                language: null,
                noteId: note.id
              })
              .pipe(Effect.asVoid)
          );
          const generated = (yield* library.pages({
            noteId: note.id,
            limit: 10,
            archived: false
          })).items.find((item) => item.title === 'Generated');

          assert.ok(generated);
          const summary = (yield* notes.noteSummaries({})).items[0];

          expect(summary).toStrictEqual({
            id: note.id,
            generatedPageCount: 1n,
            settledOverride: false,
            running: false,
            activity: 'idle'
          });
          yield* library.archive({ id: generated.id, archived: true });
          assert.strictEqual((yield* notes.noteSummaries({})).items[0]?.generatedPageCount, 0n);
          const noteMessage = yield* notes.postMessage({
            noteId: note.id,
            text: 'Question',
            requestReply: false
          });
          const request = yield* notes.requestReply({ noteId: note.id });

          context.db.orm
            .insert(workflow_executions)
            .values({
              execution_id: 'sidebar-test',
              workflow_tag: 'test',
              version: 1,
              payload: JSON.stringify({ event: { correlationId: request.requestId } }),
              status: 'running',
              created_at: noteMessage.createdAt,
              updated_at: noteMessage.createdAt
            })
            .run();
          assert.ok((yield* notes.noteSummaries({})).items[0]?.activity === 'answering');
          context.db.orm
            .update(workflow_executions)
            .set({ status: 'completed' })
            .where(eq(workflow_executions.execution_id, 'sidebar-test'))
            .run();
          assert.ok((yield* notes.noteSummaries({})).items[0]?.running === false);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
