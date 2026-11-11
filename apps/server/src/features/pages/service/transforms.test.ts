/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises native note transformation requests and atomic derivative                │
 * │ publication.                                                                             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Covers exact snapshots, rollback, cancellation and retained library outputs.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use migrated SQLite and native publication ownership without remote providers.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { PagesRpc } from '@study/contracts/pages/rpc';
import type { transformPublicationSchema } from '@study/contracts/pages/transform';
import { createBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { assert, expect } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { PagesRpcLive } from '#server/features/pages/rpc/index';
import { Projects } from '#server/features/projects/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { withTestPublication } from '#testing/publication';

const meta = {
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

const paragraph = (text: string) =>
  createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] });

testStable(
  'quick-note RPC captures exact note pages and publishes one independent derivative atomically',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const domain = Layer.mergeAll(Pages.layer, Notes.layer, Settings.layer, Projects.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
    const handlers = PagesRpcLive.pipe(Layer.provide(domain));

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Pages;
          const notes = yield* Notes;
          const collection = yield* (yield* Projects).createProject({ name: 'Inputs' });
          const note = yield* notes.createNote({ title: 'Quick' });
          const block = paragraph('private before alpha selected private after');
          const original = yield* materials.create({
            noteId: note.id,
            title: 'Original',
            projectId: collection.id,
            document: { blocks: [block, paragraph('alpha selected')], meta },
            inputs: [],
            citations: [],
            createKey: 'original'
          });
          const versionId = original.version!.id;

          yield* notes.updateNoteSelection({
            noteId: note.id,
            expectedRevision: 0n,
            targets: [{ input: { kind: 'page', versionId }, scope: { kind: 'document' } }]
          });
          yield* notes.captureNoteContext({
            noteId: note.id,
            intentKey: 'whole',
            instruction: 'Read',
            preferences: {}
          });

          yield* notes.updateNoteSelection({
            noteId: note.id,
            expectedRevision: 1n,
            targets: [
              {
                input: { kind: 'page', versionId },
                scope: { kind: 'blocks', blockIds: [block.id] }
              }
            ]
          });
          const selectedBlock = yield* notes.captureNoteContext({
            noteId: note.id,
            intentKey: 'block',
            instruction: 'Read',
            preferences: {}
          });

          assert.strictEqual(selectedBlock.inputs[0]!.excerpts[0]!.blockId, block.id);
          yield* notes.updateNoteSelection({
            noteId: note.id,
            expectedRevision: 2n,
            targets: [
              {
                input: { kind: 'page', versionId },
                scope: {
                  kind: 'ranges',
                  ranges: [{ blockId: block.id, start: 15, end: 29 }]
                }
              }
            ]
          });
          const capture = yield* notes.captureNoteContext({
            noteId: note.id,
            intentKey: 'range',
            instruction: 'Keep qualifiers',
            preferences: { language: 'italian', detail: 'brief' }
          });

          return { note, block, original, versionId, capture, collection };
        }).pipe(Effect.provide(domain))
      );
      const requestInput = {
        contextRequestId: setup.capture.requestId,
        title: 'Derivative',
        operations: ['clarity', 'summarize'] as const
      };
      const request = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(PagesRpc, { flatten: true });
            const first = yield* client('pages.requestTransform', requestInput);
            const replay = yield* client('pages.requestTransform', requestInput);

            assert.strictEqual(first.id, replay.id);
            assert.strictEqual(first.noteId, setup.note.id);
            assert.ok(
              (yield* Effect.flip(
                client('pages.requestTransform', { ...requestInput, title: 'Changed' })
              )).kind === 'invalid_input'
            );

            return first;
          }).pipe(Effect.provide(handlers))
        )
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;
          const materials = yield* Pages;

          yield* chats.updateNoteSelection({
            noteId: setup.note.id,
            expectedRevision: 3n,
            targets: []
          });
          yield* materials.save({
            pageId: setup.original.id,
            expectedVersionId: setup.versionId,
            key: 'later-edit',
            document: { blocks: [paragraph('new secret content')], meta }
          });
          yield* (yield* Projects).deleteProject({ id: setup.collection.id });
          const retained = yield* (yield* Notes).pageTransformContext({
            requestId: request.id
          });

          assert.ok(
            retained.inputs[0]!.excerpts[0]!.text === 'private before alpha selected private after'
          );
          expect(retained.preferences).toStrictEqual({ language: 'italian', detail: 'brief' });
        }).pipe(Effect.provide(domain))
      );
      const output = paragraph('Sintesi [1]');
      const publication: typeof transformPublicationSchema.Type = {
        requestId: request.id,
        generationEventId: request.eventId,
        document: { blocks: [output], meta },
        citations: [
          {
            marker: 1,
            input: { kind: 'page', versionId: setup.versionId },
            anchor: { type: 'authored' },
            quote: 'private before alpha selected private after',
            target: {
              blockId: setup.block.id,
              start: 0,
              end: setup.block.text.length
            }
          }
        ],
        report: {
          notes: [
            { kind: 'omission', explanation: 'Selected details condensed', blockIds: [output.id] }
          ]
        }
      };
      const publish = (value: typeof publication) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* withTestPublication(
              context,
              (yield* Notes).publishPageTransform(value).pipe(Effect.asVoid)
            );
          }).pipe(Effect.provide(domain))
        );
      const before = context.db.orm.select().from(s.pages).all().length;

      await expect(
        publish({
          ...publication,
          citations: [{ ...publication.citations[0]!, quote: 'uncaptured fabricated quote' }]
        })
      ).rejects.toSatisfy(() => true);
      await expect(
        publish({
          ...publication,
          document: { blocks: [{ ...output, id: setup.block.id }], meta }
        })
      ).rejects.toSatisfy(() => true);
      context.db.orm.run(
        sql`CREATE TRIGGER reject_transform_event BEFORE INSERT ON workflow_events WHEN NEW.type='PagePublished' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END`
      );
      await expect(publish(publication)).rejects.toSatisfy(() => true);
      assert.strictEqual(context.db.orm.select().from(s.pages).all().length, before);
      context.db.orm.run(sql`DROP TRIGGER reject_transform_event`);
      await publish(publication);
      await publish(publication);
      assert.strictEqual(context.db.orm.select().from(s.pages).all().length, before + 1);
      await expect(
        publish({
          ...publication,
          report: { notes: [{ kind: 'limit', explanation: 'Different', blockIds: [] }] }
        })
      ).rejects.toSatisfy(() => true);
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Pages;
          const result = yield* materials.transform({
            requestId: request.id
          });

          assert.ok(result.resultVersionId);
          expect(result.report).toStrictEqual(publication.report);
          const derivative = yield* materials.version({ id: result.resultVersionId });

          expect(derivative.inputs).toStrictEqual([{ kind: 'page', versionId: setup.versionId }]);
          assert.ok(derivative.document.blocks.length);
          expect((yield* materials.page({ id: derivative.pageId })).projectIds).toStrictEqual([]);
          expect((yield* materials.version({ id: setup.versionId })).document).toStrictEqual(
            setup.original.version!.document
          );
          assert.strictEqual(
            (yield* materials.pages({
              noteId: setup.note.id,
              archived: false,
              limit: 10
            })).items.length,
            2
          );

          for (const status of ['running', 'cancelled'] as const) {
            context.db.orm
              .insert(s.workflow_executions)
              .values({
                execution_id: `publication-won-${status}`,
                workflow_tag: 'document-transform/v1',
                version: 1,
                payload: JSON.stringify({ event: { correlationId: request.id } }),
                status,
                result: status === 'running' ? JSON.stringify('__interrupt_safe__') : null,
                created_at: 1n,
                updated_at: 1n
              })
              .run();
            const read = yield* materials.transform({
              requestId: request.id
            });

            assert.ok(read.cancelled === false);
            assert.strictEqual(read.resultVersionId, result.resultVersionId);
          }

          const cancelled = yield* materials.cancelTransform({ requestId: request.id });

          assert.ok(cancelled.cancelled === false);
          assert.strictEqual(cancelled.resultVersionId, result.resultVersionId);
          yield* (yield* Notes).deleteNote(setup.note.id);
          assert.strictEqual(
            (yield* materials.version({ id: result.resultVersionId })).id,
            result.resultVersionId
          );
          expect(
            (yield* materials.version({ id: result.resultVersionId })).citations[0]?.target
          ).toStrictEqual(publication.citations[0]!.target);
        }).pipe(Effect.provide(domain))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

testStable(
  'cancelled and deleted note captures reject retries and late publication without saved output',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const domain = Layer.mergeAll(Pages.layer, Notes.layer, Settings.layer, Projects.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Pages;
          const chats = yield* Notes;

          for (const mode of ['cancel', 'delete'] as const) {
            const note = yield* chats.createNote({ title: mode });

            yield* chats.postMessage({
              noteId: note.id,
              text: 'Note input',
              requestReply: false
            });
            const capture = yield* chats.captureNoteContext({
              noteId: note.id,
              intentKey: mode,
              instruction: 'Explain',
              preferences: {}
            });
            const request = yield* (yield* Notes).requestPageTransform({
              contextRequestId: capture.requestId,
              title: mode,
              operations: ['explain']
            });

            if (mode === 'cancel') {
              const cancelled = yield* materials.cancelTransform({ requestId: request.id });

              assert.ok(cancelled.cancelled === true);
              const persisted = context.db.orm.get<{ cancelled: bigint }>(
                sql`SELECT cancelled FROM page_transform_requests WHERE id = ${request.id}`
              );

              assert.strictEqual(persisted?.cancelled, 1n);
              const duplicate = yield* chats.requestPageTransform({
                contextRequestId: capture.requestId,
                title: mode,
                operations: ['explain']
              });

              assert.strictEqual(duplicate.id, request.id);
              assert.ok((yield* materials.transform({ requestId: request.id })).cancelled === true);
            } else yield* chats.deleteNote(note.id);

            assert.strictEqual(
              (yield* Effect.flip(
                (yield* Notes).retryPageTransform({
                  requestId: request.id,
                  retryId: mode + '-retry'
                })
              )).kind,
              mode === 'cancel' ? 'cancelled' : 'not_found'
            );
            const output = paragraph('Useful but late');
            const failure = yield* Effect.flip(
              withTestPublication(
                context,
                (yield* Notes)
                  .publishPageTransform({
                    requestId: request.id,
                    generationEventId: request.eventId,
                    document: { blocks: [output], meta },
                    citations: [],
                    report: {
                      notes: [
                        { kind: 'addition', explanation: 'Explanation', blockIds: [output.id] }
                      ]
                    }
                  })
                  .pipe(Effect.asVoid)
              )
            );

            assert.strictEqual(failure.kind, mode === 'cancel' ? 'cancelled' : 'not_found');
          }

          assert.strictEqual(
            (yield* materials.pages({ archived: false, limit: 10 })).items.length,
            0
          );
        }).pipe(Effect.provide(domain))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
