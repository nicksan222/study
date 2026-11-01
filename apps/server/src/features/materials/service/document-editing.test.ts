/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises guarded Document editing through native RPC and SQLite.                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Covers racing saves, retained conflicts, reopen and guarded restoration.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Execution status: UNRUN pending CI; no remote provider is contacted.                     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { createBlock } from '@study/contracts/sources/document';
import { sql, eq } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import type { Context } from 'effect';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { makeMaterialOutput } from '#testing/material-output';

const paragraph = (text: string) =>
  createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] });

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

test('native saves race on one expected revision, retain both rich alternatives and replay after reopen', async () => {
  const location = createTestDatabase();

  let context = new ServerContext(location.open());

  const services = () =>
    Materials.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

  const handlers = () => MaterialsRpcLive.pipe(Layer.provide(services()));

  const call = <A, E>(action: Effect.Effect<A, E, Context.Service.Identifier<typeof Materials>>) =>
    Effect.runPromise(action.pipe(Effect.provide(services())));

  try {
    const stable = createBlock({ type: 'math', expression: 'x² + y²' });

    const original = await call(
      Effect.gen(function* () {
        return yield* (yield* Materials).createManualDocument({
          title: 'Standalone',
          document: { blocks: [stable, paragraph('alpha')], meta }
        });
      })
    );

    const a = {
      materialId: original.id,
      expectedVersionId: original.version.id,
      saveKey: 'a',
      document: { blocks: [stable, paragraph('First')], meta }
    };

    const b = {
      ...a,
      saveKey: 'b',
      document: {
        blocks: [
          stable,
          createBlock(
            { type: 'code', language: 'ts', code: 'const x = 2;' },
            { type: 'authored' },
            a.document.blocks[1]!.id
          )
        ],
        meta
      }
    };

    const save = (value: typeof a) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });

            return yield* rpc('materials.saveDocument', value);
          }).pipe(Effect.provide(handlers()))
        )
      );

    const results = await Promise.all([save(a), save(b)]);

    assert.deepEqual(results.map((r) => r.outcome).sort(), ['conflict', 'saved']);

    const winner = results.find((r) => r.outcome === 'saved')!;

    const loser = results.find((r) => r.outcome === 'conflict')!;

    const comparison = await call(
      Effect.gen(function* () {
        return yield* (yield* Materials).compareDocument({
          beforeVersionId: original.version.id,
          proposedVersionId: loser.submittedVersionId,
          currentVersionId: winner.submittedVersionId
        });
      })
    );

    assert.equal(comparison.evidence, 'structural_only');

    assert.equal(comparison.proposed.content.kind, 'document');

    assert.ok(comparison.proposedChanges.some((change) => change.kind === 'inserted'));

    assert.ok(!comparison.proposedChanges.some((change) => change.blockId === stable.id));

    assert.equal(context.db.orm.select().from(s.materials).all().length, 1);

    const retainedBlock = context.db.orm
      .select()
      .from(s.material_document_versions)
      .where(eq(s.material_document_versions.version_id, loser.submittedVersionId))
      .get()!;

    assert.throws(() =>
      context.db.orm
        .update(s.blocks)
        .set({ text: 'tampered' })
        .where(eq(s.blocks.document_id, retainedBlock.document_id))
        .run()
    );

    assert.throws(() => context.db.orm.delete(s.document_edit_receipts).run());

    const output = makeMaterialOutput({ db: context.db, clock: context.clock });

    const beforeFailure = output();

    const retryable = {
      ...a,
      saveKey: 'transaction-failure',
      expectedVersionId: winner.submittedVersionId,
      document: { blocks: [stable, paragraph('Atomic content')], meta }
    };

    context.db.orm.run(
      sql`CREATE TRIGGER reject_edit_event BEFORE INSERT ON workflow_events WHEN NEW.type='MaterialPublished' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END`
    );

    await assert.rejects(save(retryable));

    assert.deepEqual(output(), beforeFailure);

    context.db.orm.run(sql`DROP TRIGGER reject_edit_event`);

    const retried = await save(retryable);

    assert.equal(retried.outcome, 'saved');

    assert.equal((await save(retryable)).submittedVersionId, retried.submittedVersionId);

    const mutationError = await call(
      Effect.gen(function* () {
        return yield* Effect.flip((yield* Materials).deleteDraft({ id: loser.submittedVersionId }));
      })
    );

    assert.equal(mutationError.kind, 'invalid_input');

    context.close();

    context = new ServerContext(location.open());

    const replay = await save(a);

    assert.equal(replay.replayed, true);

    assert.equal(replay.submittedVersionId, results[0]!.submittedVersionId);

    const changed = await call(
      Effect.gen(function* () {
        return yield* Effect.flip(
          (yield* Materials).saveDocument({
            ...a,
            document: { blocks: [paragraph('changed intent')], meta }
          })
        );
      })
    );

    assert.equal(changed.kind, 'invalid_input');

    const undo = await call(
      Effect.gen(function* () {
        return yield* (yield* Materials).undoDocument({
          materialId: original.id,
          expectedVersionId: retried.submittedVersionId,
          restoreVersionId: original.version.id,
          undoKey: 'undo'
        });
      })
    );

    assert.equal(undo.outcome, 'saved');

    const concurrent = await save({
      ...a,
      expectedVersionId: undo.submittedVersionId,
      saveKey: 'after-undo',
      document: { blocks: [stable, paragraph('Later manual edit')], meta }
    });

    const staleUndo = await call(
      Effect.gen(function* () {
        return yield* (yield* Materials).undoDocument({
          materialId: original.id,
          expectedVersionId: undo.submittedVersionId,
          restoreVersionId: original.version.id,
          undoKey: 'stale-undo'
        });
      })
    );

    assert.equal(staleUndo.outcome, 'conflict');

    assert.equal(staleUndo.currentVersionId, concurrent.submittedVersionId);

    assert.equal(
      (
        await call(
          Effect.gen(function* () {
            return yield* (yield* Materials).material({ id: original.id });
          })
        )
      ).version.id,
      concurrent.submittedVersionId
    );

    assert.equal(context.db.orm.select().from(s.materials).all().length, 1);
  } finally {
    context.close();

    location.cleanup();
  }
});
