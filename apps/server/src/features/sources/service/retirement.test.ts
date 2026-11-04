/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises source retirement behavior through real persistence boundaries.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies source deletion scrubs native captures before interrupting a retired provider │
 * │   execution.                                                                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { createBlock, plainBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Effect, Layer } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import { SourceStore } from '#server/features/sources/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { WorkflowControl } from '#server/platform/workflows/control';
import { withTestPublication } from '#testing/publication';

import { Sources } from './index.ts';

testStable(
  'source deletion scrubs native captures before interrupting a retired provider execution',
  async () => {
    const location = createTestDatabase(process.env.STUDY_FINAL_MIGRATIONS);
    const context = new ServerContext(location.open());
    const cancelled: string[] = [];
    const layer = Sources.layer.pipe(
      Layer.provideMerge(
        Layer.merge(
          Layer.succeed(Database, { store: context }),
          Layer.succeed(WorkflowControl, {
            cancel: ({ id }) =>
              Effect.sync(() => {
                assert.equal(context.db.orm.get(sql`SELECT count(*) n FROM sources`)?.n, 0n);
                assert.equal(
                  context.db.orm.get(
                    sql`SELECT payload FROM workflow_executions WHERE execution_id=${id}`
                  )?.payload,
                  '{}'
                );
                cancelled.push(id);
              })
          })
        )
      )
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const source = yield* sources.createSource({
            name: 'private.txt',
            bytes: new TextEncoder().encode('Original private bytes'),
            projectId: null
          });
          const request = yield* sources.sourceProcessing(source.id);
          const event = JSON.parse(
            String(
              context.db.orm.get(
                sql`SELECT payload FROM workflow_events WHERE correlation_id=${request.requestId}`
              )?.payload
            )
          );

          context.db.orm
            .run(sql`INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,owner_token,created_at,updated_at)
        VALUES('source-run','SourceIngestionWorkflow',1,${JSON.stringify({ event })},'running','owner',1,1)`);
          context.db.exec(
            `INSERT INTO workflow_activities(execution_id,name,attempt,result) VALUES('source-run','decode',0,'{"private":"Original private bytes"}')`
          );
          assert.equal(yield* sources.deleteSource({ id: source.id }), true);
          assert.deepEqual(cancelled, ['source-run']);
          assert.equal(context.db.orm.get(sql`SELECT 1 FROM source_snapshots`), undefined);
          assert.equal(context.db.orm.get(sql`SELECT 1 FROM workflow_activities`), undefined);
          assert.equal(
            context.db.orm.get(
              sql`SELECT payload FROM workflow_events WHERE correlation_id=${request.requestId}`
            )?.payload,
            '{}'
          );
          assert.equal(
            context.db.orm.get(
              sql`SELECT status FROM workflow_executions WHERE execution_id='source-run'`
            )?.status,
            'cancelled'
          );
          assert.equal(
            context.db.orm.get(
              sql`SELECT correlation_id FROM workflow_retired_executions WHERE execution_id='source-run'`
            )?.correlation_id,
            request.requestId
          );
          assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'raw reply captures pin pending and ready source revisions until their session is deleted',
  async () => {
    const location = createTestDatabase(process.env.STUDY_FINAL_MIGRATIONS);
    const context = new ServerContext(location.open());
    const layer = Layer.merge(Sources.layer, Conversations.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const conversations = yield* Conversations;
          const source = yield* sources.createSource({
            name: 'input.txt',
            bytes: new TextEncoder().encode('Input body'),
            projectId: null
          });
          const processing = yield* sources.sourceProcessing(source.id);
          const session = yield* conversations.createSession({ title: 'Exact attachments' });

          yield* conversations.postMessage({
            sessionId: session.id,
            sourceIds: [source.id],
            text: 'Explain',
            requestReply: false
          });
          const request = yield* conversations.requestReply({ sessionId: session.id });

          assert.equal(
            (yield* Effect.flip(sources.deleteSource({ id: source.id }))).kind,
            'invalid_input'
          );
          assert.equal(
            context.db.orm.get(
              sql`SELECT snapshot_id FROM conversation_reply_sources WHERE request_id=${request.requestId}`
            )?.snapshot_id,
            null
          );
          const published = yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: source.id,
              expectedRevision: 1,
              requestId: processing.requestId!,
              document: {
                blocks: [
                  plainBlock('paragraph', 'Exact captured extraction', {
                    type: 'paragraph',
                    index: 1
                  })
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

          yield* withTestPublication(
            context,
            conversations.sealReplyAttachments({ requestId: request.requestId }).pipe(
              Effect.tap((sealed) => {
                assert.equal(sealed.messages[0].attachments[0].revision, 1n);
                assert.equal(sealed.messages[0].attachments[0].snapshotId, published.documentId);

                return Effect.void;
              })
            )
          );
          yield* sources.replaceSource({
            id: source.id,
            expectedRevision: 1,
            name: 'replacement.txt',
            bytes: new TextEncoder().encode('Replacement')
          });
          assert.equal(
            (yield* conversations.replySnapshot({ requestId: request.requestId })).messages[0]
              .attachments[0].snapshotId,
            published.documentId
          );
          assert.equal(
            (yield* Effect.flip(sources.deleteSource({ id: source.id }))).kind,
            'invalid_input'
          );
          assert.equal(context.db.orm.get(sql`SELECT count(*) n FROM study_documents`)?.n, 0n);
          yield* conversations.deleteSession(session.id);
          assert.equal(yield* sources.deleteSource({ id: source.id }), true);
          assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'source preview protects external authored images while allowing deletion of its own canonical image extraction',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Layer.merge(Sources.layer, Documents.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const documents = yield* Documents;
          const source = yield* sources.createSource({
            name: 'image.png',
            bytes: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
            projectId: null
          });
          const processing = yield* sources.sourceProcessing(source.id);
          const body = {
            blocks: [
              createBlock({ type: 'image', sourceId: source.id, revision: 1, alt: 'Original' })
            ],
            meta: {
              extractor: null,
              extractorVersion: 0,
              provider: null,
              durationMs: null,
              pageCount: null,
              refiners: [],
              waitingFor: [],
              corrected: false,
              omissions: []
            }
          };

          yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: source.id,
              expectedRevision: 1,
              requestId: processing.requestId!,
              document: body
            })
          );
          const own = yield* sources.previewDeletion({ id: source.id });

          assert.deepEqual(own.blockedBy, []);
          assert.equal(own.revisionCount, 1n);
          assert.equal(own.extractionCount, 1n);
          const authored = yield* documents.create({
            createKey: 'external-image',
            title: 'External image',
            document: {
              ...body,
              blocks: [
                createBlock({
                  type: 'image',
                  sourceId: source.id,
                  revision: 1,
                  alt: 'Authored copy'
                })
              ]
            },
            inputs: [],
            citations: []
          });

          assert.deepEqual((yield* sources.previewDeletion({ id: source.id })).blockedBy, [
            'image_assets'
          ]);
          assert.equal(
            (yield* Effect.flip(sources.deleteSource({ id: source.id }))).kind,
            'invalid_input'
          );
          const preview = yield* documents.previewDeletion({ id: authored.id });

          yield* documents.delete({ documentId: authored.id, token: preview.token });
          assert.deepEqual((yield* sources.previewDeletion({ id: source.id })).blockedBy, []);
          assert.equal(yield* sources.deleteSource({ id: source.id }), true);
          assert.equal(
            context.db.orm.get(sql`SELECT 1 FROM document_assets WHERE source_id=${source.id}`),
            undefined
          );
          assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
