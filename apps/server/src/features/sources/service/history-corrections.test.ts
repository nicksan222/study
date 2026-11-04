/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Source history retires extraction bodies independently from original bytes and     │
 * │ in-flight corrections.                                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies unchanged original bytes survive obsolete extraction pruning while current    │
 * │   and in-flight correction roots remain usable.                                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { sql } from '@study/db';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { Sources } from '#server/features/sources/index';
import {
  sourceCorrectionWorkflow,
  sourceCorrectionHandler
} from '#server/features/sources/workflows/index';
import { decodeEvent } from '#server/platform/workflows/events';
import { documentTransformFixture } from '#testing/document-transform';
import { processSource } from '#testing/material-history';
import { assertScrubbed } from '#testing/session-deletion';

testStable(
  'unchanged original bytes survive obsolete extraction pruning while current and in-flight correction roots remain usable',
  async () => {
    const f = await documentTransformFixture();

    try {
      const bytes = new TextEncoder().encode('Original source evidence');
      const source = await Effect.runPromise(
        Effect.flatMap(Sources, (sources) =>
          sources.createSource({ name: 'corrections.txt', bytes, projectId: null })
        ).pipe(Effect.provide(f.domain()))
      );
      const first = await processSource(f);
      const corrected: Awaited<ReturnType<typeof processSource>>[] = [];

      for (const after of ['First corrected evidence', 'Current corrected evidence']) {
        await Effect.runPromise(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const before = yield* sources.sourceDocument(source.id);

            yield* sources.correctBlock({
              id: source.id,
              documentId: before.id,
              ordinal: 0,
              before: before.document.blocks[0]!.text,
              after
            });
            assert.strictEqual((yield* sources.sourceProcessing(source.id)).revision, 1);
            assert.strictEqual(
              (yield* sources.extraction({
                sourceId: source.id,
                revision: 1n,
                snapshotId: before.id
              })).document.blocks[0]?.text,
              before.document.blocks[0]?.text
            );
          }).pipe(Effect.provide(f.domain()))
        );
        corrected.push(await processSource(f, true));
      }

      const correctionEvents = f.context.db.orm
        .all<{ payload: string }>(
          sql`SELECT payload FROM workflow_events WHERE type='SourceCorrectionRequested' ORDER BY rowid`
        )
        .map((row) => decodeEvent(row.payload));
      const current = corrected[1]!.documentId;

      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;

          yield* sources.correctBlock({
            id: source.id,
            documentId: current,
            ordinal: 0,
            before: 'Current corrected evidence',
            after: 'Pending correction completes'
          });
          const scope = { sourceId: source.id, keepLatest: 1 };
          const preview = yield* sources.previewHistory(scope);

          expect(preview.candidates.map((item) => item.snapshotId)).toStrictEqual([
            first.documentId,
            corrected[0]!.documentId
          ]);
          expect(preview.blockedSnapshotIds).toStrictEqual([]);
          f.context.db.exec(
            "CREATE TRIGGER reject_private_source_retirement BEFORE INSERT ON workflow_events WHEN NEW.type='SourceHistoryPruned' BEGIN SELECT RAISE(ABORT,'injected rollback'); END"
          );
          yield* Effect.flip(sources.retireHistory({ ...scope, token: preview.token }));
          assert.strictEqual(
            f.context.db.orm.get(
              sql`SELECT count(*) n FROM workflow_activities WHERE instr(result,'First corrected evidence')>0`
            )?.n,
            1n
          );
          assert.ok(
            yield* sources.extraction({
              sourceId: source.id,
              revision: 1n,
              snapshotId: corrected[0]!.documentId
            })
          );
          f.context.db.exec('DROP TRIGGER reject_private_source_retirement');
          yield* sources.retireHistory({ ...scope, token: preview.token });
          assert.strictEqual(
            f.context.db.orm.get(
              sql`SELECT count(*) n FROM workflow_activities WHERE instr(result,'First corrected evidence')>0`
            )?.n,
            0n
          );
          assert.strictEqual(
            f.context.db.orm.get(
              sql`SELECT count(*) n FROM workflow_events WHERE instr(payload,'First corrected evidence')>0`
            )?.n,
            0n
          );
          assert.strictEqual(
            f.context.db.orm.get(
              sql`SELECT count(*) n FROM workflow_executions WHERE instr(payload,'First corrected evidence')>0 OR instr(result,'First corrected evidence')>0`
            )?.n,
            0n
          );
          assertScrubbed(f, 'First corrected evidence', false);
          const currentEvent = correctionEvents.at(-1)!;

          assert.strictEqual(
            f.context.db.orm.get(
              sql`SELECT count(*) n FROM workflow_retired_correlations WHERE correlation_id=${currentEvent.correlationId} AND event_type='SourceIndexed'`
            )?.n,
            0n
          );
          assert.ok(
            f.context.db.orm.get(
              sql`SELECT 1 FROM workflow_events WHERE correlation_id=${currentEvent.correlationId} AND type='SourceIndexed' AND payload!='{}'`
            )
          );
          assert.strictEqual(
            f.context.db.orm.get(
              sql`SELECT count(*) n FROM workflow_activities WHERE name='correct-source' AND instr(result,'Current corrected evidence')>0`
            )?.n,
            1n
          );

          for (const snapshotId of [first.documentId, corrected[0]!.documentId])
            assert.ok(
              (yield* Effect.flip(
                sources.extraction({ sourceId: source.id, revision: 1n, snapshotId })
              )).kind === 'not_found'
            );

          assert.ok(
            (yield* sources.extraction({ sourceId: source.id, revision: 1n, snapshotId: current }))
              .document.blocks[0]?.text === 'Current corrected evidence'
          );
          expect(
            (yield* sources.exportRevision({ sourceId: source.id, revision: 1n })).bytes
          ).toStrictEqual(bytes);
        }).pipe(Effect.provide(f.domain()))
      );
      f.reopen();

      for (const event of correctionEvents) {
        assert.ok(event.type === 'SourceCorrectionRequested');

        assert.ok(!(event.type !== 'SourceCorrectionRequested'), 'Unexpected fixture event');

        await expect(
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const engine = yield* WorkflowEngine.WorkflowEngine;

                yield* engine.register(sourceCorrectionWorkflow, sourceCorrectionHandler);

                return yield* engine.execute(sourceCorrectionWorkflow, {
                  executionId: `retired-replay/${event.eventId}`,
                  payload: { event }
                });
              }).pipe(Effect.provide(f.services()))
            )
          )
        ).rejects.toSatisfy(() => true);
      }

      const pending = await processSource(f, true);

      assert.notStrictEqual(pending.documentId, current);
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const history = yield* sources.extractions({ sourceId: source.id, limit: 10 });

          expect(history.items.map((item) => item.snapshotId)).toStrictEqual([
            pending.documentId,
            current
          ]);
          assert.ok(
            (yield* sources.currentExtraction({ id: source.id }))?.document.blocks[0]?.text ===
              'Pending correction completes'
          );
          expect(
            (yield* sources.exportRevision({ sourceId: source.id, revision: 1n })).bytes
          ).toStrictEqual(bytes);
          // Retiring a correction input must keep its retained output's ownership identity.
          const scope = { sourceId: source.id, keepLatest: 1 };
          const preview = yield* sources.previewHistory(scope);

          yield* sources.retireHistory({ ...scope, token: preview.token });
          assertScrubbed(f, 'Current corrected evidence', false);
          assert.ok(
            (yield* sources.currentExtraction({ id: source.id }))?.document.blocks[0]?.text ===
              'Pending correction completes'
          );
        }).pipe(Effect.provide(f.domain()))
      );
      assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
      assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM study_documents`)?.n, 0n);
      assert.strictEqual(
        f.context.db.orm.get(
          sql`SELECT count(*) n FROM source_snapshots WHERE source_id=${source.id}`
        )?.n,
        1n
      );
      expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);
