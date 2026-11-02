/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises live proposal protection and retirement of completed private receipts.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves independently published outcomes while fencing consumed proposal actions.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider fixtures execute the actual generation and native history cleanup Workflows.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Effect } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';
import { acceptHistory, cleanupHistory } from '#testing/material-history';
import { withTestPublication } from '#testing/publication';
import { assertScrubbed, setup, validDocumentTransformOutput } from '#testing/session-deletion';

for (const apply of [false, true]) {
  test(`live proposal protects exact bases and inputs; completed ${apply ? 'applied' : 'kept'} outcome survives history retirement`, async () => {
    const f = await documentTransformFixture();

    try {
      const additional = await Effect.runPromise(
        Effect.flatMap(Materials, (m) =>
          m.createManualDocument({
            title: 'Additional proposal input',
            document: deletionDocument('Additional proposal evidence')
          })
        ).pipe(Effect.provide(f.domain()))
      );
      const saved = await setup(f, 'PROPOSAL_HISTORY_PRIVATE', true, additional.version.id);

      await Effect.runPromise(
        withTestPublication(
          f.context,
          Effect.flatMap(Conversations, (c) => c.abandonReply(saved.pending)).pipe(
            Effect.asVoid,
            Effect.provide(f.domain())
          )
        ).pipe(Effect.provide(f.domain()))
      );

      f.replies.push(
        { kind: 'sources', query: 'independent' },
        {
          kind: 'output',
          output: validDocumentTransformOutput('PUBLISHED_PROPOSAL_HISTORY_COPY [1]')
        }
      );

      await f.execute(f.event(saved.request.id), 'history-proposal-generation');

      const retained = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          const c = yield* Conversations;

          const request = yield* m.materialGeneration({
            requestId: saved.request.id,
            verifyOnly: true
          });

          assert.ok(request.resultVersionId !== null);

          if (!apply)
            yield* m.createVersion({
              materialId: saved.library.id,
              content: { kind: 'document', ...deletionDocument('Current manual Document') },
              publish: true
            });

          if (!apply)
            yield* m.createVersion({
              materialId: additional.id,
              content: { kind: 'document', ...deletionDocument('Current additional evidence') },
              publish: true
            });

          const scope = { materialId: saved.library.id, policy: { keepLatest: 1 } };

          const live = yield* m.previewHistoryPrune(scope);

          assert.ok(
            live.protected.some(
              (p) =>
                p.versionId === saved.library.version.id &&
                p.reason === (apply ? 'keep_latest' : 'proposal')
            )
          );

          assert.ok(
            live.protected.some(
              (p) => p.versionId === request.resultVersionId && p.reason === 'draft'
            )
          );

          assert.ok(!live.candidateIds.includes(saved.library.version.id));
          const liveInputs = yield* m.previewHistoryPrune({
            materialId: additional.id,
            policy: { keepLatest: 1 }
          });

          assert.ok(!liveInputs.candidateIds.includes(additional.version.id));

          if (!apply)
            assert.ok(
              liveInputs.protected.some(
                (p) => p.versionId === additional.version.id && p.reason === 'proposal'
              )
            );

          const keepInput = { requestId: saved.request.id, key: 'history-keep' };

          const keep = yield* c.keepDocumentProposal(keepInput);

          assert.equal(keep.outcome, 'kept');

          // A conflict receipt is still live; a successful copy is the completion proof.
          const applyInput = {
            requestId: saved.request.id,
            key: 'history-apply',
            baseVersionId: saved.library.version.id,
            expectedVersionId: saved.library.version.id
          };

          const applied = apply ? yield* c.applyDocumentProposal(applyInput) : null;

          if (applied) {
            assert.equal(applied.outcome, 'applied');

            assert.ok(applied.resultVersionId !== null);
          }

          assert.ok(keep.resultVersionId !== null);

          const preview = yield* m.previewHistoryPrune(scope);

          assert.ok(preview.candidateIds.includes(saved.library.version.id));

          const copy = yield* m.materialVersion({ id: keep.resultVersionId });

          return {
            keepInput,
            applyInput,
            keep,
            applied,
            copy,
            proposedId: request.resultVersionId
          };
        }).pipe(Effect.provide(f.domain()))
      );

      await acceptHistory(f, saved.library.id, 'history-proposal');

      await cleanupHistory(f, 'history-proposal');

      f.reopen();

      assertScrubbed(f, 'PROPOSAL_HISTORY_PRIVATE-instruction');

      assertScrubbed(f, 'PROPOSAL_HISTORY_PRIVATE-reply');

      assert.deepEqual(f.context.db.orm.select().from(s.document_proposals).all(), []);

      assert.deepEqual(f.context.db.orm.select().from(s.document_proposal_receipts).all(), []);

      assert.equal(
        f.context.db.orm
          .select()
          .from(s.material_versions)
          .where(eq(s.material_versions.id, retained.proposedId))
          .get(),
        undefined
      );

      const receipts = f.context.db.orm.select().from(s.retired_document_proposal_receipts).all();

      assert.ok(
        receipts.some(
          (r) =>
            r.request_id === saved.request.id &&
            r.result_version_id === retained.keep.resultVersionId
        )
      );

      assert.throws(() =>
        f.context.db.orm.run(
          sql`DELETE FROM retired_document_proposal_receipts WHERE request_id=${saved.request.id}`
        )
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          const c = yield* Conversations;

          assert.deepEqual(yield* m.materialVersion({ id: retained.copy.id }), retained.copy);

          if (retained.applied?.resultVersionId) {
            const applied = yield* m.materialVersion({ id: retained.applied.resultVersionId });

            assert.deepEqual(applied.content, retained.copy.content);
          }

          assert.equal(
            (yield* Effect.flip(c.keepDocumentProposal(retained.keepInput))).kind,
            'not_found'
          );

          assert.equal(
            (yield* Effect.flip(c.applyDocumentProposal(retained.applyInput))).kind,
            'not_found'
          );
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  });
}
