import type { NoteId } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies source lifecycle, processing, export, correction, and project assignment  │
 * │ behavior through the feature service.                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises sources service persists requests and pages, and rolls back invalid          │
 * │   requests.                                                                              │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { projectIdSchema } from '@study/contracts';
import type { ProjectId, SourceId } from '@study/contracts';
import { correctBlockText, plainBlock } from '@study/contracts';
import { sql } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer, Option } from 'effect';

import { Pages } from '#server/features/pages/index';
import { SourceStore } from '#server/features/sources/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { deletionDocument } from '#testing/material-deletion';
import { createUnregisteredSource } from '#testing/source';
import { withTestAdmission } from '#testing/workflow-admission';

import { Sources } from './index.ts';

test.stable(
  'sources service persists requests and pages, and rolls back invalid requests',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Sources.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const absent = 99999n as SourceId;

          test.assert.ok(Option.isNone(yield* sources.findSource(absent)));
          test.assert.ok((yield* Effect.flip(sources.source(absent))).kind === 'not_found');
          const input = {
            name: 'test.txt',
            bytes: new TextEncoder().encode('hello'),
            projectId: null
          };
          const first = yield* sources.createSource(input);
          const second = yield* sources.createSource(input);
          const page = yield* sources.sources({ limit: 1 });

          test.assert.strictEqual(page.next, second.id);
          test.assert.ok((yield* sources.sources({ limit: 1, before: page.next! })).next === null);
          const state = yield* sources.sourceProcessing(first.id);

          test.assert.ok(
            (yield* Effect.flip(
              sources.requestSourceProcessing({ id: first.id, expectedRevision: 2 })
            )).kind === 'invalid_input'
          );
          test.expect(yield* sources.sourceProcessing(first.id)).toStrictEqual(state);
          test.assert.strictEqual(context.db.orm.all(sql`SELECT * FROM workflow_events`).length, 2);
          test.assert.ok(
            (yield* Effect.flip(
              sources.replaceSource({
                id: first.id,
                expectedRevision: 1,
                name: '   ',
                bytes: new Uint8Array([1])
              })
            )).kind === 'invalid_input'
          );
          test.assert.ok(
            (yield* Effect.flip(
              sources.replaceSource({
                id: first.id,
                expectedRevision: 1,
                name: 'empty.txt',
                bytes: new Uint8Array()
              })
            )).kind === 'invalid_input'
          );
          test.expect(yield* sources.sourceProcessing(first.id)).toStrictEqual(state);
          const next = yield* sources.requestSourceProcessing({
            id: first.id,
            expectedRevision: 1
          });

          test.assert.notStrictEqual(next.requestId, state.requestId);
          test.assert.strictEqual(context.db.orm.all(sql`SELECT * FROM workflow_events`).length, 3);
          test.assert.ok(
            (yield* sources.sourceSnapshot({ id: first.id, revision: 1 })).kind === 'text'
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable('a failed event insertion rolls back source creation', async ({ databases }) => {
  const location = await databases();
  const context = new ServerContext(await location.open());
  const layer = Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

  try {
    const existing = await Effect.runPromise(
      Effect.gen(function* () {
        const sources = yield* Sources;

        return yield* sources.createSource({
          name: 'before.txt',
          bytes: new Uint8Array([1]),
          projectId: null
        });
      }).pipe(Effect.provide(layer))
    );
    const before = context.db.orm.get(
      sql`SELECT request_id FROM source_processing WHERE source_id = ${existing.id}`
    );

    context.db.orm.run(
      sql`CREATE TRIGGER reject_source_event BEFORE INSERT ON workflow_events BEGIN SELECT RAISE(ABORT, 'rejected'); END`
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const sources = yield* Sources;

        yield* Effect.flip(
          sources.createSource({ name: 'test.txt', bytes: new Uint8Array([1]), projectId: null })
        );
        yield* Effect.flip(
          sources.requestSourceProcessing({ id: existing.id, expectedRevision: 1 })
        );
        yield* Effect.flip(
          sources.replaceSource({
            id: existing.id,
            expectedRevision: 1,
            name: 'new.pdf',
            bytes: new Uint8Array([2])
          })
        );
        test.assert.ok((yield* sources.source(existing.id)).name === 'before.txt');
        test.assert.strictEqual((yield* sources.sourceProcessing(existing.id)).revision, 1);
        test.assert.strictEqual(context.db.orm.all(sql`SELECT * FROM source_snapshots`).length, 1);
      }).pipe(Effect.provide(layer))
    );
    test.assert.strictEqual(context.db.orm.all(sql`SELECT * FROM sources`).length, 1);
    test.assert.strictEqual(context.db.orm.all(sql`SELECT * FROM source_processing`).length, 1);
    test
      .expect(
        context.db.orm.get(
          sql`SELECT request_id FROM source_processing WHERE source_id = ${existing.id}`
        )
      )
      .toStrictEqual(before);
  } finally {
    context.close();
    await location.cleanup();
  }
});

test.stable('publication requires a real active workflow grant', async ({ databases }) => {
  const location = await databases();
  const context = new ServerContext(await location.open());
  const layer = Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));
  const { Activity, Workflow, WorkflowEngine } = await import('effect/workflow');
  const { Schema } = await import('effect');
  const { withPublicationGuard } = await import('#server/platform/workflows/publication');
  const { workflowEngineLayer } = await import('#server/platform/workflows/engine');
  const document = {
    blocks: [plainBlock('paragraph' as const, 'hello', { type: 'page' as const, page: 1 })],
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

  try {
    context.db.orm.run(
      sql`INSERT INTO projects (id, name, created_at, updated_at) VALUES (1, 'Project', 1, 1)`
    );

    function* verifyActiveWorkflowGrant() {
      const sources = yield* Sources;
      const source = yield* sources.createSource({
        name: 'test.txt',
        bytes: new Uint8Array([1]),
        projectId: 1n as ProjectId
      });
      const state = yield* sources.sourceProcessing(source.id);
      const input = {
        event: {
          type: 'SourceProcessingRequested' as const,
          sourceId: source.id,
          inputVersion: state.revision,
          requestId: state.requestId!,
          eventId: 'publication-request-event',
          causationId: null,
          correlationId: 'publication-correlation',
          depth: 2
        },
        document
      };
      const denied = yield* Effect.flip(
        withPublicationGuard(context, sources.publishSourceDocument(input))
      );

      test.assert.ok(denied.kind === 'internal');
      test.assert.strictEqual(context.db.orm.all(sql`SELECT * FROM content_snapshots`).length, 0);
      const workflow = Workflow.make('source-publication-test', {
        payload: { id: Schema.String },
        idempotencyKey: ({ id }) => id
      });
      const engine = yield* WorkflowEngine.WorkflowEngine;
      const activity = Activity.make({
        name: 'publish-source',
        execute: withPublicationGuard(context, sources.publishSourceDocument(input)).pipe(
          Effect.orDie
        )
      });

      function runWorkflow() {
        return Effect.gen(function* () {
          yield* Activity.make({
            name: 'reject-source-event',
            execute: withPublicationGuard(
              context,
              Effect.gen(function* () {
                context.db.orm.run(
                  sql`CREATE TRIGGER reject_index_event BEFORE INSERT ON workflow_events WHEN NEW.type = 'SourceIndexed' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
                );
                yield* Effect.flip(sources.publishSourceDocument(input));
                test.assert.strictEqual(
                  context.db.orm.all(sql`SELECT * FROM content_snapshots`).length,
                  0
                );
                test.assert.strictEqual(context.db.orm.all(sql`SELECT * FROM chunks`).length, 0);
                test.assert.strictEqual(
                  context.db.orm.all(sql`SELECT * FROM chunks_fts WHERE chunks_fts MATCH 'hello'`)
                    .length,
                  0
                );
                context.db.orm.run(sql`DROP TRIGGER reject_index_event`);
              })
            ).pipe(Effect.orDie)
          });
          const first = yield* activity;
          const replayed = yield* Activity.make({
            name: 'publish-after-missing-checkpoint',
            execute: withPublicationGuard(context, sources.publishSourceDocument(input)).pipe(
              Effect.orDie
            )
          });

          test.assert.strictEqual(replayed, first);
          const previousDocumentId = (yield* sources.sourceProcessing(source.id)).documentId;
          const replacement = yield* sources.replaceSource({
            id: source.id,
            expectedRevision: 1,
            name: '  image.png  ',
            bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
          });

          test.assert.strictEqual(replacement.revision, 2);
          test.assert.strictEqual(replacement.documentId, previousDocumentId);
          test.expect((yield* sources.sourceDocument(source.id)).document).toStrictEqual(document);
          test.assert.ok(
            (yield* sources.sourceSnapshot({ id: source.id, revision: 1 })).kind === 'text'
          );
          test.assert.ok(
            (yield* sources.sourceSnapshot({ id: source.id, revision: 2 })).mime === 'image/png'
          );
          test.assert.ok((yield* sources.source(source.id)).name === 'image.png');
          test.assert.ok(
            (yield* Effect.flip(
              sources.replaceSource({
                id: source.id,
                expectedRevision: 1,
                name: 'stale.txt',
                bytes: new Uint8Array([1])
              })
            )).kind === 'invalid_input'
          );
          test.assert.ok((yield* sources.source(source.id)).name === 'image.png');
          yield* Activity.make({
            name: 'stale-publication',
            execute: withPublicationGuard(
              context,
              Effect.gen(function* () {
                test.assert.ok(
                  (yield* Effect.flip(sources.publishSourceDocument(input))).kind ===
                    'invalid_input'
                );
              })
            ).pipe(Effect.orDie)
          });
          const replacementInput = {
            event: { ...input.event, inputVersion: 2, requestId: replacement.requestId! },
            document
          };

          yield* Activity.make({
            name: 'replacement-publication',
            execute: withPublicationGuard(
              context,
              sources.publishSourceDocument(replacementInput)
            ).pipe(Effect.orDie)
          });
        }).pipe(Effect.orDie);
      }

      yield* engine.register(workflow, runWorkflow);
      yield* withTestAdmission(
        context,
        workflow,
        'source-publication-test',
        { id: 'one' },
        engine.execute(workflow, {
          executionId: 'source-publication-test',
          payload: { id: 'one' }
        })
      );
      test.assert.notStrictEqual((yield* sources.sourceProcessing(source.id)).documentId, null);
      const hits = context.db.orm.all(
        sql`SELECT c.text, c.anchor, c.first_block, c.last_block FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid WHERE chunks_fts MATCH 'hello'`
      );

      test.expect(yield* sources.sourceDocument(source.id)).toStrictEqual({
        id: (yield* sources.sourceProcessing(source.id)).documentId,
        document
      });
      const indexed = context.db.orm.all(
        sql`SELECT causation_id, correlation_id, depth FROM workflow_events WHERE type = 'SourceIndexed'`
      )[0]!;

      test.assert.strictEqual(indexed.causation_id, input.event.eventId);
      test.assert.strictEqual(indexed.correlation_id, input.event.correlationId);
      test.assert.strictEqual(indexed.depth, 3n);
      test.assert.strictEqual(hits.length, 2);
      test.assert.ok(hits[0]!.text === 'hello');
      test.expect(JSON.parse(hits[0]!.anchor as string)).toStrictEqual({ type: 'page', page: 1 });
      test.assert.strictEqual(hits[0]!.first_block, 0n);
      test.assert.strictEqual(hits[0]!.last_block, 0n);
      test.assert.strictEqual(context.db.orm.all(sql`SELECT * FROM chunks`).length, 2);
      test.assert.strictEqual(context.db.orm.all(sql`SELECT * FROM content_snapshots`).length, 2);
      test.assert.strictEqual(
        context.db.orm.all(sql`SELECT * FROM workflow_events WHERE type = 'SourceIndexed'`).length,
        2
      );
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(verifyActiveWorkflowGrant).pipe(
          Effect.provide(layer),
          Effect.provide(workflowEngineLayer(context))
        )
      )
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

test.stable(
  'replacement fences stale publication and search follows the current source project',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Sources.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
    const document = {
      blocks: [
        plainBlock('paragraph' as const, '   ', { type: 'page' as const, page: 1 }),
        plainBlock('paragraph' as const, 'firstword', { type: 'page' as const, page: 2 })
      ],
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
    const search = (word: string, project: bigint) =>
      context.db.orm.all(
        sql`SELECT c.text FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN content_snapshots d ON d.id = c.document_id JOIN sources s ON s.id = d.source_id WHERE chunks_fts MATCH ${word} AND d.id = (SELECT MAX(latest.id) FROM content_snapshots latest WHERE latest.source_id = d.source_id) AND s.project_id = ${project}`
      );

    try {
      context.db.orm.run(
        sql`INSERT INTO projects (id, name, created_at, updated_at) VALUES (1, 'One', 1, 1), (2, 'Two', 1, 1)`
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const source = yield* sources.createSource({
            name: 'a.txt',
            bytes: new Uint8Array([1]),
            projectId: 1n as ProjectId
          });
          const state = yield* sources.sourceProcessing(source.id);
          const first = {
            id: source.id,
            expectedRevision: 1,
            requestId: state.requestId!,
            document
          };

          const firstDocumentId = yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument(first)
          ).pipe(Effect.provideService(Database, { store: context }));
          const documentKey = {
            id: firstDocumentId.documentId,
            sourceId: source.id,
            projectId: 1n as ProjectId
          };

          test.expect((yield* sources.document(documentKey)).document).toStrictEqual(document);
          test.assert.ok(
            (yield* Effect.flip(sources.document({ ...documentKey, projectId: 2n as ProjectId })))
              .kind === 'not_found'
          );
          test.assert.strictEqual(search('firstword', 1n).length, 1);
          const rows = context.db.orm.all(sql`SELECT first_block, last_block, anchor FROM chunks`);

          test.assert.strictEqual(rows.length, 1);
          test.assert.strictEqual(rows[0]!.first_block, 1n);
          test
            .expect(JSON.parse(rows[0]!.anchor as string))
            .toStrictEqual({ type: 'page', page: 2 });
          yield* transaction((tx) =>
            tx.store(SourceStore).replaceSourceInput({
              id: source.id,
              expectedRevision: 1,
              requestId: 'replacement',
              bytes: new Uint8Array([2])
            })
          ).pipe(Effect.provideService(Database, { store: context }));
          test.assert.ok(
            (yield* Effect.flip(
              transaction((tx) => tx.store(SourceStore).publishSourceDocument(first)).pipe(
                Effect.provideService(Database, { store: context })
              )
            )).kind === 'invalid_input'
          );
          test.assert.strictEqual(
            context.db.orm.all(sql`SELECT * FROM content_snapshots`).length,
            1
          );
          const replacement = {
            ...document,
            blocks: [
              plainBlock('paragraph' as const, 'secondword', { type: 'page' as const, page: 3 })
            ]
          };

          yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: source.id,
              expectedRevision: 2,
              requestId: 'replacement',
              document: replacement
            })
          ).pipe(Effect.provideService(Database, { store: context }));
          test
            .expect((yield* sources.sourceDocument(source.id)).document)
            .toStrictEqual(replacement);
          test.expect((yield* sources.document(documentKey)).document).toStrictEqual(document);
          test.assert.strictEqual(search('firstword', 1n).length, 0);
          test.assert.strictEqual(search('secondword', 1n).length, 1);
          context.db.orm.run(sql`UPDATE sources SET project_id = 2 WHERE id = ${source.id}`);
          test.assert.strictEqual(search('secondword', 1n).length, 0);
          test.assert.strictEqual(search('secondword', 2n).length, 1);
          context.db.orm.run(sql`DELETE FROM projects WHERE id = 2`);
          test.assert.strictEqual(search('secondword', 2n).length, 0);
          test.assert.strictEqual(
            context.db.orm.all(sql`SELECT * FROM chunks_fts WHERE chunks_fts MATCH 'secondword'`)
              .length,
            1
          );
          test
            .expect((yield* sources.sourceDocument(source.id)).document)
            .toStrictEqual(replacement);
          const unassigned = yield* sources.createSource({
            name: 'unassigned.txt',
            bytes: new Uint8Array([1]),
            projectId: null
          });
          const unassignedState = yield* sources.sourceProcessing(unassigned.id);

          yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: unassigned.id,
              expectedRevision: 1,
              requestId: unassignedState.requestId!,
              document
            })
          ).pipe(Effect.provideService(Database, { store: context }));
          test
            .expect((yield* sources.sourceDocument(unassigned.id)).document)
            .toStrictEqual(document);
          test.assert.strictEqual(
            context.db.orm.all(sql`SELECT * FROM chunks_fts WHERE chunks_fts MATCH 'firstword'`)
              .length,
            2
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'deleting a pending source fences publication and removes indexed content',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Sources.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
    const { Activity, Workflow, WorkflowEngine } = await import('effect/workflow');
    const { Schema } = await import('effect');
    const { withPublicationGuard } = await import('#server/platform/workflows/publication');
    const { workflowEngineLayer } = await import('#server/platform/workflows/engine');
    const document = {
      blocks: [plainBlock('paragraph' as const, 'fencedword', { type: 'page' as const, page: 1 })],
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

    try {
      function* verifyDeletedSourceFencing() {
        const sources = yield* Sources;
        const source = yield* createUnregisteredSource({
          name: 'test.txt',
          bytes: new Uint8Array([1]),
          projectId: null
        });
        const state = yield* sources.sourceProcessing(source.id);
        const event = {
          type: 'SourceProcessingRequested' as const,
          sourceId: source.id,
          inputVersion: 1,
          requestId: state.requestId!,
          eventId: 'event',
          causationId: null,
          correlationId: 'correlation',
          depth: 0
        };
        const workflow = Workflow.make('source-delete-test', {
          payload: { id: Schema.String },
          idempotencyKey: ({ id }) => id
        });
        const engine = yield* WorkflowEngine.WorkflowEngine;

        function runWorkflow() {
          return Effect.gen(function* () {
            yield* Activity.make({
              name: 'publish',
              execute: withPublicationGuard(
                context,
                sources.publishSourceDocument({ event, document })
              ).pipe(Effect.orDie)
            });
            const pending = yield* sources.requestSourceProcessing({
              id: source.id,
              expectedRevision: 1
            });

            test.assert.strictEqual(yield* sources.deleteSource({ id: source.id }), true);
            test.assert.strictEqual(yield* sources.deleteSource({ id: source.id }), false);
            yield* Activity.make({
              name: 'publish-deleted',
              execute: withPublicationGuard(
                context,
                Effect.gen(function* () {
                  test.assert.ok(
                    (yield* Effect.flip(
                      sources.publishSourceDocument({
                        event: { ...event, requestId: pending.requestId! },
                        document
                      })
                    )).kind === 'not_found'
                  );
                })
              ).pipe(Effect.orDie)
            });
          }).pipe(Effect.orDie);
        }

        yield* engine.register(workflow, runWorkflow);
        yield* withTestAdmission(
          context,
          workflow,
          'source-delete-test',
          { id: 'one' },
          engine.execute(workflow, {
            executionId: 'source-delete-test',
            payload: { id: 'one' }
          })
        );
        test.assert.strictEqual(
          context.db.orm.all(sql`SELECT * FROM chunks_fts WHERE chunks_fts MATCH 'fencedword'`)
            .length,
          0
        );

        for (const table of [
          'sources',
          'source_blobs',
          'source_snapshots',
          'source_processing',
          'content_snapshots',
          'blocks',
          'chunks'
        ]) {
          test.assert.strictEqual(context.db.orm.all(sql.raw(`SELECT * FROM ${table}`)).length, 0);
        }
      }

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(verifyDeletedSourceFencing).pipe(
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

test.stable(
  'uploads remain Sources and only an explicit authored copy pins source history, even when archived',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Layer.mergeAll(Sources.layer, Pages.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      context.db.orm.run(
        sql`INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'Project',1,1)`
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const documents = yield* Pages;
          const source = yield* sources.createSource({
            name: 'test.txt',
            bytes: new TextEncoder().encode('Evidence'),
            projectId: projectIdSchema.make(1n)
          });

          test.assert.strictEqual(
            context.db.orm.get<{ n: bigint }>(sql`SELECT count(*) n FROM materials`)!.n,
            0n
          );
          test.assert.strictEqual(
            context.db.orm.get<{ n: bigint }>(sql`SELECT count(*) n FROM pages`)!.n,
            0n
          );
          const state = yield* sources.sourceProcessing(source.id);
          const published = yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: source.id,
              expectedRevision: state.revision,
              requestId: state.requestId!,
              document: {
                ...deletionDocument('Evidence'),
                blocks: [plainBlock('paragraph', 'Evidence', { type: 'paragraph', index: 1 })]
              }
            })
          );
          const copy = yield* documents.copySource({
            createKey: 'editable-source-copy',
            title: 'Editable copy',
            sourceId: source.id,
            revision: 1n,
            snapshotId: published.documentId
          });

          yield* documents.archive({ id: copy.id, archived: true });
          test.assert.ok(
            (yield* Effect.flip(sources.deleteSource({ id: source.id }))).kind === 'invalid_input'
          );
          test.assert.strictEqual((yield* sources.source(source.id)).id, source.id);
          test.assert.ok(
            (yield* sources.setSourceProject({ id: source.id, projectId: null })).projectId === null
          );
          test.assert.strictEqual(
            context.db.orm.get<{ n: bigint }>(sql`SELECT count(*) n FROM materials`)!.n,
            0n
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'source export returns the stored bytes and canonical link URI',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Sources.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const bytes = new TextEncoder().encode('original');
          const source = yield* sources.createSource({
            name: 'original.txt',
            bytes,
            projectId: null
          });
          const exported = yield* sources.sourceExport(source.id);

          test.expect(exported).toStrictEqual({ source, bytes });
          const link = yield* sources.addLink({ url: 'https://example.com/path', projectId: null });
          const exportedLink = yield* sources.sourceExport(link.id);

          test.assert.ok(exportedLink.source.uri === 'https://example.com/path');
          test.assert.strictEqual(new TextDecoder().decode(exportedLink.bytes), link.uri);
          test.assert.ok(
            (yield* Effect.flip(sources.sourceExport(99999n as SourceId))).kind === 'not_found'
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'correction compares the current document and fences previous requests',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Sources.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
    const document = {
      blocks: [plainBlock('paragraph' as const, 'before', { type: 'page' as const, page: 1 })],
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

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const source = yield* sources.createSource({
            name: 'a.txt',
            bytes: new Uint8Array([1]),
            projectId: null
          });
          const state = yield* sources.sourceProcessing(source.id);
          const published = yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: source.id,
              expectedRevision: 1,
              requestId: state.requestId!,
              document
            })
          ).pipe(Effect.provideService(Database, { store: context }));
          const input = {
            id: source.id,
            documentId: published.documentId,
            ordinal: 0,
            before: 'before',
            after: 'after'
          };

          test.assert.ok(
            (yield* Effect.flip(sources.correctBlock({ ...input, before: 'wrong' }))).kind ===
              'invalid_input'
          );
          const next = yield* sources.correctBlock(input);

          test.assert.notStrictEqual(next.requestId, state.requestId);
          test.assert.strictEqual(next.documentId, published.documentId);
          test.expect((yield* sources.sourceDocument(source.id)).document).toStrictEqual(document);
          test.assert.ok(
            (yield* Effect.flip(
              transaction((tx) =>
                tx.store(SourceStore).publishSourceDocument({
                  id: source.id,
                  expectedRevision: 1,
                  requestId: state.requestId!,
                  document
                })
              ).pipe(Effect.provideService(Database, { store: context }))
            )).kind === 'invalid_input'
          );
          test.assert.strictEqual(
            context.db.orm.all(
              sql`SELECT * FROM workflow_events WHERE type = 'SourceCorrectionRequested'`
            ).length,
            1
          );
          const replacement = yield* sources.replaceSource({
            id: source.id,
            expectedRevision: 1,
            name: 'replacement.txt',
            bytes: new TextEncoder().encode('new input')
          });

          test.assert.ok(
            (yield* Effect.flip(sources.correctBlock(input))).kind === 'invalid_input'
          );
          test.assert.strictEqual(
            (yield* sources.sourceProcessing(source.id)).requestId,
            replacement.requestId
          );
          test.assert.strictEqual(
            context.db.orm.all(
              sql`SELECT * FROM workflow_events WHERE type = 'SourceCorrectionRequested'`
            ).length,
            1
          );
          yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: source.id,
              expectedRevision: 2,
              requestId: replacement.requestId!,
              document: {
                ...document,
                blocks: [correctBlockText(document.blocks[0]!, 'new input')]
              }
            })
          ).pipe(Effect.provideService(Database, { store: context }));
          test.assert.ok(
            (yield* sources.sourceDocument(source.id)).document.blocks[0]?.text === 'new input'
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'assigning a ready unowned source emits an index event without reprocessing',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Sources.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      context.db.orm.run(
        sql`INSERT INTO projects (id, name, created_at, updated_at) VALUES (1, 'One', 1, 1)`
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const source = yield* sources.createSource({
            name: 'a.txt',
            bytes: new Uint8Array([1]),
            projectId: null
          });
          const state = yield* sources.sourceProcessing(source.id);
          const document = {
            blocks: [plainBlock('paragraph' as const, 'hello', { type: 'page' as const, page: 1 })],
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
          const published = yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: source.id,
              expectedRevision: 1,
              requestId: state.requestId!,
              document
            })
          ).pipe(Effect.provideService(Database, { store: context }));
          const assigned = yield* sources.setSourceProject({
            id: source.id,
            projectId: 1n as ProjectId
          });

          test.assert.strictEqual(assigned.projectId, 1n);
          test.assert.strictEqual(
            (yield* sources.sourceProcessing(source.id)).documentId,
            published.documentId
          );
          yield* sources.setSourceProject({ id: source.id, projectId: 1n as ProjectId });
          test.assert.strictEqual(
            context.db.orm.all(sql`SELECT * FROM workflow_events WHERE type = 'SourceIndexed'`)
              .length,
            1
          );
          test.assert.ok(
            (yield* Effect.flip(
              sources.setSourceProject({ id: source.id, projectId: 999n as ProjectId })
            )).kind === 'not_found'
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable('correction request rolls back when outbox insertion fails', async ({ databases }) => {
  const location = await databases();
  const context = new ServerContext(await location.open());
  const layer = Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sources = yield* Sources;
        const source = yield* sources.createSource({
          name: 'a.txt',
          bytes: new Uint8Array([1]),
          projectId: null
        });
        const state = yield* sources.sourceProcessing(source.id);
        const document = {
          blocks: [plainBlock('paragraph' as const, 'before', { type: 'page' as const, page: 1 })],
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
        const old = yield* transaction((tx) =>
          tx.store(SourceStore).publishSourceDocument({
            id: source.id,
            expectedRevision: 1,
            requestId: state.requestId!,
            document
          })
        ).pipe(Effect.provideService(Database, { store: context }));

        context.db.orm.run(
          sql`CREATE TRIGGER reject_correction BEFORE INSERT ON workflow_events WHEN NEW.type = 'SourceCorrectionRequested' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
        );
        yield* Effect.flip(
          sources.correctBlock({
            id: source.id,
            documentId: old.documentId,
            ordinal: 0,
            before: 'before',
            after: 'after'
          })
        );
        test.expect(yield* sources.sourceProcessing(source.id)).toStrictEqual({
          ...state,
          documentId: old.documentId
        });
        test.assert.strictEqual(
          context.db.orm.all(
            sql`SELECT * FROM workflow_events WHERE type = 'SourceCorrectionRequested'`
          ).length,
          0
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

test.stable(
  'project reassignment preserves an explicit message attachment',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Sources.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      context.db.orm.run(
        sql`INSERT INTO projects (id, name, created_at, updated_at) VALUES (1, 'One', 1, 1), (2, 'Two', 1, 1)`
      );
      context.db.orm.run(
        sql`INSERT INTO notes (id,title,title_source,created_at,updated_at) VALUES (1, 'Note', 'user', 1, 1)`
      );
      context.db.orm.run(
        sql`INSERT INTO messages (id, note_id, role, created_at) VALUES (1, 1, 'user', 1)`
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const source = yield* sources.createSource({
            name: 'a.txt',
            bytes: new Uint8Array([1]),
            projectId: 1n as ProjectId
          });

          context.db.orm.run(
            sql`INSERT INTO message_parts (message_id, ordinal, source_id, source_name, source_kind) VALUES (1, 0, ${source.id}, 'a.txt', 'text')`
          );
          yield* sources.setSourceProject({ id: source.id, projectId: 2n as ProjectId });
          test.assert.strictEqual((yield* sources.source(source.id)).projectId, 2n);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'exact source extractions and note links never substitute a pending revision or author a document',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Sources.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const source = yield* sources.createSource({
            name: 'exact.txt',
            bytes: new TextEncoder().encode('old'),
            projectId: null
          });
          const state = yield* sources.sourceProcessing(source.id);
          const published = yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: source.id,
              expectedRevision: 1,
              requestId: state.requestId!,
              document: {
                blocks: [
                  plainBlock('paragraph', 'Exact old extraction', { type: 'paragraph', index: 1 })
                ],
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
              }
            })
          );
          const exact = { sourceId: source.id, revision: 1n, snapshotId: published.documentId };

          test.assert.ok(
            (yield* sources.extraction(exact)).document.blocks[0].text === 'Exact old extraction'
          );
          test.assert.strictEqual(
            (yield* sources.currentExtraction({ id: source.id }))?.snapshotId,
            published.documentId
          );
          const note = context.db.orm.get<{ id: bigint }>(
            sql`INSERT INTO notes(title,title_source,created_at,updated_at) VALUES('Note','user',1,1) RETURNING id`
          )!;

          yield* sources.attachSource({
            noteId: note.id as NoteId,
            sourceId: source.id
          });
          yield* sources.attachSource({
            noteId: note.id as NoteId,
            sourceId: source.id
          });
          test.assert.strictEqual(
            (yield* sources.noteSources({
              noteId: note.id as NoteId,
              limit: 100
            })).length,
            1
          );
          yield* sources.replaceSource({
            id: source.id,
            expectedRevision: 1,
            name: 'exact.txt',
            bytes: new TextEncoder().encode('new')
          });
          test.assert.ok(
            new TextDecoder().decode(
              (yield* sources.exportRevision({ sourceId: source.id, revision: 1n })).bytes
            ) === 'old'
          );
          test.assert.ok(
            new TextDecoder().decode(
              (yield* sources.exportRevision({ sourceId: source.id, revision: 2n })).bytes
            ) === 'new'
          );
          const history = yield* sources.extractions({ sourceId: source.id, limit: 1 });

          test
            .expect(history.items.map((item) => [item.revision, item.snapshotId]))
            .toStrictEqual([[1n, published.documentId]]);
          test.assert.ok(history.next === null);
          test.assert.ok(
            (yield* Effect.flip(sources.exportRevision({ sourceId: source.id, revision: 999n })))
              .kind === 'not_found'
          );
          const links = yield* sources.noteSources({
            noteId: note.id as NoteId,
            limit: 100
          });

          test.assert.strictEqual(links[0].revision, 2n);
          test.assert.ok(links[0].pending === true);
          test.assert.ok(links[0].snapshotId === null);
          test.assert.strictEqual(yield* sources.currentExtraction({ id: source.id }), null);
          test.assert.ok(
            (yield* sources.extraction(exact)).document.blocks[0].text === 'Exact old extraction'
          );
          test.assert.ok(
            (yield* Effect.flip(sources.extraction({ ...exact, revision: 2n }))).kind ===
              'not_found'
          );
          test
            .expect(context.db.orm.get<{ n: number }>(sql`SELECT count(*) n FROM pages`)!.n)
            .toBe(0n);
          yield* sources.detachSource({
            noteId: note.id as NoteId,
            sourceId: source.id
          });
          test
            .expect(
              yield* sources.noteSources({
                noteId: note.id as NoteId,
                limit: 100
              })
            )
            .toStrictEqual([]);
          test.assert.strictEqual(
            (yield* sources.extraction(exact)).snapshotId,
            published.documentId
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
