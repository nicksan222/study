/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises authored Document assessments behavior through real persistence          │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies native authored assessments retain exact judgments, reject foreign passages,  │
 * │   paginate and become stale independently of evidence availability.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { DocumentsRpc } from '@study/contracts/documents/rpc';
import { plainBlock } from '@study/contracts/sources/document';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { assert } from 'vite-plus/test';

import { Documents } from '#server/features/documents/index';
import { DocumentsRpcLive } from '#server/features/documents/rpc/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

const body = (text: string) => ({
  blocks: [plainBlock('paragraph', text, { type: 'authored' })],
  meta: {
    extractor: null,
    extractorVersion: 0,
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
  'native authored assessments retain exact judgments, reject foreign passages, paginate and become stale independently of evidence availability',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const services = Documents.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(DocumentsRpc);
          const evidence = yield* rpc['documents.create']({
            createKey: 'assessment-evidence',
            title: 'Evidence',
            document: body('Evidence 😀'),
            inputs: [],
            citations: []
          });

          assert.ok(evidence.version);
          const exact = evidence.version;
          const input = { kind: 'document' as const, versionId: exact.id };
          const target = { blockId: exact.document.blocks[0]!.id, start: 0, end: 8 };
          const citation = {
            marker: 1,
            input,
            anchor: { type: 'authored' as const },
            target,
            quote: 'Evidence'
          };
          const claim = yield* rpc['documents.create']({
            createKey: 'assessment-claim',
            title: 'Claim',
            document: body('Claim statement'),
            inputs: [input],
            citations: [citation]
          });

          assert.ok(claim.version);
          const version = claim.version;
          const value = {
            claim: {
              documentId: claim.id,
              range: {
                versionId: version.id,
                snapshotId: version.snapshotId,
                blockId: version.document.blocks[0]!.id,
                start: 0,
                end: 5
              }
            },
            evidence: input,
            evidenceRange: target,
            marker: 1,
            judgment: 'contradicts' as const,
            note: 'My explicit reasoning'
          };

          assert.ok(
            (yield* Effect.flip(
              rpc['documents.assessCitation']({ ...value, evidenceRange: { ...target, end: 7 } })
            )).kind === 'invalid_input'
          );
          const first = yield* rpc['documents.assessCitation'](value);
          const second = yield* rpc['documents.assessCitation']({
            ...value,
            judgment: 'uncertain'
          });
          const page = yield* rpc['documents.assessments']({ versionId: version.id, limit: 1 });

          assert.strictEqual(page.items[0]!.id, second.id);
          assert.ok(page.items[0]!.state === 'assessed');
          assert.ok(page.items[0]!.assessment.independentVerification === false);
          assert.strictEqual(page.nextCursor, second.id);
          assert.strictEqual(
            (yield* rpc['documents.assessments']({
              versionId: version.id,
              limit: 1,
              cursor: second.id
            })).items[0]!.id,
            first.id
          );
          yield* rpc['documents.save']({
            documentId: evidence.id,
            expectedVersionId: exact.id,
            key: 'assessment-edit',
            document: {
              ...exact.document,
              blocks: [
                {
                  ...exact.document.blocks[0]!,
                  text: 'Evidence amended',
                  content: {
                    type: 'paragraph',
                    inlines: [{ type: 'text', text: 'Evidence amended', marks: [] }]
                  }
                }
              ]
            }
          });
          const stale = yield* rpc['documents.assessments']({ versionId: version.id, limit: 10 });

          assert.ok(stale.items.every((item) => item.state === 'stale'));
          assert.strictEqual(stale.items[1]!.assessment.note, value.note);
          assert.ok(
            (yield* rpc['documents.version']({ id: exact.id })).document.blocks[0]!.text ===
              'Evidence 😀'
          );
        }).pipe(Effect.scoped, Effect.provide(DocumentsRpcLive.pipe(Layer.provideMerge(services))))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
