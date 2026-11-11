/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises bounded history pruning through migrated SQLite and native RPC.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves current publications and exact historical tombstone semantics.               │
 * │ - Covers scope changes, policy bounds, idempotency and bounded candidate batches.        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Public services and native Workflows retain production ownership and publication guards. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { historyPolicySchema, historyVersionIdsSchema } from '@study/contracts/materials/history';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { assert, expect } from 'vite-plus/test';

import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { deletionDocument, acceptMaterialDeletion } from '#testing/material-deletion';
import { cleanupHistory as cleanup } from '#testing/material-history';
import { cleanup as cleanupNote } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';
import { withTestPublication } from '#testing/publication';

testStable('retention policy and explicit candidate scope have positive finite bounds', () => {
  const policy = Schema.decodeUnknownSync(historyPolicySchema);

  expect(policy({ keepLatest: 1 })).toStrictEqual({ keepLatest: 1 });

  expect(policy({ keepLatest: 1000 })).toStrictEqual({ keepLatest: 1000 });

  for (const keepLatest of [0, -1, 1001, 1.5]) assert.throws(() => policy({ keepLatest }));

  const ids = Schema.decodeUnknownSync(historyVersionIdsSchema);

  assert.throws(() => ids([1n, 1n]));

  assert.throws(() => ids(Array.from({ length: 101 }, (_, i) => BigInt(i + 1))));
});

testStable(
  'native RPC prunes exact learning history while preserving its current version and an independent output',
  async () => {
    const f = await pageTransformFixture();

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          const root = yield* m.create({
            title: 'History',
            content: {
              kind: 'flashcards',
              cards: [{ front: 'flowchart TD\nA[HISTORY_MARKER_REMOVE]', back: 'Answer' }]
            },
            publish: true
          });

          const kept = yield* m.createVersion({
            materialId: root.id,
            content: {
              kind: 'flashcards',
              cards: [{ front: 'flowchart TD\nA[CURRENT_MARKER_KEEP]', back: 'Answer' }]
            },
            publish: true
          });

          const derivative = yield* m.create({
            title: 'Copy',
            content: {
              kind: 'flashcards',
              cards: [{ front: 'flowchart TD\nA[COPY_MARKER_KEEP]', back: 'Answer' }]
            },
            publish: true
          });

          const current = yield* m.material({ id: root.id });

          const client = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true }).pipe(
            Effect.provide(MaterialsRpcLive),
            Effect.provide(Layer.succeed(Materials, m))
          );

          const scope = { materialId: root.id, policy: { keepLatest: 1 } };

          const preview = yield* client('materials.previewHistoryPrune', scope);

          expect(preview.candidateIds).toStrictEqual([root.version.id]);

          expect(preview.references).toStrictEqual([]);

          assert.ok(preview.removedBodyBytes > 0n);

          const input = {
            ...scope,
            operationId: 'history-rpc',
            candidateIds: preview.candidateIds,
            token: preview.token
          };

          const accepted = yield* client('materials.requestHistoryPrune', input);

          assert.ok(accepted.status === 'pending');

          expect(yield* client('materials.requestHistoryPrune', input)).toStrictEqual(accepted);

          assert.ok(
            (yield* Effect.flip(m.materialVersion({ id: root.version.id }))).kind === 'not_found'
          );

          return { root, kept, current, derivative, input };
        }).pipe(Effect.provide(f.domain()), Effect.scoped)
      );

      await cleanup(f, saved.input.operationId);

      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          assert.ok(
            (yield* m.historyPrune({ operationId: saved.input.operationId })).status === 'completed'
          );

          expect(yield* m.material({ id: saved.root.id })).toStrictEqual(saved.current);

          assert.strictEqual(
            (yield* m.materialVersion({ id: saved.derivative.version.id })).id,
            saved.derivative.version.id
          );

          expect(
            (yield* m.materialVersion({ id: saved.derivative.version.id })).inputs
          ).toStrictEqual([]);

          const history = yield* m.materialVersions({ materialId: saved.root.id, limit: 30 });

          assert.ok(
            history.items.find((v) => v.id === saved.root.version.id)?.availability ===
              'unavailable'
          );

          assert.strictEqual(
            (yield* m.materialVersions({
              materialId: saved.root.id,
              cursor: saved.root.version.id,
              limit: 30
            })).items.length,
            0
          );

          expect(yield* m.requestHistoryPrune(saved.input)).toStrictEqual(
            yield* m.historyPrune({ operationId: saved.input.operationId })
          );
        }).pipe(Effect.provide(f.domain()))
      );

      const markerRows = f.context.db.orm.all(
        sql`SELECT front AS payload FROM material_flashcard_entries WHERE front LIKE '%HISTORY_MARKER_REMOVE%'`
      );

      expect(markerRows).toStrictEqual([]);

      assert.strictEqual(
        f.context.db.orm.select().from(s.material_deletion_members).all().length,
        0
      );

      expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'preview invalidates on new content, scope cannot expand, drafts are protected and no-op is explicit',
  async () => {
    const f = await pageTransformFixture();

    try {
      const input = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          const root = yield* m.create({
            title: 'Bounds',
            content: {
              kind: 'flashcards',
              cards: [{ front: 'flowchart TD\nA[old]', back: 'Answer' }]
            },
            publish: true
          });

          const scope = { materialId: root.id, policy: { keepLatest: 1 } };

          const first = yield* m.previewHistoryPrune(scope);

          expect(first.candidateIds).toStrictEqual([]);

          const draft = yield* m.createVersion({
            materialId: root.id,
            content: {
              kind: 'flashcards',
              cards: [{ front: 'flowchart TD\nA[draft]', back: 'Answer' }]
            },
            publish: false
          });

          const latest = yield* m.createVersion({
            materialId: root.id,
            content: {
              kind: 'flashcards',
              cards: [{ front: 'flowchart TD\nA[new]', back: 'Answer' }]
            },
            publish: true
          });

          assert.ok(
            (yield* Effect.flip(
              m.requestHistoryPrune({
                ...scope,
                operationId: 'stale',
                candidateIds: [],
                token: first.token
              })
            )).kind === 'invalid_input'
          );

          const preview = yield* m.previewHistoryPrune(scope);

          assert.ok(draft.status === 'draft');

          assert.ok(!preview.candidateIds.includes(draft.id));

          assert.ok(
            preview.protected.some((p) => p.versionId === draft.id && p.reason === 'draft')
          );

          assert.ok(
            preview.protected.some((p) => p.versionId === latest.id && p.reason === 'keep_latest')
          );

          assert.ok(
            (yield* Effect.flip(
              m.requestHistoryPrune({
                ...scope,
                operationId: 'expanded',
                candidateIds: [root.version.id, latest.id],
                token: preview.token
              })
            )).kind === 'invalid_input'
          );

          const noopScope = { materialId: root.id, policy: { keepLatest: 1000 } };

          const noop = yield* m.previewHistoryPrune(noopScope);

          expect(noop.candidateIds).toStrictEqual([]);

          return yield* m.requestHistoryPrune({
            ...noopScope,
            operationId: 'noop',
            candidateIds: [],
            token: noop.token
          });
        }).pipe(Effect.provide(f.domain()))
      );

      await cleanup(f, input.operationId);

      assert.ok(
        (
          await Effect.runPromise(
            Effect.gen(function* () {
              return yield* (yield* Materials).historyPrune({ operationId: input.operationId });
            }).pipe(Effect.provide(f.domain()))
          )
        ).status === 'completed'
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'cleanup failure remains visible, retry advances exactly once and stale settlement cannot complete a newer attempt',
  async () => {
    const f = await pageTransformFixture();

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          const root = yield* m.create({
            title: 'Retry',
            content: {
              kind: 'flashcards',
              cards: [{ front: 'flowchart TD\nA[retry-old]', back: 'Answer' }]
            },
            publish: true
          });

          yield* m.createVersion({
            materialId: root.id,
            content: {
              kind: 'flashcards',
              cards: [{ front: 'flowchart TD\nA[retry-current]', back: 'Answer' }]
            },
            publish: true
          });

          const scope = { materialId: root.id, policy: { keepLatest: 1 } };

          const preview = yield* m.previewHistoryPrune(scope);

          const accepted = yield* m.requestHistoryPrune({
            ...scope,
            operationId: 'retry-history',
            candidateIds: preview.candidateIds,
            token: preview.token
          });

          yield* m.failMaterialHistory({
            operationId: accepted.operationId,
            attempt: 1,
            errorKind: 'internal'
          });

          const retried = yield* m.retryHistoryPrune({ operationId: accepted.operationId });

          assert.strictEqual(retried.attempt, 2);

          assert.ok(
            (yield* m.failMaterialHistory({
              operationId: accepted.operationId,
              attempt: 1,
              errorKind: 'internal'
            })).status === 'pending'
          );

          return { root, accepted };
        }).pipe(Effect.provide(f.domain()))
      );

      const failure = await Effect.runPromise(
        withTestPublication(
          f.context,
          Effect.gen(function* () {
            const m = yield* Materials;

            assert.ok(
              (yield* m.finishMaterialHistory({
                operationId: saved.accepted.operationId,
                attempt: 1
              })).status === 'pending'
            );
          }).pipe(Effect.provide(f.domain()))
        ).pipe(Effect.provide(f.domain()))
      );

      assert.strictEqual(failure, undefined);

      await expect(acceptMaterialDeletion(f, saved.root.id)).rejects.toSatisfy(() => true);

      await cleanup(f, saved.accepted.operationId);

      await acceptMaterialDeletion(f, saved.root.id);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'authored exact captures block body retirement until raw note cleanup, while fresh work uses the independent current head',
  async () => {
    const f = await pageTransformFixture();

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const chats = yield* Notes;
          const root = yield* docs.create({
            createKey: 'capture-prune',
            title: 'Input history',
            document: deletionDocument('CAPTURE_PAYLOAD_PRUNE'),
            inputs: [],
            citations: []
          });

          assert.ok(root.version);
          const note = yield* chats.createUntitledNote({});

          yield* docs.attach({ noteId: note.id, pageId: root.id });

          yield* chats.postMessage({
            noteId: note.id,
            text: 'RAW_MESSAGE_PRIVATE',
            requestReply: false
          });
          yield* chats.updateNoteSelection({
            noteId: note.id,
            expectedRevision: 0n,
            targets: [
              {
                input: { kind: 'page', versionId: root.version.id },
                scope: { kind: 'document' }
              }
            ]
          });
          const capture = yield* chats.captureNoteContext({
            noteId: note.id,
            intentKey: 'same-run',
            instruction: 'PRIVATE_CAPTURE_PRUNE',
            preferences: {}
          });
          const generation = yield* chats.requestPageTransform({
            contextRequestId: capture.requestId,
            title: 'Pending',
            operations: ['clarity']
          });
          const current = yield* docs.save({
            pageId: root.id,
            expectedVersionId: root.version.id,
            key: 'current-head',
            document: deletionDocument('FRESH_INPUT_KEEP')
          });
          const scope = { pageId: root.id, keepLatest: 1 };
          const preview = yield* docs.previewHistory(scope);

          expect(preview.blockedVersionIds).toStrictEqual([root.version.id]);
          assert.ok(
            (yield* Effect.flip(docs.retireHistory({ ...scope, token: preview.token }))).kind ===
              'invalid_input'
          );
          assert.ok(
            (yield* chats.noteContext({ requestId: capture.requestId })).instruction ===
              'PRIVATE_CAPTURE_PRUNE'
          );
          yield* chats.deleteNote(note.id);
          const released = yield* docs.previewHistory(scope);

          expect(released.blockedVersionIds).toStrictEqual([]);
          yield* docs.retireHistory({ ...scope, token: released.token });

          return {
            rootId: root.id,
            currentId: current.submittedVersionId,
            noteId: note.id,
            captureId: capture.requestId,
            requestId: generation.id
          };
        }).pipe(Effect.provide(f.domain()))
      );

      await cleanupNote(f, saved.noteId);
      f.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const chats = yield* Notes;

          assert.ok(
            (yield* Effect.flip(chats.noteContext({ requestId: saved.captureId }))).kind ===
              'not_found'
          );
          assert.ok((yield* docs.transform({ requestId: saved.requestId })).cancelled === true);
          assert.ok(
            (yield* Effect.flip(
              chats.retryPageTransform({
                requestId: saved.requestId,
                retryId: 'no-resurrection'
              })
            )).kind === 'not_found'
          );
          const note = yield* chats.createUntitledNote({});

          yield* docs.attach({ noteId: note.id, pageId: saved.rootId });

          yield* chats.updateNoteSelection({
            noteId: note.id,
            expectedRevision: 0n,
            targets: [
              {
                input: { kind: 'page', versionId: saved.currentId },
                scope: { kind: 'document' }
              }
            ]
          });
          const fresh = yield* chats.captureNoteContext({
            noteId: note.id,
            intentKey: 'fresh',
            instruction: '',
            preferences: {}
          });

          expect(fresh.inputs[0]?.input).toStrictEqual({
            kind: 'page',
            versionId: saved.currentId
          });
          assert.strictEqual(
            (yield* docs.page({ id: saved.rootId })).headVersionId,
            saved.currentId
          );
        }).pipe(Effect.provide(f.domain()))
      );
      assert.strictEqual(
        f.context.db.orm.get(
          sql`SELECT count(*) n FROM message_versions WHERE text='RAW_MESSAGE_PRIVATE'`
        )?.n,
        0n
      );
      expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'history candidate batches are deterministic oldest-first and bounded to one hundred identities',
  async () => {
    const f = await pageTransformFixture();

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          const root = yield* m.create({
            title: 'Batch',
            content: { kind: 'flashcards', cards: [{ front: 'graph TD; A', back: 'Answer' }] },
            publish: true
          });

          const ids = [root.version.id];

          for (let number = 2; number <= 103; number++) {
            const version = yield* m.createVersion({
              materialId: root.id,
              content: {
                kind: 'flashcards',
                cards: [{ front: `graph TD; V${number}`, back: 'Answer' }]
              },
              publish: true
            });

            ids.push(version.id);
          }

          const scope = { materialId: root.id, policy: { keepLatest: 1 } };

          const preview = yield* m.previewHistoryPrune(scope);

          expect(preview.candidateIds).toStrictEqual(ids.slice(0, 100));

          assert.ok(preview.hasMore === true);

          assert.strictEqual((yield* m.previewHistoryPrune(scope)).token, preview.token);

          yield* m.requestHistoryPrune({
            ...scope,
            operationId: 'bounded-batch',
            candidateIds: preview.candidateIds,
            token: preview.token
          });

          return { scope, ids };
        }).pipe(Effect.provide(f.domain()))
      );

      await cleanup(f, 'bounded-batch');

      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          const next = yield* m.previewHistoryPrune(saved.scope);

          expect(next.candidateIds).toStrictEqual(saved.ids.slice(100, 102));

          assert.ok(next.hasMore === false);

          assert.strictEqual(
            (yield* m.material({ id: saved.scope.materialId })).version.id,
            saved.ids[102]
          );
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);
