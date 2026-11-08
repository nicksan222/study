/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises guarded Page editing through native RPC and SQLite.                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Covers racing saves, retained conflicts, reopen and guarded restoration.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses real native handlers and SQLite; no remote provider is contacted.                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { PagesRpc } from '@study/contracts/pages/rpc';
import { createBlock } from '@study/contracts/sources/document';
import { sql, eq } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import type { Context } from 'effect';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { assert, expect } from 'vite-plus/test';

import { Pages } from '#server/features/pages/index';
import { PagesRpcLive } from '#server/features/pages/rpc/index';
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

testStable(
  'native saves race on one expected revision, retain both rich alternatives and replay after reopen',
  async () => {
    const location = createTestDatabase();

    let context = new ServerContext(location.open());

    const services = () =>
      Pages.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

    const handlers = () => PagesRpcLive.pipe(Layer.provide(services()));

    const call = <A, E>(
      action: Effect.Effect<A, E, Database | Context.Service.Identifier<typeof Pages>>
    ) => Effect.runPromise(action.pipe(Effect.provide(services())));

    try {
      const stable = createBlock({ type: 'math', expression: 'x² + y²' });

      const original = await call(
        Effect.gen(function* () {
          return yield* (yield* Pages).create({
            createKey: 'native-edit-original',
            inputs: [],
            citations: [],
            title: 'Standalone',
            document: { blocks: [stable, paragraph('alpha')], meta }
          });
        })
      );

      const a = {
        pageId: original.id,
        expectedVersionId: original.version!.id,
        key: 'a',
        document: { blocks: [stable, paragraph('First')], meta }
      };

      const b = {
        ...a,
        key: 'b',
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
              const rpc = yield* RpcTest.makeClient(PagesRpc, { flatten: true });

              return yield* rpc('pages.save', value);
            }).pipe(Effect.provide(handlers()))
          )
        );

      const results = await Promise.all([save(a), save(b)]);

      expect(results.map((r) => r.outcome).sort()).toStrictEqual(['conflict', 'saved']);

      const winner = results.find((r) => r.outcome === 'saved')!;

      const loser = results.find((r) => r.outcome === 'conflict')!;

      const comparison = await call(
        Effect.gen(function* () {
          return yield* (yield* Pages).compare({
            beforeVersionId: original.version!.id,
            proposedVersionId: loser.submittedVersionId,
            currentVersionId: winner.submittedVersionId
          });
        })
      );

      assert.ok(comparison.evidence === 'structural_only');

      assert.ok(comparison.proposed.document.blocks.length > 0);

      assert.ok(comparison.proposedChanges.some((change) => change.kind === 'inserted'));

      assert.ok(!comparison.proposedChanges.some((change) => change.blockId === stable.id));

      assert.strictEqual(context.db.orm.select().from(s.pages).all().length, 1);

      const retainedBlock = context.db.orm
        .select()
        .from(s.page_versions)
        .where(eq(s.page_versions.id, loser.submittedVersionId))
        .get()!;

      assert.throws(() =>
        context.db.orm
          .update(s.blocks)
          .set({ text: 'tampered' })
          .where(eq(s.blocks.document_id, retainedBlock.content_snapshot_id))
          .run()
      );

      assert.throws(() => context.db.orm.delete(s.page_edit_receipts).run());

      const output = makeMaterialOutput({ db: context.db, clock: context.clock });

      const beforeFailure = output();

      const retryable = {
        ...a,
        key: 'transaction-failure',
        expectedVersionId: winner.submittedVersionId,
        document: { blocks: [stable, paragraph('Atomic content')], meta }
      };

      context.db.orm.run(
        sql`CREATE TRIGGER reject_edit_event BEFORE INSERT ON workflow_events WHEN NEW.type='PagePublished' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END`
      );

      await expect(save(retryable)).rejects.toSatisfy(() => true);

      expect(output()).toStrictEqual(beforeFailure);

      context.db.orm.run(sql`DROP TRIGGER reject_edit_event`);

      const retried = await save(retryable);

      assert.ok(retried.outcome === 'saved');

      assert.strictEqual((await save(retryable)).submittedVersionId, retried.submittedVersionId);

      assert.throws(() =>
        context.db.orm
          .delete(s.page_versions)
          .where(eq(s.page_versions.id, loser.submittedVersionId))
          .run()
      );

      context.close();

      context = new ServerContext(location.open());

      const replay = await save(a);

      assert.ok(replay.replayed === true);

      assert.strictEqual(replay.submittedVersionId, results[0]!.submittedVersionId);

      const changed = await call(
        Effect.gen(function* () {
          return yield* Effect.flip(
            (yield* Pages).save({
              ...a,
              document: { blocks: [paragraph('changed intent')], meta }
            })
          );
        })
      );

      assert.ok(changed.kind === 'invalid_input');

      const undo = await call(
        Effect.gen(function* () {
          return yield* (yield* Pages).restore({
            pageId: original.id,
            expectedVersionId: retried.submittedVersionId,
            restoreVersionId: original.version!.id,
            key: 'undo'
          });
        })
      );

      assert.ok(undo.outcome === 'saved');

      const concurrent = await save({
        ...a,
        expectedVersionId: undo.submittedVersionId,
        key: 'after-undo',
        document: { blocks: [stable, paragraph('Later manual edit')], meta }
      });

      const staleUndo = await call(
        Effect.gen(function* () {
          return yield* (yield* Pages).restore({
            pageId: original.id,
            expectedVersionId: undo.submittedVersionId,
            restoreVersionId: original.version!.id,
            key: 'stale-undo'
          });
        })
      );

      assert.ok(staleUndo.outcome === 'conflict');

      assert.strictEqual(staleUndo.currentVersionId, concurrent.submittedVersionId);

      assert.strictEqual(
        (
          await call(
            Effect.gen(function* () {
              return yield* (yield* Pages).page({ id: original.id });
            })
          )
        ).version!.id,
        concurrent.submittedVersionId
      );

      assert.strictEqual(context.db.orm.select().from(s.pages).all().length, 1);
    } finally {
      context.close();

      location.cleanup();
    }
  }
);

testStable('retires only one selected authored note version', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Pages.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const pages = yield* Pages;
        const original = yield* pages.create({
          createKey: 'single-version-delete',
          inputs: [],
          citations: [],
          title: 'Notes',
          document: { blocks: [paragraph('First')], meta }
        });
        const second = yield* pages.save({
          pageId: original.id,
          expectedVersionId: original.version!.id,
          key: 'second',
          document: { blocks: [paragraph('Second')], meta }
        });
        const third = yield* pages.save({
          pageId: original.id,
          expectedVersionId: second.submittedVersionId,
          key: 'third',
          document: { blocks: [paragraph('Third')], meta }
        });
        const scope = {
          pageId: original.id,
          keepLatest: 1,
          versionId: second.submittedVersionId
        };
        const preview = yield* pages.previewHistory(scope);

        expect(preview.versionIds).toEqual([second.submittedVersionId]);
        yield* pages.retireHistory({ ...scope, token: preview.token });
        expect((yield* pages.version({ id: original.version!.id })).document.blocks.length).toBe(1);
        expect(
          (yield* pages.version({ id: third.submittedVersionId })).document.blocks.length
        ).toBe(1);
        expect((yield* Effect.flip(pages.version({ id: second.submittedVersionId }))).kind).toBe(
          'not_found'
        );
        expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
