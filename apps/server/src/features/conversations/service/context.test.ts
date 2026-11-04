/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises exact session context capture through native RPC and migrated SQLite.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks immutable historical inputs, bounded history and intent replay fences.          │
 * │ - Verifies selected image revisions and session-owned capture cleanup.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses public feature services and real persistence without replacing workflow ownership.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import type { chatMessageSchema } from '@study/contracts/conversations/schemas';
import type { StudyDocumentVersionId, SourceId } from '@study/contracts/ids';
import { studyDocumentVersionIdSchema } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { ConversationsRpcLive } from '#server/features/conversations/rpc/index';
import { Documents } from '#server/features/documents/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { SourceStore } from '#server/features/sources/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { withTestPublication } from '#testing/publication';

const content = (value: string) => ({
  blocks: [createBlock({ type: 'paragraph', inlines: [{ type: 'text', text: value, marks: [] }] })],
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
});

testStable(
  'native selection guards exact historic ranges, captures once and survives edits and reopen',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const services = () =>
      Layer.mergeAll(Conversations.layer, Documents.layer, Settings.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const handlers = () => ConversationsRpcLive.pipe(Layer.provideMerge(services()));

    try {
      const captured = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
            const documents = yield* Documents;
            const first = yield* client('conversations.createSession', { title: 'Quick' });
            const second = yield* client('conversations.createSession', { title: 'Other' });
            const body = content('before 😀 selected after');
            const material = yield* documents.create({
              createKey: randomUUID(),
              inputs: [],
              citations: [],
              title: 'Shared',
              sessionId: first.id,
              document: body
            });
            const documentId = material.version!.snapshotId;
            const range = {
              blockId: body.blocks[0]!.id,
              start: 10,
              end: 18
            };
            const target = {
              input: { kind: 'document' as const, versionId: material.version!.id },
              scope: { kind: 'ranges' as const, ranges: [range] }
            };

            yield* client('conversations.updateSessionSelection', {
              sessionId: first.id,
              expectedRevision: 0n,
              targets: [target]
            });
            assert.ok(
              (yield* Effect.flip(
                client('conversations.updateSessionSelection', {
                  sessionId: first.id,
                  expectedRevision: 0n,
                  targets: []
                })
              )).kind === 'invalid_input'
            );
            expect(
              (yield* client('conversations.sessionSelection', { sessionId: second.id })).targets
            ).toStrictEqual([]);
            const bad = {
              ...target,
              scope: { kind: 'ranges' as const, ranges: [{ ...range, start: 8 }] }
            };

            assert.ok(
              (yield* Effect.flip(
                client('conversations.updateSessionSelection', {
                  sessionId: second.id,
                  expectedRevision: 0n,
                  targets: [bad]
                })
              )).kind === 'invalid_input'
            );
            assert.ok(
              (yield* Effect.flip(
                client('conversations.updateSessionSelection', {
                  sessionId: second.id,
                  expectedRevision: 0n,
                  targets: [
                    {
                      ...target,
                      input: {
                        kind: 'document',
                        versionId: Schema.decodeUnknownSync(studyDocumentVersionIdSchema)(999n)
                      }
                    }
                  ]
                })
              )).kind === 'not_found'
            );
            const intent = {
              sessionId: first.id,
              intentKey: 'selection-only',
              instruction: 'Explain',
              preferences: { detail: 'brief' as const, language: 'english' as const }
            };
            const snapshot = yield* client('conversations.captureSessionContext', intent);

            assert.ok(snapshot.inputs[0]!.excerpts[0]!.text === body.blocks[0]!.text);
            expect(snapshot.messages).toStrictEqual([]);
            yield* client('conversations.updateSessionSelection', {
              sessionId: first.id,
              expectedRevision: 1n,
              targets: []
            });
            expect(yield* client('conversations.captureSessionContext', intent)).toStrictEqual(
              snapshot
            );
            expect(
              yield* client('conversations.captureSessionContext', {
                preferences: { language: 'english', detail: 'brief' },
                instruction: intent.instruction,
                intentKey: intent.intentKey,
                sessionId: intent.sessionId,
                threadRoot: undefined,
                throughMessageId: undefined
              })
            ).toStrictEqual(snapshot);
            assert.ok(
              (yield* Effect.flip(
                client('conversations.captureSessionContext', {
                  ...intent,
                  instruction: 'Changed'
                })
              )).kind === 'invalid_input'
            );
            assert.ok(
              (yield* Effect.flip(
                client('conversations.captureSessionContext', {
                  ...intent,
                  preferences: { detail: 'detailed' }
                })
              )).kind === 'invalid_input'
            );
            yield* client('conversations.updateSessionSelection', {
              sessionId: first.id,
              expectedRevision: 2n,
              targets: [target]
            });
            const message = yield* client('conversations.postMessage', {
              sessionId: first.id,
              text: 'Question'
            });
            const request = yield* client('conversations.requestReply', {
              sessionId: first.id,
              intentKey: 'reply',
              instruction: 'Use selected passage'
            });
            const before = yield* client('conversations.replySnapshot', {
              requestId: request.requestId
            });

            yield* documents.save({
              documentId: material.id,
              expectedVersionId: material.version!.id,
              key: randomUUID(),
              document: content('new content')
            });

            yield* client('conversations.editMessage', {
              messageId: message.id,
              text: 'Changed later'
            });
            yield* client('conversations.updateSessionSelection', {
              sessionId: first.id,
              expectedRevision: 3n,
              targets: []
            });
            expect(
              yield* client('conversations.replySnapshot', { requestId: request.requestId })
            ).toStrictEqual(before);
            expect(
              yield* client('conversations.requestReply', {
                sessionId: first.id,
                intentKey: 'reply',
                instruction: 'Use selected passage'
              })
            ).toStrictEqual(request);
            const conversations = yield* Conversations;

            assert.ok(
              (yield* Effect.flip(
                withTestPublication(
                  context,
                  conversations
                    .publishReply({
                      requestId: request.requestId,
                      text: 'Outside [1]',
                      citations: [
                        {
                          marker: 1,
                          sourceId: null,
                          input: { kind: 'document' as const, versionId: material.version!.id },
                          selectedRange: {
                            blockId: range.blockId,
                            start: 0,
                            end: body.blocks[0]!.text.length
                          },
                          documentId,
                          blockOrdinal: 0,
                          quote: 'absent words'
                        }
                      ]
                    })
                    .pipe(Effect.asVoid)
                )
              )).kind === 'invalid_input'
            );
            const publication = {
              requestId: request.requestId,
              text: 'Inside [1] and [2]',
              citations: [
                {
                  marker: 1,
                  sourceId: null,
                  input: { kind: 'document' as const, versionId: material.version!.id },
                  selectedRange: {
                    blockId: range.blockId,
                    start: 0,
                    end: body.blocks[0]!.text.length
                  },
                  documentId,
                  blockOrdinal: 0,
                  quote: 'selected'
                },
                {
                  marker: 2,
                  sourceId: null,
                  input: { kind: 'document' as const, versionId: material.version!.id },
                  selectedRange: {
                    blockId: range.blockId,
                    start: 0,
                    end: body.blocks[0]!.text.length
                  },
                  documentId,
                  blockOrdinal: 0,
                  quote: 'selected'
                }
              ]
            };

            for (const selectedRange of [undefined, range, { ...range, start: range.start - 1 }])
              assert.ok(
                (yield* Effect.flip(
                  withTestPublication(
                    context,
                    conversations
                      .publishReply({
                        ...publication,
                        citations: publication.citations.map((citation) => ({
                          ...citation,
                          selectedRange
                        }))
                      })
                      .pipe(Effect.asVoid)
                  )
                )).kind === 'invalid_input'
              );

            for (let replay = 0; replay < 2; replay++)
              yield* withTestPublication(
                context,
                conversations.publishReply(publication).pipe(Effect.asVoid)
              );

            const answer = yield* client('conversations.message', { id: request.messageId });

            expect(answer.citations[0]!.input).toStrictEqual({
              kind: 'document',
              versionId: material.version!.id
            });
            assert.strictEqual(answer.citations[0]!.rangeStart, 0);
            assert.strictEqual(answer.citations[0]!.rangeEnd, body.blocks[0]!.text.length);
            assert.ok(answer.citations[0]!.origin === 'agent');
            assert.ok(answer.citations[0]!.precision === 'exact');
            const evidence = answer.citations[0]!.evidence;

            assert.ok(evidence?.availability === 'available');

            if (evidence?.availability === 'available') {
              assert.ok(evidence.precision === 'exact');
              assert.ok(evidence.excerpt === body.blocks[0]!.text);
              assert.strictEqual(evidence.snapshotId, documentId);
            }

            const thread = yield* client('conversations.thread', {
              sessionId: first.id,
              limit: 20
            });

            expect(
              thread.items.find((message) => message.id === answer.id)?.citations
            ).toStrictEqual(answer.citations);
            const edited = yield* client('conversations.editMessage', {
              messageId: request.messageId,
              text: 'Edited wording [2]'
            });

            expect(edited.citations).toStrictEqual([{ ...answer.citations[1]!, marker: 1 }]);
            assert.ok(edited.versions.at(-1)?.text === 'Edited wording [1]');
            expect(edited.citations[0]!.support).toStrictEqual({ state: 'unassessed' });
            assert.strictEqual(edited.citations[0]!.rangeStart, 0);
            assert.strictEqual(edited.citations[0]!.rangeEnd, body.blocks[0]!.text.length);
            yield* client('conversations.setActiveVersion', {
              messageId: request.messageId,
              versionId: answer.activeVersionId!
            });
            expect(
              (yield* client('conversations.message', { id: request.messageId })).citations
            ).toStrictEqual(answer.citations);
            yield* client('conversations.deleteMessage', { id: request.messageId });
            assert.ok(
              (yield* Effect.flip(
                client('conversations.requestReply', {
                  sessionId: first.id,
                  intentKey: 'reply',
                  instruction: 'Use selected passage'
                })
              )).kind === 'not_found'
            );
            const regenerated = yield* client('conversations.requestReply', {
              sessionId: first.id,
              intentKey: 'regenerated'
            });

            assert.notStrictEqual(regenerated.requestId, request.requestId);
            const regeneratedSnapshot = yield* client('conversations.replySnapshot', {
              requestId: regenerated.requestId
            });

            assert.ok(regeneratedSnapshot.messages[0]!.text === 'Changed later');
            assert.strictEqual(
              regeneratedSnapshot.context!.inputs[0]!.excerpts[0]!.text,
              'new content'
            );

            return snapshot;
          }).pipe(Effect.provide(handlers()))
        )
      );

      context.close();
      context = new ServerContext(location.open());
      const reopened = await Effect.runPromise(
        Effect.flatMap(Conversations, (c) =>
          c.sessionContext({ requestId: captured.requestId })
        ).pipe(Effect.provide(services()))
      );

      expect(reopened).toStrictEqual(captured);
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'reply outbox rejection rolls back the logical context and retry uses original message versions',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Conversations.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const session = yield* conversations.createSession({ title: 'Rollback' });

          yield* conversations.postMessage({ sessionId: session.id, text: 'Original' });
          context.db.orm.run(
            sql`CREATE TRIGGER reject_context_event BEFORE INSERT ON workflow_events BEGIN SELECT RAISE(ABORT, 'rejected'); END`
          );
          yield* Effect.flip(
            conversations.requestReply({ sessionId: session.id, intentKey: 'retry' })
          );
          assert.strictEqual(context.db.orm.select().from(s.session_run_contexts).all().length, 0);
          assert.strictEqual(
            context.db.orm.select().from(s.conversation_reply_requests).all().length,
            0
          );
          context.db.orm.run(sql`DROP TRIGGER reject_context_event`);
          const request = yield* conversations.requestReply({
            sessionId: session.id,
            intentKey: 'retry'
          });

          assert.ok(
            (yield* conversations.sessionContext(request)).messages[0]!.text === 'Original'
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'active membership controls capture independently of selection and all notes are retained',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Layer.mergeAll(Conversations.layer, Documents.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const documents = yield* Documents;
          const first = yield* conversations.createSession({ title: 'One' });
          const second = yield* conversations.createSession({ title: 'Two' });

          assert.ok(
            (yield* Effect.flip(
              conversations.captureSessionContext({
                sessionId: first.id,
                intentKey: 'empty',
                instruction: '',
                preferences: {}
              })
            )).kind === 'invalid_input'
          );
          const a = yield* documents.create({
            createKey: randomUUID(),
            inputs: [],
            citations: [],
            title: 'A',
            sessionId: first.id,
            document: content('Alpha')
          });
          const b = yield* documents.create({
            createKey: randomUUID(),
            inputs: [],
            citations: [],
            title: 'B',
            document: content('Beta')
          });

          expect(
            (yield* conversations.sessionSelection({ sessionId: first.id })).targets
          ).toStrictEqual([]);
          yield* documents.detach({ sessionId: first.id, documentId: a.id });
          yield* documents.attach({ sessionId: first.id, documentId: b.id });
          const targets = [a, b].map((item) => ({
            input: { kind: 'document' as const, versionId: item.version!.id },
            scope: { kind: 'document' as const }
          }));

          yield* conversations.updateSessionSelection({
            sessionId: first.id,
            expectedRevision: 0n,
            targets
          });
          yield* conversations.updateSessionSelection({
            sessionId: second.id,
            expectedRevision: 0n,
            targets: [targets[0]!]
          });
          yield* conversations.updateSessionSelection({
            sessionId: first.id,
            expectedRevision: 1n,
            targets: targets.toReversed()
          });
          const ordered = yield* conversations.captureSessionContext({
            sessionId: first.id,
            intentKey: 'ordered',
            instruction: '',
            preferences: {}
          });

          expect(ordered.inputs.map((item) => item.input)).toStrictEqual([
            { kind: 'document', versionId: b.version!.id }
          ]);
          assert.strictEqual(
            (yield* conversations.sessionSelection({ sessionId: second.id })).targets.length,
            1
          );
          const draftOwner = yield* documents.create({
            createKey: randomUUID(),
            inputs: [],
            citations: [],
            title: 'Draft',
            document: content('Unpublished')
          });

          yield* documents.save({
            documentId: draftOwner.id,
            expectedVersionId: draftOwner.version!.id,
            key: randomUUID(),
            document: content('Published replacement')
          });
          const draft = yield* documents.save({
            documentId: draftOwner.id,
            expectedVersionId: draftOwner.version!.id,
            key: randomUUID(),
            document: content('Retained alternative')
          });

          assert.ok(
            (yield* Effect.flip(
              conversations.updateSessionSelection({
                sessionId: second.id,
                expectedRevision: 1n,
                targets: [
                  {
                    input: { kind: 'document', versionId: draft.submittedVersionId },
                    scope: { kind: 'document' }
                  }
                ]
              })
            )).kind === 'invalid_input'
          );
          assert.ok(
            (yield* Effect.flip(
              conversations.updateSessionSelection({
                sessionId: second.id,
                expectedRevision: 1n,
                targets: [targets[0]!, targets[0]!]
              })
            )).kind === 'invalid_input'
          );

          for (let i = 0; i < 55; i++)
            yield* conversations.postMessage({ sessionId: first.id, text: 'Message ' + i });

          const history = yield* conversations.captureSessionContext({
            sessionId: first.id,
            intentKey: 'bounded',
            instruction: '',
            preferences: {}
          });

          assert.throws(() =>
            context.db.orm
              .update(s.session_run_contexts)
              .set({ snapshot: '{}' })
              .where(eq(s.session_run_contexts.request_id, history.requestId))
              .run()
          );
          assert.strictEqual(history.messages.length, 55);
          assert.strictEqual(history.excludedMessages, 0);
          assert.ok(history.messages[0]!.text === 'Message 0');
          yield* conversations.deleteMessage(history.messages[0]!.messageId);
          expect(
            yield* conversations.inspectSessionContext({ requestId: history.requestId })
          ).toStrictEqual(history);
          assert.ok(
            (yield* Effect.flip(conversations.sessionContext({ requestId: history.requestId })))
              .kind === 'not_found'
          );
          assert.ok(
            (yield* Effect.flip(
              conversations.captureSessionContext({
                sessionId: first.id,
                intentKey: 'bounded',
                instruction: '',
                preferences: {}
              })
            )).kind === 'not_found'
          );
          assert.ok(
            (yield* conversations.sessionContext({ requestId: ordered.requestId })).inputs[0]!
              .excerpts[0]!.text === 'Beta'
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'active image documents retain whole bodies and exact asset revisions despite manual range selection',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const services = () =>
      Layer.mergeAll(Conversations.layer, Documents.layer, Sources.layer, Settings.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const handlers = () => ConversationsRpcLive.pipe(Layer.provideMerge(services()));
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
            const documents = yield* Documents;
            const sources = yield* Sources;
            const session = yield* client('conversations.createSession', {
              title: 'Selected image'
            });
            const image = yield* sources.createSource({
              projectId: null,
              name: 'figure.png',
              bytes
            });
            const block = createBlock({
              type: 'image',
              sourceId: image.id,
              revision: 1,
              alt: 'Selected figure caption'
            });
            const material = yield* documents.create({
              createKey: randomUUID(),
              inputs: [],
              citations: [],
              title: 'Illustrated document',
              sessionId: session.id,

              document: {
                ...content('Hidden surrounding text'),
                blocks: [content('Hidden surrounding text').blocks[0]!, block]
              }
            });

            yield* client('conversations.updateSessionSelection', {
              sessionId: session.id,
              expectedRevision: 0n,
              targets: [
                {
                  input: { kind: 'document', versionId: material.version!.id },
                  scope: { kind: 'blocks', blockIds: [block.id] }
                }
              ]
            });
            const intent = {
              sessionId: session.id,
              intentKey: 'image',
              instruction: 'Explain this figure',
              preferences: {}
            };
            const snapshot = yield* client('conversations.captureSessionContext', intent);
            const input = snapshot.inputs[0]!;

            assert.ok(input.document);
            assert.strictEqual(input.excerpts.length, 2);
            assert.strictEqual(input.excerpts[1]!.blockOrdinal, 1);
            expect(input.excerpts[1]!.content).toStrictEqual(block.content);
            assert.ok(input.excerpts[1]!.text === 'Selected figure caption');
            yield* client('conversations.updateSessionSelection', {
              sessionId: session.id,
              expectedRevision: 1n,
              targets: [
                {
                  input: { kind: 'document', versionId: material.version!.id },
                  scope: {
                    kind: 'ranges',
                    ranges: [
                      {
                        blockId: block.id,
                        start: 0,
                        end: 8
                      }
                    ]
                  }
                }
              ]
            });
            const range = yield* client('conversations.captureSessionContext', {
              ...intent,
              intentKey: 'alt-text-only'
            });

            expect(range.inputs).toStrictEqual(snapshot.inputs);
            yield* sources.replaceSource({
              id: image.id,
              expectedRevision: 1,
              name: 'figure.png',
              bytes: new Uint8Array([...bytes, 0])
            });
            yield* documents.save({
              documentId: material.id,
              expectedVersionId: material.version!.id,
              key: randomUUID(),

              document: {
                ...content('New surrounding text'),
                blocks: [
                  createBlock(
                    { type: 'image', sourceId: image.id, revision: 2, alt: 'Replacement caption' },
                    block.anchor,
                    block.id
                  )
                ]
              }
            });

            expect(yield* client('conversations.captureSessionContext', intent)).toStrictEqual(
              snapshot
            );
            expect(
              (yield* sources.sourceSnapshot({ id: image.id, revision: 1 })).bytes
            ).toStrictEqual(bytes);

            return { snapshot, range, material, session, image };
          }).pipe(Effect.provide(handlers()))
        )
      );

      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const documents = yield* Documents;
          const sources = yield* Sources;

          expect(
            yield* conversations.sessionContext({ requestId: saved.snapshot.requestId })
          ).toStrictEqual(saved.snapshot);
          expect(
            yield* conversations.sessionContext({ requestId: saved.range.requestId })
          ).toStrictEqual(saved.range);
          yield* conversations.deleteSession(saved.session.id);
          assert.ok(
            (yield* Effect.flip(
              conversations.inspectSessionContext({
                requestId: saved.snapshot.requestId
              })
            )).kind === 'not_found'
          );
          assert.strictEqual(
            (yield* documents.document({ id: saved.material.id })).id,
            saved.material.id
          );
          expect(
            (yield* sources.sourceSnapshot({ id: saved.image.id, revision: 1 })).bytes
          ).toStrictEqual(bytes);
        }).pipe(Effect.provide(services()))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

function assertRetainedCitationShapes(
  read: typeof chatMessageSchema.Type,
  anchor: Extract<(typeof chatMessageSchema.Type.citations)[number]['anchor'], { type: 'text' }>,
  versionId: StudyDocumentVersionId,
  _latestVersionId: StudyDocumentVersionId,
  draftVersionId: StudyDocumentVersionId,
  sourceId: SourceId
) {
  const [incomplete, mismatch, unpublished, attachment] = read.citations;

  for (const citation of read.citations) {
    assert.ok(citation.precision === 'unavailable');
    expect(citation.evidence).toStrictEqual({
      availability: 'unavailable',
      precision: 'unavailable',
      reason: 'captured_input_unavailable'
    });
    expect(citation.anchor).toStrictEqual(anchor);
  }

  expect(incomplete!.input).toStrictEqual({ kind: 'document', versionId });
  assert.ok(incomplete!.documentId === null);
  expect(mismatch!.input).toStrictEqual({ kind: 'document', versionId });
  expect(unpublished!.input).toStrictEqual({ kind: 'document', versionId: draftVersionId });
  assert.strictEqual(attachment!.sourceId, sourceId);
  assert.ok(attachment!.quote === 'Retained attachment');
}

testStable(
  'retained legacy and attachment citations keep bounded precision; wrong exact identities never use latest content',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const handlers = () =>
      ConversationsRpcLive.pipe(
        Layer.provideMerge(
          Layer.mergeAll(Conversations.layer, Documents.layer, Sources.layer, Settings.layer)
        ),
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );

    try {
      const retained = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
            const documents = yield* Documents;
            const session = yield* rpc('conversations.createSession', { title: 'Historic shapes' });
            const body = content('Same words in distinct documents');
            const material = yield* documents.create({
              createKey: randomUUID(),
              inputs: [],
              citations: [],
              title: 'Published',
              document: body
            });
            const latestOutcome = yield* documents.save({
              documentId: material.id,
              expectedVersionId: material.version!.id,
              key: randomUUID(),
              document: content(body.blocks[0]!.text)
            });
            const draftOutcome = yield* documents.save({
              documentId: material.id,
              expectedVersionId: material.version!.id,
              key: randomUUID(),
              document: body
            });
            const documentId = material.version!.snapshotId;
            const latest = yield* documents.version({ id: latestOutcome.submittedVersionId });
            const draft = yield* documents.version({ id: draftOutcome.submittedVersionId });
            const latestDocumentId = latest.snapshotId;
            const source = yield* (yield* Sources).createSource({
              projectId: null,
              name: 'attachment.txt',
              bytes: new TextEncoder().encode('Retained attachment')
            });
            const message = yield* rpc('conversations.postMessage', {
              sessionId: session.id,
              text: 'Legacy [1], mismatch [2], unpublished [3], attachment [4]'
            });
            const anchor = {
              type: 'text' as const,
              lineStart: 4,
              lineEnd: 4,
              start: 100,
              end: 140
            };
            const base = {
              version_id: message.activeVersionId!,
              source_id: null,
              authored_version_id: material.version!.id,
              document_id: null,
              block_id: null,
              range_start: null,
              range_end: null,
              source_name: 'Retained original name',
              anchor: JSON.stringify(anchor),
              quote: 'Same words'
            };

            // Seed retained legacy shapes; keep all foreign keys and permanent retention guards enabled.
            context.db.orm
              .insert(s.citations)
              .values([
                { ...base, marker: 1n },
                {
                  ...base,
                  marker: 2n,
                  document_id: latestDocumentId,
                  block_id: body.blocks[0]!.id,
                  range_start: 0n,
                  range_end: 10n
                },
                {
                  ...base,
                  marker: 3n,
                  authored_version_id: draft.id,
                  document_id: documentId,
                  block_id: body.blocks[0]!.id,
                  range_start: 0n,
                  range_end: 10n
                },
                {
                  ...base,
                  marker: 4n,
                  authored_version_id: null,
                  source_id: source.id,
                  quote: 'Retained attachment'
                }
              ])
              .run();
            const rows = context.db.orm.select().from(s.citations).all();
            const read = yield* rpc('conversations.message', { id: message.id });

            assertRetainedCitationShapes(
              read,
              anchor,
              material.version!.id,
              latest.id,
              draft.id,
              source.id
            );

            expect(
              (yield* rpc('conversations.thread', { sessionId: session.id, limit: 10 })).items[0]!
                .citations
            ).toStrictEqual(read.citations);
            const edited = yield* rpc('conversations.editMessage', {
              messageId: message.id,
              text: 'Reordered [4] [2] [1] [3]'
            });

            expect(edited.citations).toStrictEqual(read.citations);
            const exactVersion = yield* rpc('conversations.messageVersionCitations', {
              sessionId: session.id,
              messageId: message.id,
              versionId: message.activeVersionId!
            });

            expect(exactVersion.citations).toStrictEqual(read.citations);
            expect(
              (yield* rpc('conversations.setActiveVersion', {
                messageId: message.id,
                versionId: message.activeVersionId!
              })).citations
            ).toStrictEqual(read.citations);
            expect(
              context.db.orm
                .select()
                .from(s.citations)
                .where(eq(s.citations.version_id, message.activeVersionId!))
                .all()
            ).toStrictEqual(rows);

            return {
              id: message.id,
              sessionId: session.id,
              versionId: message.activeVersionId!,
              citations: read.citations
            };
          }).pipe(Effect.provide(handlers()))
        )
      );

      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });

            expect(
              (yield* rpc('conversations.message', { id: retained.id })).citations
            ).toStrictEqual(retained.citations);
            expect(
              (yield* rpc('conversations.messageVersionCitations', {
                sessionId: retained.sessionId,
                messageId: retained.id,
                versionId: retained.versionId
              })).citations
            ).toStrictEqual(retained.citations);
          }).pipe(Effect.provide(handlers()))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'native capture rejects foreign or deleted boundaries and preserves exact bounded replay',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const handlers = ConversationsRpcLive.pipe(
      Layer.provideMerge(
        Layer.mergeAll(Conversations.layer, Documents.layer, Settings.layer, Sources.layer).pipe(
          Layer.provideMerge(Layer.succeed(Database, { store: context }))
        )
      )
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
          const sources = yield* Sources;
          const session = yield* client('conversations.createSession', { title: 'Bounded' });
          const other = yield* client('conversations.createSession', { title: 'Other' });
          const first = yield* client('conversations.postMessage', {
            sessionId: session.id,
            text: 'First'
          });
          const deleted = yield* client('conversations.postMessage', {
            sessionId: session.id,
            text: 'Deleted'
          });

          yield* client('conversations.deleteMessage', { id: deleted.id });
          const foreign = yield* client('conversations.postMessage', {
            sessionId: other.id,
            text: 'Foreign'
          });
          const source = yield* sources.createSource({
            name: 'thread.txt',
            projectId: null,
            bytes: new TextEncoder().encode('Attachment')
          });
          const processing = yield* sources.sourceProcessing(source.id);

          yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: source.id,
              expectedRevision: 1,
              requestId: processing.requestId!,
              document: content('Attachment')
            })
          );
          const root = yield* client('conversations.postMessage', {
            sessionId: session.id,
            text: 'Root',
            sourceIds: [source.id]
          });
          const siblingRoot = yield* client('conversations.postMessage', {
            sessionId: session.id,
            text: 'Sibling',
            sourceIds: [source.id]
          });
          const threadRoot = root.parts[0]!.id;
          const sibling = yield* client('conversations.postMessage', {
            sessionId: session.id,
            threadRoot: siblingRoot.parts[0]!.id,
            text: 'Sibling child'
          });
          const child = yield* client('conversations.postMessage', {
            sessionId: session.id,
            threadRoot,
            text: 'Child'
          });
          const intent = {
            sessionId: session.id,
            intentKey: 'exact-boundary',
            throughMessageId: first.id,
            instruction: '',
            preferences: {}
          };

          for (const [index, scope] of [
            { throughMessageId: deleted.id },
            { throughMessageId: foreign.id },
            { throughMessageId: child.id },
            { threadRoot, throughMessageId: sibling.id },
            { threadRoot, throughMessageId: siblingRoot.id }
          ].entries()) {
            assert.ok(
              (yield* Effect.flip(
                client('conversations.captureSessionContext', {
                  ...intent,
                  ...scope,
                  intentKey: 'invalid-' + index
                })
              )).kind === 'invalid_input'
            );
          }

          assert.strictEqual(context.db.orm.select().from(s.session_run_contexts).all().length, 0);
          const captured = yield* client('conversations.captureSessionContext', intent);

          expect(captured.messages.map((message) => message.messageId)).toStrictEqual([first.id]);
          const rootOnly = yield* client('conversations.captureSessionContext', {
            ...intent,
            intentKey: 'root-only',
            threadRoot,
            throughMessageId: root.id
          });

          expect(rootOnly.messages.map((message) => message.messageId)).toStrictEqual([root.id]);
          const threaded = yield* client('conversations.captureSessionContext', {
            ...intent,
            intentKey: 'threaded',
            threadRoot,
            throughMessageId: child.id
          });

          expect(threaded.messages.map((message) => message.messageId)).toStrictEqual([
            root.id,
            child.id
          ]);
          yield* client('conversations.editMessage', {
            messageId: first.id,
            text: 'Changed afterwards'
          });
          yield* client('conversations.postMessage', { sessionId: session.id, text: 'Later' });
          expect(yield* client('conversations.captureSessionContext', intent)).toStrictEqual(
            captured
          );

          for (let index = 0; index < 3; index++)
            yield* client('conversations.postMessage', {
              sessionId: session.id,
              threadRoot,
              text: String(index).repeat(80000)
            });

          assert.strictEqual(
            (yield* Effect.flip(
              client('conversations.captureSessionContext', {
                sessionId: session.id,
                threadRoot,
                intentKey: 'oversized-thread',
                instruction: '',
                preferences: {}
              })
            )).kind,
            'not_enough'
          );
        }).pipe(Effect.scoped, Effect.provide(handlers))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
