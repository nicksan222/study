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

import assert from 'node:assert/strict';

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import type { chatMessageSchema } from '@study/contracts/conversations/schemas';
import type { DocumentId, MaterialVersionId, SourceId } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Conversations } from '#server/features/conversations/index';
import { ConversationsRpcLive } from '#server/features/conversations/rpc/index';
import { Materials } from '#server/features/materials/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { withTestPublication } from '#testing/publication';

const content = (value: string) => ({
  kind: 'document' as const,
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
      Layer.mergeAll(Conversations.layer, Materials.layer, Settings.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const handlers = () => ConversationsRpcLive.pipe(Layer.provideMerge(services()));

    try {
      const captured = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
            const materials = yield* Materials;
            const first = yield* client('conversations.createSession', { title: 'Quick' });
            const second = yield* client('conversations.createSession', { title: 'Other' });
            const body = content('before 😀 selected after');
            const material = yield* materials.create({
              title: 'Shared',
              content: body,
              publish: true
            });
            const documentId = context.db.orm
              .select()
              .from(s.material_document_versions)
              .where(eq(s.material_document_versions.version_id, material.version.id))
              .get()!.document_id;
            const range = {
              versionId: material.version.id,
              documentId,
              blockId: body.blocks[0]!.id,
              start: 10,
              end: 18
            };
            const target = {
              versionId: material.version.id,
              documentId,
              scope: { kind: 'ranges' as const, ranges: [range] }
            };

            yield* client('conversations.updateSessionSelection', {
              sessionId: first.id,
              expectedRevision: 0n,
              targets: [target]
            });
            assert.equal(
              (yield* Effect.flip(
                client('conversations.updateSessionSelection', {
                  sessionId: first.id,
                  expectedRevision: 0n,
                  targets: []
                })
              )).kind,
              'invalid_input'
            );
            assert.deepEqual(
              (yield* client('conversations.sessionSelection', { sessionId: second.id })).targets,
              []
            );
            const bad = {
              ...target,
              scope: { kind: 'ranges' as const, ranges: [{ ...range, start: 8 }] }
            };

            assert.equal(
              (yield* Effect.flip(
                client('conversations.updateSessionSelection', {
                  sessionId: second.id,
                  expectedRevision: 0n,
                  targets: [bad]
                })
              )).kind,
              'invalid_input'
            );
            assert.equal(
              (yield* Effect.flip(
                client('conversations.updateSessionSelection', {
                  sessionId: second.id,
                  expectedRevision: 0n,
                  targets: [{ ...target, documentId: 999n as DocumentId }]
                })
              )).kind,
              'invalid_input'
            );
            const intent = {
              sessionId: first.id,
              intentKey: 'selection-only',
              instruction: 'Explain',
              preferences: { detail: 'brief' as const, language: 'english' as const }
            };
            const snapshot = yield* client('conversations.captureSessionContext', intent);

            assert.equal(snapshot.inputs[0]!.excerpts[0]!.text, 'selected');
            assert.deepEqual(snapshot.messages, []);
            yield* materials.createVersion({
              materialId: material.id,
              content: content('new content'),
              publish: true
            });
            yield* client('conversations.updateSessionSelection', {
              sessionId: first.id,
              expectedRevision: 1n,
              targets: []
            });
            assert.deepEqual(
              yield* client('conversations.captureSessionContext', intent),
              snapshot
            );
            assert.deepEqual(
              yield* client('conversations.captureSessionContext', {
                preferences: { language: 'english', detail: 'brief' },
                instruction: intent.instruction,
                intentKey: intent.intentKey,
                sessionId: intent.sessionId,
                threadRoot: undefined,
                throughMessageId: undefined
              }),
              snapshot
            );
            assert.equal(
              (yield* Effect.flip(
                client('conversations.captureSessionContext', { ...intent, instruction: 'Changed' })
              )).kind,
              'invalid_input'
            );
            assert.equal(
              (yield* Effect.flip(
                client('conversations.captureSessionContext', {
                  ...intent,
                  preferences: { detail: 'detailed' }
                })
              )).kind,
              'invalid_input'
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

            yield* client('conversations.editMessage', {
              messageId: message.id,
              text: 'Changed later'
            });
            yield* client('conversations.updateSessionSelection', {
              sessionId: first.id,
              expectedRevision: 3n,
              targets: []
            });
            assert.deepEqual(
              yield* client('conversations.replySnapshot', { requestId: request.requestId }),
              before
            );
            assert.deepEqual(
              yield* client('conversations.requestReply', {
                sessionId: first.id,
                intentKey: 'reply',
                instruction: 'Use selected passage'
              }),
              request
            );
            const conversations = yield* Conversations;

            assert.equal(
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
                          materialVersionId: material.version.id,
                          selectedRange: range,
                          documentId,
                          blockOrdinal: 0,
                          quote: 'before'
                        }
                      ]
                    })
                    .pipe(Effect.asVoid)
                )
              )).kind,
              'invalid_input'
            );
            const publication = {
              requestId: request.requestId,
              text: 'Inside [1] and [2]',
              citations: [
                {
                  marker: 1,
                  sourceId: null,
                  materialVersionId: material.version.id,
                  selectedRange: range,
                  documentId,
                  blockOrdinal: 0,
                  quote: 'selected'
                },
                {
                  marker: 2,
                  sourceId: null,
                  materialVersionId: material.version.id,
                  selectedRange: range,
                  documentId,
                  blockOrdinal: 0,
                  quote: 'selected'
                }
              ]
            };

            for (const selectedRange of [undefined, { ...range, start: range.start - 1 }])
              assert.equal(
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
                )).kind,
                'invalid_input'
              );

            for (let replay = 0; replay < 2; replay++)
              yield* withTestPublication(
                context,
                conversations.publishReply(publication).pipe(Effect.asVoid)
              );

            const answer = yield* client('conversations.message', { id: request.messageId });

            assert.equal(answer.citations[0]!.materialVersionId, material.version.id);
            assert.equal(answer.citations[0]!.rangeStart, 10);
            assert.equal(answer.citations[0]!.rangeEnd, 18);
            assert.equal(answer.citations[0]!.origin, 'agent');
            assert.equal(answer.citations[0]!.precision, 'exact');
            assert.deepEqual(answer.citations[0]!.support, { state: 'unassessed' });
            const evidence = answer.citations[0]!.evidence;

            assert.equal(evidence?.availability, 'available');

            if (evidence?.availability === 'available') {
              assert.equal(evidence.precision, 'exact');
              assert.equal(evidence.excerpt, 'selected');
              assert.equal(evidence.revision.inputVersionId, material.version.id);
              assert.equal(evidence.revision.inputDocumentId, documentId);
              assert.equal(evidence.revision.state, 'stale');
              assert.notEqual(evidence.revision.currentVersionId, material.version.id);
            }

            const thread = yield* client('conversations.thread', {
              sessionId: first.id,
              limit: 20
            });

            assert.deepEqual(
              thread.items.find((message) => message.id === answer.id)?.citations,
              answer.citations
            );
            const edited = yield* client('conversations.editMessage', {
              messageId: request.messageId,
              text: 'Edited wording [2]'
            });

            assert.deepEqual(edited.citations, [{ ...answer.citations[1]!, marker: 1 }]);
            assert.equal(edited.versions.at(-1)?.text, 'Edited wording [1]');
            assert.deepEqual(edited.citations[0]!.support, { state: 'unassessed' });
            assert.equal(edited.citations[0]!.rangeStart, 10);
            assert.equal(edited.citations[0]!.rangeEnd, 18);
            yield* client('conversations.setActiveVersion', {
              messageId: request.messageId,
              versionId: answer.activeVersionId!
            });
            assert.deepEqual(
              (yield* client('conversations.message', { id: request.messageId })).citations,
              answer.citations
            );
            yield* client('conversations.deleteMessage', { id: request.messageId });
            assert.equal(
              (yield* Effect.flip(
                client('conversations.requestReply', {
                  sessionId: first.id,
                  intentKey: 'reply',
                  instruction: 'Use selected passage'
                })
              )).kind,
              'not_found'
            );
            const regenerated = yield* client('conversations.requestReply', {
              sessionId: first.id,
              intentKey: 'regenerated'
            });

            assert.notEqual(regenerated.requestId, request.requestId);
            const regeneratedSnapshot = yield* client('conversations.replySnapshot', {
              requestId: regenerated.requestId
            });

            assert.equal(regeneratedSnapshot.messages[0]!.text, 'Changed later');
            assert.deepEqual(regeneratedSnapshot.context!.inputs, []);

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

      assert.deepEqual(reopened, captured);
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
          assert.equal(context.db.orm.select().from(s.session_run_contexts).all().length, 0);
          assert.equal(context.db.orm.select().from(s.conversation_reply_requests).all().length, 0);
          context.db.orm.run(sql`DROP TRIGGER reject_context_event`);
          const request = yield* conversations.requestReply({
            sessionId: session.id,
            intentKey: 'retry'
          });

          assert.equal(
            (yield* conversations.sessionContext(request)).messages[0]!.text,
            'Original'
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
  'selection order is independent of membership and bounded history reports omitted messages',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Layer.mergeAll(Conversations.layer, Materials.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const materials = yield* Materials;
          const first = yield* conversations.createSession({ title: 'One' });
          const second = yield* conversations.createSession({ title: 'Two' });

          assert.equal(
            (yield* Effect.flip(
              conversations.captureSessionContext({
                sessionId: first.id,
                intentKey: 'empty',
                instruction: '',
                preferences: {}
              })
            )).kind,
            'invalid_input'
          );
          const a = yield* materials.create({
            title: 'A',
            sessionId: first.id,
            content: content('Alpha'),
            publish: true
          });
          const b = yield* materials.create({
            title: 'B',
            content: content('Beta'),
            publish: true
          });

          assert.deepEqual(
            (yield* conversations.sessionSelection({ sessionId: first.id })).targets,
            []
          );
          yield* materials.detach({ sessionId: first.id, materialId: a.id });
          const targets = [a, b].map((item) => ({
            versionId: item.version.id,
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

          assert.deepEqual(
            ordered.inputs.map((item) => item.versionId),
            [b.version.id, a.version.id]
          );
          assert.equal(
            (yield* conversations.sessionSelection({ sessionId: second.id })).targets.length,
            1
          );
          const draft = yield* materials.create({
            title: 'Draft',
            content: content('Unpublished'),
            publish: false
          });

          assert.equal(
            (yield* Effect.flip(
              conversations.updateSessionSelection({
                sessionId: second.id,
                expectedRevision: 1n,
                targets: [{ versionId: draft.version.id, scope: { kind: 'document' } }]
              })
            )).kind,
            'not_found'
          );
          assert.equal(
            (yield* Effect.flip(
              conversations.updateSessionSelection({
                sessionId: second.id,
                expectedRevision: 1n,
                targets: [targets[0]!, targets[0]!]
              })
            )).kind,
            'invalid_input'
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
          assert.equal(history.messages.length, 50);
          assert.equal(history.excludedMessages, 5);
          assert.equal(history.messages[0]!.text, 'Message 5');
          yield* conversations.deleteMessage(history.messages[0]!.messageId);
          assert.deepEqual(
            yield* conversations.inspectSessionContext({ requestId: history.requestId }),
            history
          );
          assert.equal(
            (yield* Effect.flip(conversations.sessionContext({ requestId: history.requestId })))
              .kind,
            'not_found'
          );
          assert.equal(
            (yield* Effect.flip(
              conversations.captureSessionContext({
                sessionId: first.id,
                intentKey: 'bounded',
                instruction: '',
                preferences: {}
              })
            )).kind,
            'not_found'
          );
          assert.equal(
            (yield* conversations.sessionContext({ requestId: ordered.requestId })).inputs[0]!
              .excerpts[0]!.text,
            'Beta'
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
  'selected image blocks retain exact asset revisions while ranges expose only selected alt text',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const services = () =>
      Layer.mergeAll(Conversations.layer, Materials.layer, Sources.layer, Settings.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const handlers = () => ConversationsRpcLive.pipe(Layer.provideMerge(services()));
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
            const materials = yield* Materials;
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
            const material = yield* materials.create({
              title: 'Illustrated document',
              publish: true,
              content: {
                ...content('Hidden surrounding text'),
                blocks: [content('Hidden surrounding text').blocks[0]!, block]
              }
            });

            yield* client('conversations.updateSessionSelection', {
              sessionId: session.id,
              expectedRevision: 0n,
              targets: [
                { versionId: material.version.id, scope: { kind: 'blocks', blockIds: [block.id] } }
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

            assert.equal(input.document, undefined);
            assert.equal(input.excerpts.length, 1);
            assert.equal(input.excerpts[0]!.blockOrdinal, 1);
            assert.deepEqual(input.excerpts[0]!.content, block.content);
            assert.equal(input.excerpts[0]!.text, 'Selected figure caption');
            yield* client('conversations.updateSessionSelection', {
              sessionId: session.id,
              expectedRevision: 1n,
              targets: [
                {
                  versionId: material.version.id,
                  documentId: input.documentId,
                  scope: {
                    kind: 'ranges',
                    ranges: [
                      {
                        versionId: material.version.id,
                        documentId: input.documentId,
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

            assert.equal(range.inputs[0]!.document, undefined);
            assert.equal(range.inputs[0]!.excerpts[0]!.text, 'Selected');
            assert.equal(range.inputs[0]!.excerpts[0]!.content, undefined);
            yield* sources.replaceSource({
              id: image.id,
              expectedRevision: 1,
              name: 'figure.png',
              bytes: new Uint8Array([...bytes, 0])
            });
            yield* materials.createVersion({
              materialId: material.id,
              publish: true,
              content: {
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

            assert.deepEqual(
              yield* client('conversations.captureSessionContext', intent),
              snapshot
            );
            assert.deepEqual(
              (yield* sources.sourceSnapshot({ id: image.id, revision: 1 })).bytes,
              bytes
            );

            return { snapshot, range, material, session, image };
          }).pipe(Effect.provide(handlers()))
        )
      );

      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const materials = yield* Materials;
          const sources = yield* Sources;

          assert.deepEqual(
            yield* conversations.sessionContext({ requestId: saved.snapshot.requestId }),
            saved.snapshot
          );
          assert.deepEqual(
            yield* conversations.sessionContext({ requestId: saved.range.requestId }),
            saved.range
          );
          yield* conversations.deleteSession(saved.session.id);
          assert.equal(
            (yield* Effect.flip(
              conversations.inspectSessionContext({
                requestId: saved.snapshot.requestId
              })
            )).kind,
            'not_found'
          );
          assert.equal(
            (yield* materials.material({ id: saved.material.id })).id,
            saved.material.id
          );
          assert.deepEqual(
            (yield* sources.sourceSnapshot({ id: saved.image.id, revision: 1 })).bytes,
            bytes
          );
        }).pipe(Effect.provide(services()))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

function assertUnavailableCitationTargets(
  mismatch: (typeof chatMessageSchema.Type.citations)[number],
  unpublished: (typeof chatMessageSchema.Type.citations)[number],
  draftVersionId: MaterialVersionId
) {
  assert.equal(mismatch!.precision, 'unavailable');
  assert.equal(mismatch!.evidence?.availability, 'unavailable');

  if (mismatch!.evidence?.availability !== 'unavailable')
    throw new Error('Expected mismatched identity');

  assert.equal(mismatch!.evidence.reason, 'document_mismatch');
  assert.equal(unpublished!.precision, 'unavailable');
  assert.equal(unpublished!.evidence?.availability, 'unavailable');

  if (unpublished!.evidence?.availability !== 'unavailable')
    throw new Error('Expected unpublished identity');

  assert.equal(unpublished!.evidence.reason, 'version_missing');
  assert.equal(unpublished!.materialVersionId, draftVersionId);
}

function assertRetainedCitationShapes(
  read: typeof chatMessageSchema.Type,
  anchor: Extract<(typeof chatMessageSchema.Type.citations)[number]['anchor'], { type: 'text' }>,
  materialVersionId: MaterialVersionId,
  latestVersionId: MaterialVersionId,
  draftVersionId: MaterialVersionId,
  sourceId: SourceId
) {
  const [legacy, mismatch, unpublished, attachment] = read.citations;

  assert.equal(legacy!.precision, 'approximate');
  assert.equal(legacy!.evidence?.availability, 'available');

  if (legacy!.evidence?.availability !== 'available') throw new Error('Expected retained anchor');

  assert.equal(legacy!.evidence.precision, 'approximate');
  assert.equal(legacy!.evidence.excerpt, null);
  assert.equal(legacy!.evidence.block, null);
  assert.deepEqual(legacy!.evidence.location, anchor);
  assert.equal(legacy!.evidence.revision.inputVersionId, materialVersionId);
  assert.equal(legacy!.evidence.revision.currentVersionId, latestVersionId);
  assert.equal(legacy!.evidence.revision.state, 'stale');
  assert.equal(legacy!.documentId, null);
  assert.equal(legacy!.rangeStart, null);
  assertUnavailableCitationTargets(mismatch!, unpublished!, draftVersionId);

  assert.equal(attachment!.precision, 'approximate');
  assert.deepEqual(attachment!.evidence, {
    availability: 'unavailable',
    precision: 'approximate',
    reason: 'attachment_target_unresolved',
    sourceId,
    anchor,
    quote: 'Retained attachment'
  });

  for (const citation of read.citations) {
    assert.deepEqual(citation.support, { state: 'unassessed' });
    assert.equal(citation.rangeStart === null || typeof citation.rangeStart === 'number', true);
  }
}

testStable(
  'retained legacy and attachment citations keep bounded precision; wrong exact identities never use latest content',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const handlers = () =>
      ConversationsRpcLive.pipe(
        Layer.provideMerge(
          Layer.mergeAll(Conversations.layer, Materials.layer, Sources.layer, Settings.layer)
        ),
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );

    try {
      const retained = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
            const materials = yield* Materials;
            const session = yield* rpc('conversations.createSession', { title: 'Historic shapes' });
            const body = content('Same words in distinct documents');
            const material = yield* materials.create({
              title: 'Published',
              content: body,
              publish: true
            });
            const latest = yield* materials.createVersion({
              materialId: material.id,
              content: content(body.blocks[0]!.text),
              publish: true
            });
            const draft = yield* materials.createVersion({
              materialId: material.id,
              content: body,
              publish: false
            });
            const documentId = context.db.orm
              .select()
              .from(s.material_document_versions)
              .where(eq(s.material_document_versions.version_id, material.version.id))
              .get()!.document_id;
            const latestDocumentId = context.db.orm
              .select()
              .from(s.material_document_versions)
              .where(eq(s.material_document_versions.version_id, latest.id))
              .get()!.document_id;
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
              material_version_id: material.version.id,
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
                  material_version_id: draft.id,
                  document_id: documentId,
                  block_id: body.blocks[0]!.id,
                  range_start: 0n,
                  range_end: 10n
                },
                {
                  ...base,
                  marker: 4n,
                  material_version_id: null,
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
              material.version.id,
              latest.id,
              draft.id,
              source.id
            );

            assert.deepEqual(
              (yield* rpc('conversations.thread', { sessionId: session.id, limit: 10 })).items[0]!
                .citations,
              read.citations
            );
            const edited = yield* rpc('conversations.editMessage', {
              messageId: message.id,
              text: 'Reordered [4] [2] [1] [3]'
            });

            assert.deepEqual(edited.citations, read.citations);
            const exactVersion = yield* rpc('conversations.messageVersionCitations', {
              sessionId: session.id,
              messageId: message.id,
              versionId: message.activeVersionId!
            });

            assert.deepEqual(exactVersion.citations, read.citations);
            assert.deepEqual(
              (yield* rpc('conversations.setActiveVersion', {
                messageId: message.id,
                versionId: message.activeVersionId!
              })).citations,
              read.citations
            );
            assert.deepEqual(
              context.db.orm
                .select()
                .from(s.citations)
                .where(eq(s.citations.version_id, message.activeVersionId!))
                .all(),
              rows
            );

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

            assert.deepEqual(
              (yield* rpc('conversations.message', { id: retained.id })).citations,
              retained.citations
            );
            assert.deepEqual(
              (yield* rpc('conversations.messageVersionCitations', {
                sessionId: retained.sessionId,
                messageId: retained.id,
                versionId: retained.versionId
              })).citations,
              retained.citations
            );
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
        Layer.mergeAll(Conversations.layer, Materials.layer, Settings.layer, Sources.layer).pipe(
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
            assert.equal(
              (yield* Effect.flip(
                client('conversations.captureSessionContext', {
                  ...intent,
                  ...scope,
                  intentKey: 'invalid-' + index
                })
              )).kind,
              'invalid_input'
            );
          }

          assert.equal(context.db.orm.select().from(s.session_run_contexts).all().length, 0);
          const captured = yield* client('conversations.captureSessionContext', intent);

          assert.deepEqual(
            captured.messages.map((message) => message.messageId),
            [first.id]
          );
          const rootOnly = yield* client('conversations.captureSessionContext', {
            ...intent,
            intentKey: 'root-only',
            threadRoot,
            throughMessageId: root.id
          });

          assert.deepEqual(
            rootOnly.messages.map((message) => message.messageId),
            [root.id]
          );
          const threaded = yield* client('conversations.captureSessionContext', {
            ...intent,
            intentKey: 'threaded',
            threadRoot,
            throughMessageId: child.id
          });

          assert.deepEqual(
            threaded.messages.map((message) => message.messageId),
            [root.id, child.id]
          );
          yield* client('conversations.editMessage', {
            messageId: first.id,
            text: 'Changed afterwards'
          });
          yield* client('conversations.postMessage', { sessionId: session.id, text: 'Later' });
          assert.deepEqual(yield* client('conversations.captureSessionContext', intent), captured);
        }).pipe(Effect.scoped, Effect.provide(handlers))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
