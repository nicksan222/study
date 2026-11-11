/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies guarded note publication validates captured citations and replays         │
 * │ its receipt without repeating writes.                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks publication guard receipts against citations and persisted note state.          │
 * │ - Asserts durable effects against persisted state and replay behavior.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite drives the native workflow engine with persisted test state; it does not       │
 * │ replace production activities.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { blockIdSchema } from '@study/contracts/sources/schemas';
import { eq, sql } from '@study/db';
import {
  blocks,
  content_snapshots,
  notes as noteTable,
  source_processing,
  sources,
  source_snapshots,
  source_extraction_revisions
} from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Notes } from '#server/features/notes/service/index';
import { Projects } from '#server/features/projects/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { withPublicationGuard } from '#server/platform/workflows/publication';

testStable(
  'guarded publication validates captured citations and replays without writes',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const layer = Layer.merge(Projects.layer, Notes.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      function* verifyGuardedCitationPublication() {
        const project = yield* (yield* Projects).createProject({ name: 'Publication' });
        const notes = yield* Notes;
        const note = yield* notes.createNote({
          project: project.id,
          title: 'Chat'
        });
        const source = context.db.orm
          .insert(sources)
          .values({
            project_id: project.id,
            origin: 'attachment',
            kind: 'text',
            mime: 'text/plain',
            name: 'captured.txt',
            size_bytes: 1n,
            sha256: Buffer.alloc(32),
            created_at: 1n
          })
          .returning()
          .get();
        const document = context.db.orm
          .insert(content_snapshots)
          .values({
            source_id: source.id,
            extractor_version: 1n,
            meta: JSON.stringify({
              extractor: null,
              extractorVersion: 1,
              provider: null,
              durationMs: null,
              pageCount: null,
              refiners: [],
              waitingFor: [],
              corrected: false,
              omissions: []
            }),
            created_at: 1n
          })
          .returning()
          .get();

        context.db.orm
          .insert(blocks)
          .values({
            document_id: document.id,
            ordinal: 0n,
            kind: 'paragraph',
            editing_id: Schema.decodeUnknownSync(blockIdSchema)(crypto.randomUUID()),
            content: JSON.stringify({
              type: 'paragraph',
              inlines: [{ type: 'text', text: 'A quoted passage', marks: [] }]
            }),
            text: 'A quoted passage',
            anchor: JSON.stringify({ type: 'page', page: 3 })
          })
          .run();
        context.db.orm
          .insert(source_processing)
          .values({
            source_id: source.id,
            revision: 1n,
            request_id: 'source',
            published_request_id: 'source',
            document_id: document.id
          })
          .run();
        context.db.orm
          .insert(source_snapshots)
          .values({
            source_id: source.id,
            revision: 1n,
            bytes: Buffer.from([1]),
            kind: 'text',
            mime: 'text/plain'
          })
          .run();
        context.db.orm
          .insert(source_extraction_revisions)
          .values({ source_id: source.id, revision: 1n, snapshot_id: document.id })
          .run();
        yield* notes.postMessage({
          noteId: note.id,
          text: 'question',
          sourceIds: [source.id]
        });
        const request = yield* notes.requestReply({ noteId: note.id });
        const input = {
          requestId: request.requestId,
          text: 'Answer [1]',
          citations: [
            {
              marker: 1,
              sourceId: source.id,
              input: {
                kind: 'source' as const,
                sourceId: source.id,
                revision: 1n,
                snapshotId: document.id
              },
              documentId: document.id,
              blockOrdinal: 0,
              quote: 'quoted passage'
            }
          ]
        };

        assert.ok(
          (yield* Effect.flip(withPublicationGuard(context, notes.publishReply(input)))).kind ===
            'internal'
        );
        const workflow = Workflow.make('reply-publication-test', {
          payload: { id: Schema.String },
          idempotencyKey: ({ id }) => id
        });
        const engine = yield* WorkflowEngine.WorkflowEngine;

        yield* engine.register(workflow, () =>
          Activity.make({
            name: 'publish',
            execute: withPublicationGuard(
              context,
              Effect.gen(function* () {
                for (const bad of [
                  { ...input, citations: [{ ...input.citations[0]!, quote: 'forged' }] },
                  {
                    ...input,
                    citations: [
                      {
                        ...input.citations[0]!,
                        documentId: (document.id + 1n) as typeof document.id
                      }
                    ]
                  },
                  {
                    ...input,
                    citations: [
                      { ...input.citations[0]!, sourceId: (source.id + 1n) as typeof source.id }
                    ]
                  },
                  { ...input, text: 'Answer [2]' },
                  { ...input, text: 'Answer [1] and [2]' },
                  { ...input, text: ' ' },
                  { ...input, text: 'x'.repeat(100_001) },
                  { ...input, citations: [{ ...input.citations[0]!, marker: 0 }] },
                  { ...input, citations: [{ ...input.citations[0]!, blockOrdinal: 1 }] },
                  { ...input, citations: [{ ...input.citations[0]!, quote: ' ' }] },
                  { ...input, citations: [input.citations[0]!, input.citations[0]!] },
                  { ...input, requestId: 'missing' }
                ]) {
                  yield* Effect.flip(notes.publishReply(bad));
                  assert.ok(
                    (yield* notes.message(request.messageId)).versions[0]?.status === 'pending'
                  );
                  assert.strictEqual(context.db.orm.all(sql`SELECT * FROM citations`).length, 0);
                }

                const historicNote = yield* notes.createNote({
                  project: project.id,
                  title: 'Historic'
                });
                const historicQuestion = yield* notes.postMessage({
                  noteId: historicNote.id,
                  text: 'old'
                });
                const historic = yield* notes.requestReply({
                  noteId: historicNote.id
                });

                yield* notes.editMessage({ messageId: historicQuestion.id, text: 'new' });
                assert.ok(
                  (yield* notes.replySnapshot({ requestId: historic.requestId })).messages[0]
                    ?.text === 'old'
                );
                assert.strictEqual(
                  yield* notes.publishReply({
                    requestId: historic.requestId,
                    text: 'answer',
                    citations: []
                  }),
                  historic.versionId
                );
                assert.ok(
                  (yield* notes.message(historic.messageId)).versions[0]?.status === 'complete'
                );
                yield* notes.deleteMessage(historic.messageId);
                assert.ok(
                  (yield* Effect.flip(
                    notes.publishReply({
                      requestId: historic.requestId,
                      text: 'answer',
                      citations: []
                    })
                  )).kind === 'not_found'
                );
                const revision = context.db.orm
                  .select()
                  .from(noteTable)
                  .where(eq(noteTable.id, note.id))
                  .get()!.context_revision;

                assert.strictEqual(yield* notes.publishReply(input), request.versionId);
                const message = yield* notes.message(request.messageId);

                assert.strictEqual(message.activeVersionId, request.versionId);
                assert.ok(message.versions[0]?.text === 'Answer [1]');
                expect(message.citations).toStrictEqual([
                  {
                    origin: 'agent',
                    support: { state: 'unassessed' },
                    precision: 'approximate',
                    evidence: {
                      availability: 'available',
                      precision: 'approximate',
                      snapshotId: document.id,
                      excerpt: 'quoted passage'
                    },
                    marker: 1,
                    sourceId: source.id,
                    input: {
                      kind: 'source',
                      sourceId: source.id,
                      revision: 1n,
                      snapshotId: document.id
                    },
                    documentId: document.id,
                    blockId: context.db.orm
                      .select()
                      .from(blocks)
                      .where(eq(blocks.document_id, document.id))
                      .get()!.editing_id,
                    rangeStart: null,
                    rangeEnd: null,
                    sourceName: 'captured.txt',
                    anchor: { type: 'page', page: 3 },
                    quote: 'quoted passage'
                  }
                ]);
                assert.strictEqual(yield* notes.publishReply(input), request.versionId);
                yield* Effect.flip(notes.publishReply({ ...input, text: 'Changed [1]' }));
                yield* Effect.flip(
                  notes.publishReply({
                    ...input,
                    citations: [{ ...input.citations[0]!, quote: 'quoted' }]
                  })
                );
                assert.strictEqual(
                  context.db.orm.select().from(noteTable).where(eq(noteTable.id, note.id)).get()!
                    .context_revision,
                  revision + 1n
                );
                assert.strictEqual(context.db.orm.all(sql`SELECT * FROM citations`).length, 1);
                assert.strictEqual(
                  context.db.orm.all(
                    sql`SELECT * FROM workflow_events WHERE type = 'NoteGenerationRequested'`
                  ).length,
                  2
                );
              })
            ).pipe(Effect.orDie)
          })
        );
        yield* engine.execute(workflow, {
          executionId: 'reply-publication-test',
          payload: { id: 'one' }
        });
      }

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(verifyGuardedCitationPublication).pipe(
            Effect.provide(layer),
            Effect.provide(workflowEngineLayer(context))
          )
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
