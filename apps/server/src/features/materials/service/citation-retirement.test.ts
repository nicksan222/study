/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises exact Material deletion through migrated SQLite, native RPC and native   │
 * │ Workflow.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact deletion behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/node';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import { documentTransformFixture } from '#testing/document-transform';
import {
  acceptMaterialDeletion,
  cleanupMaterial,
  deletionDocument
} from '#testing/material-deletion';
import { acceptHistory, cleanupHistory } from '#testing/material-history';

for (const kind of ['delete', 'prune'] as const)
  testStable(
    `${kind} acceptance hides claim-owned assessments while retaining unrelated judgments`,
    async () => {
      const f = await documentTransformFixture();
      const handlers = () => MaterialsRpcLive.pipe(Layer.provideMerge(f.domain()));

      try {
        const saved = await Effect.runPromise(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
            const body = deletionDocument('Evidence');
            const evidence = yield* rpc('materials.createManualDocument', {
              title: 'Evidence',
              document: body
            });
            const target = {
              versionId: evidence.version.id,
              documentId: f.context.db.orm
                .select()
                .from(s.material_document_versions)
                .where(eq(s.material_document_versions.version_id, evidence.version.id))
                .get()!.document_id,
              blockId: body.blocks[0]!.id,
              start: 0,
              end: 8
            };
            const claims = [];

            for (const note of ['PRIVATE_CLAIM_NOTE', 'Retained judgment']) {
              const claimBody = deletionDocument('Claim [1]');
              const claim = yield* rpc('materials.create', {
                title: 'Claim',
                content: { kind: 'document', ...claimBody },
                inputs: [evidence.version.id],
                publish: false
              });

              yield* rpc('materials.setCitations', {
                id: claim.version.id,
                citations: [
                  {
                    marker: 1n,
                    inputVersionId: evidence.version.id,
                    target,
                    anchor: { type: 'authored' },
                    quote: 'Evidence'
                  }
                ]
              });
              yield* rpc('materials.publishVersion', { id: claim.version.id });
              yield* rpc('materials.assessCitation', {
                claim: {
                  materialId: claim.id,
                  range: {
                    versionId: claim.version.id,
                    documentId: f.context.db.orm
                      .select()
                      .from(s.material_document_versions)
                      .where(eq(s.material_document_versions.version_id, claim.version.id))
                      .get()!.document_id,
                    blockId: claimBody.blocks[0]!.id,
                    start: 0,
                    end: 5
                  }
                },
                evidence: { materialId: evidence.id, range: target },
                marker: 1n,
                judgment: 'supports',
                note
              });
              claims.push(claim);
            }

            const removed = claims[0]!;

            if (kind === 'prune')
              yield* rpc('materials.createVersion', {
                materialId: removed.id,
                content: { kind: 'document', ...deletionDocument('Current claim') },
                publish: true
              });

            return { removed, kept: claims[1]! };
          }).pipe(Effect.scoped, Effect.provide(handlers()))
        );
        const assertHidden = () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });

              assert.equal(
                (yield* Effect.flip(
                  rpc('materials.citationSupport', {
                    versionId: saved.removed.version.id,
                    marker: 1n
                  })
                )).kind,
                'not_found'
              );
              const kept = yield* rpc('materials.citationSupport', {
                versionId: saved.kept.version.id,
                marker: 1n
              });

              assert.equal(kept.state, 'assessed');
              assert.equal(kept.assessment.note, 'Retained judgment');
            }).pipe(Effect.scoped, Effect.provide(handlers()))
          );
        const operationId = 'assessment-prune';

        if (kind === 'delete') await acceptMaterialDeletion(f, saved.removed.id);
        else await acceptHistory(f, saved.removed.id, operationId);

        const cleanup = () =>
          kind === 'delete' ? cleanupMaterial(f, saved.removed.id) : cleanupHistory(f, operationId);

        await assertHidden();
        f.context.db.orm.run(
          sql`CREATE TRIGGER reject_assessment_cleanup BEFORE DELETE ON blocks BEGIN SELECT RAISE(ABORT, 'injected'); END`
        );
        await assert.rejects(cleanup());
        await assertHidden();
        f.reopen();
        await assertHidden();
        f.context.db.orm.run(sql`DROP TRIGGER reject_assessment_cleanup`);
        await Effect.runPromise(
          Effect.flatMap(Materials, (m) =>
            kind === 'delete'
              ? m.retryDeletion({ materialId: saved.removed.id }).pipe(Effect.asVoid)
              : m.retryHistoryPrune({ operationId }).pipe(Effect.asVoid)
          ).pipe(Effect.provide(f.domain()))
        );
        await cleanup();
        f.reopen();
        await assertHidden();
        assert.equal(
          f.context.db.orm
            .select()
            .from(s.material_citation_assessments)
            .where(eq(s.material_citation_assessments.claim_version_id, saved.removed.version.id))
            .all().length,
          0
        );
      } finally {
        await f.close();
      }
    }
  );
