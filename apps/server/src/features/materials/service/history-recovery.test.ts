/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises cleanup rollback, failed settlement, restart and exact attempt fencing.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Injects SQLite failures while native cleanup and publication ownership remain active.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ No failure setter substitutes for the cleanup path; temporary triggers only inject I/O.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Materials } from '#server/features/materials/index';
import { acceptMaterialDeletion, cleanupMaterial } from '#testing/material-deletion';
import { acceptHistory, cleanupHistory } from '#testing/material-history';
import { assertScrubbed, awaitNativeStatus } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';
import { withTestPublication } from '#testing/publication';

for (const failSettlement of [false, true]) {
  testStable(
    `injected cleanup failure ${failSettlement ? 'and failed state persistence' : 'with durable failure'} rolls back and recovers after reopen`,
    async () => {
      const f = await pageTransformFixture();

      try {
        const saved = await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Materials;

            const root = yield* m.create({
              title: 'Atomic pruning',
              publish: true,
              content: {
                kind: 'flashcards',
                cards: [{ front: 'flowchart TD\nA[ROLLBACK_HISTORY_PRIVATE]', back: 'Answer' }]
              }
            });

            const current = yield* m.createVersion({
              materialId: root.id,
              publish: true,
              content: {
                kind: 'flashcards',
                cards: [{ front: 'flowchart TD\nA[ROLLBACK_CURRENT_KEEP]', back: 'Answer' }]
              }
            });

            const currentVersion = yield* m.materialVersion({ id: current.id });

            return { root, current, currentVersion };
          }).pipe(Effect.provide(f.domain()))
        );

        await acceptHistory(f, saved.root.id, 'history-rollback');

        const before = f.context.db.orm.select().from(s.material_flashcard_versions).all();

        f.context.db.orm.run(
          sql`CREATE TRIGGER reject_history_cleanup BEFORE DELETE ON material_flashcard_versions BEGIN SELECT RAISE(ABORT,'injected cleanup'); END`
        );

        if (failSettlement)
          f.context.db.orm.run(
            sql`CREATE TRIGGER reject_history_failure BEFORE UPDATE OF status ON material_history_prunes WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'injected settlement'); END`
          );

        await expect(cleanupHistory(f, 'history-rollback')).rejects.toSatisfy(() => true);

        await Effect.runPromise(
          awaitNativeStatus(f, 'history-test/history-rollback/1', 'completed')
        );

        const state = await Effect.runPromise(
          Effect.flatMap(Materials, (m) =>
            m.historyPrune({ operationId: 'history-rollback' })
          ).pipe(Effect.provide(f.domain()))
        );

        assert.strictEqual(state.status, failSettlement ? 'pending' : 'failed');

        assert.ok(state.completedAt === null);

        expect(f.context.db.orm.select().from(s.material_flashcard_versions).all()).toStrictEqual(
          before
        );

        assert.ok(
          f.context.db.orm
            .select()
            .from(s.material_flashcard_versions)
            .where(eq(s.material_flashcard_versions.version_id, saved.root.version.id))
            .get()
        );

        await expect(acceptMaterialDeletion(f, saved.root.id)).rejects.toSatisfy(() => true);

        f.context.db.orm.run(sql`DROP TRIGGER reject_history_cleanup`);

        if (failSettlement) f.context.db.orm.run(sql`DROP TRIGGER reject_history_failure`);

        f.reopen();

        await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Materials;

            const retry = yield* m.retryHistoryPrune({ operationId: state.operationId });

            assert.strictEqual(retry.attempt, 2);

            assert.strictEqual(
              (yield* m.retryHistoryPrune({ operationId: state.operationId })).attempt,
              2
            );

            assert.ok(
              (yield* m.failMaterialHistory({
                operationId: state.operationId,
                attempt: 1,
                errorKind: 'internal'
              })).status === 'pending'
            );
          }).pipe(Effect.provide(f.domain()))
        );

        await Effect.runPromise(
          withTestPublication(
            f.context,
            Effect.gen(function* () {
              assert.ok(
                (yield* (yield* Materials).finishMaterialHistory({
                  operationId: state.operationId,
                  attempt: 1
                })).status === 'pending'
              );
            }).pipe(Effect.provide(f.domain()))
          ).pipe(Effect.provide(f.domain()))
        );

        expect(f.context.db.orm.select().from(s.material_flashcard_versions).all()).toStrictEqual(
          before
        );

        await cleanupHistory(f, state.operationId);

        f.reopen();

        assertScrubbed(f, 'ROLLBACK_HISTORY_PRIVATE');

        await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Materials;

            const completed = yield* m.historyPrune({ operationId: state.operationId });

            assert.ok(completed.status === 'completed');

            assert.strictEqual(completed.attempt, 2);

            assert.strictEqual(
              (yield* m.retryHistoryPrune({ operationId: state.operationId })).attempt,
              2
            );

            expect(yield* m.materialVersion({ id: saved.current.id })).toStrictEqual(
              saved.currentVersion
            );
          }).pipe(Effect.provide(f.domain()))
        );

        await acceptMaterialDeletion(f, saved.root.id);

        await cleanupMaterial(f, saved.root.id);

        f.reopen();

        assertScrubbed(f, 'ROLLBACK_CURRENT_KEEP');
      } finally {
        await f.close();
      }
    }
  );
}
