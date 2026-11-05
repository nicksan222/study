/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises authored Document citation judgments behavior through real persistence   │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies user judgments pin both rich ranges; claim edits, citation copies and         │
 * │   restoration never inherit verification.                                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { DocumentsRpc } from '@study/contracts/documents/rpc';
import { correctBlockText, createBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Documents } from '#server/features/documents/index';
import { DocumentsRpcLive } from '#server/features/documents/rpc/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

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

const paragraph = (text: string) =>
  createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: ['strong'] }] });

testStable(
  'user judgments pin both rich ranges; claim edits, citation copies and restoration never inherit verification',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const handlers = DocumentsRpcLive.pipe(
      Layer.provideMerge(Documents.layer),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(DocumentsRpc);
            const block = paragraph('Exact evidence');
            const evidence = yield* rpc['documents.create']({
              createKey: randomUUID(),
              title: 'Evidence',
              document: { blocks: [block], meta },
              inputs: [],
              citations: []
            });

            assert.ok(evidence.version);
            const input = { kind: 'document' as const, versionId: evidence.version.id };
            const evidenceRange = { blockId: block.id, start: 0, end: block.text.length };
            const claimBlock = paragraph('Claim [1]');
            const citation = {
              marker: 1,
              input,
              anchor: { type: 'authored' as const },
              target: evidenceRange,
              quote: 'Exact evidence'
            };
            const claim = yield* rpc['documents.create']({
              createKey: randomUUID(),
              title: 'Claim',
              document: { blocks: [claimBlock], meta },
              inputs: [input],
              citations: [citation]
            });

            assert.ok(claim.version);
            const target = {
              documentId: claim.id,
              range: {
                versionId: claim.version.id,
                snapshotId: claim.version.snapshotId,
                blockId: claimBlock.id,
                start: 0,
                end: claimBlock.text.length
              }
            };
            const assessment = {
              claim: target,
              evidence: input,
              evidenceRange,
              marker: 1,
              judgment: 'supports' as const,
              note: 'My judgment'
            };
            const before = context.db.orm
              .select()
              .from(s.study_document_citation_assessments)
              .all();

            assert.strictEqual(
              (yield* rpc['documents.assessments']({
                versionId: claim.version.id,
                marker: 1,
                limit: 10
              })).items.length,
              0
            );

            for (const invalid of [
              { ...assessment, evidenceRange: { ...evidenceRange, end: 5 } },
              { ...assessment, claim: { ...target, documentId: evidence.id } },
              { ...assessment, marker: 2 }
            ]) {
              assert.ok(
                (yield* Effect.flip(rpc['documents.assessCitation'](invalid))).kind ===
                  'invalid_input'
              );
              expect(
                context.db.orm.select().from(s.study_document_citation_assessments).all()
              ).toStrictEqual(before);
            }

            context.db.exec(
              "CREATE TRIGGER reject_assessment_insert AFTER INSERT ON study_document_citation_assessments BEGIN SELECT RAISE(ABORT,'injected failure'); END"
            );
            yield* Effect.flip(rpc['documents.assessCitation'](assessment));
            expect(
              context.db.orm.select().from(s.study_document_citation_assessments).all()
            ).toStrictEqual(before);
            assert.strictEqual(
              (yield* rpc['documents.assessments']({ versionId: claim.version.id, limit: 10 }))
                .items.length,
              0
            );
            context.db.exec('DROP TRIGGER reject_assessment_insert');
            const recorded = yield* rpc['documents.assessCitation'](assessment);

            assert.ok(recorded.assessment.independentVerification === false);
            assert.ok(recorded.assessment.suppliedBy === 'user');
            assert.ok(
              (yield* rpc['documents.assessments']({ versionId: claim.version.id, limit: 10 }))
                .items[0].state === 'assessed'
            );
            const changed = yield* rpc['documents.save']({
              documentId: claim.id,
              expectedVersionId: claim.version.id,
              key: 'claim-edit',
              document: { blocks: [correctBlockText(claimBlock, 'Changed claim [1]')], meta }
            });
            const stale = (yield* rpc['documents.assessments']({
              versionId: claim.version.id,
              marker: 1,
              limit: 10
            })).items[0];

            assert.ok(stale.state === 'stale');
            expect(stale.assessment.claim).toStrictEqual(target);
            assert.strictEqual(
              (yield* rpc['documents.assessments']({
                versionId: changed.submittedVersionId,
                limit: 10
              })).items.length,
              0
            );
            const copied = yield* rpc['documents.version']({ id: changed.submittedVersionId });

            expect(copied.citations).toStrictEqual([citation]);
            expect(copied.inputs).toStrictEqual([input]);
            const restored = yield* rpc['documents.restore']({
              documentId: claim.id,
              expectedVersionId: changed.submittedVersionId,
              restoreVersionId: claim.version.id,
              key: 'claim-restore'
            });

            assert.strictEqual(
              (yield* rpc['documents.assessments']({
                versionId: restored.submittedVersionId,
                limit: 10
              })).items.length,
              0
            );
            const edited = yield* rpc['documents.save']({
              documentId: evidence.id,
              expectedVersionId: evidence.version.id,
              key: 'evidence-edit',
              document: { blocks: [correctBlockText(block, 'Revised evidence')], meta }
            });

            assert.strictEqual(
              (yield* rpc['documents.document']({ id: evidence.id })).headVersionId,
              edited.submittedVersionId
            );
            assert.ok(
              (yield* rpc['documents.assessments']({ versionId: claim.version.id, limit: 10 }))
                .items[0].state === 'stale'
            );
            assert.ok(
              (yield* rpc['documents.version']({ id: input.versionId })).document.blocks[0].text ===
                'Exact evidence'
            );
            const rows = context.db.orm.select().from(s.study_document_citation_assessments).all();

            assert.throws(() => context.db.orm.delete(s.study_document_citation_assessments).run());
            assert.throws(() =>
              context.db.orm
                .update(s.study_document_citation_assessments)
                .set({ payload: '{}' })
                .run()
            );
            const row = rows[0];
            const payload = JSON.parse(row.payload);

            for (const forged of [
              { ...payload, independentVerification: true },
              { ...payload, suppliedBy: 'agent' },
              { ...payload, judgment: null },
              { ...payload, note: null },
              { ...payload, citation: { ...payload.citation, anchor: { type: 'page', page: 1 } } },
              {
                ...payload,
                citation: { ...payload.citation, target: { ...payload.citation.target, start: 1 } }
              }
            ])
              assert.throws(() =>
                context.db.orm
                  .insert(s.study_document_citation_assessments)
                  .values({
                    version_id: row.version_id,
                    marker: row.marker,
                    payload: JSON.stringify(forged)
                  })
                  .run()
              );

            expect(
              context.db.orm.select().from(s.study_document_citation_assessments).all()
            ).toStrictEqual(rows);
            expect(
              (yield* rpc['documents.version']({ id: claim.version.id })).inputs
            ).toStrictEqual([input]);
            const retirement = yield* rpc['documents.previewDeletion']({ id: claim.id });

            yield* rpc['documents.delete']({ documentId: claim.id, token: retirement.token });
            assert.strictEqual(
              context.db.orm.select().from(s.study_document_citation_assessments).all().length,
              0
            );
            expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
          }).pipe(Effect.provide(handlers))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
