import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { StudyDocumentVersion } from '@study/contracts/documents/types';
import type { documentGenerationRequestedSchema } from '@study/contracts/events';
import { createBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import { testStable } from '@study/testing/node';
import { Effect } from 'effect';
import type { Context } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import { Sources } from '#server/features/sources/index';
import { decodeEvent } from '#server/platform/workflows/events';
import { documentTransformFixture } from '#testing/document-transform';
import { makeMaterialOutput } from '#testing/material-output';
import { cleanup } from '#testing/session-deletion';

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
type Fixture = Awaited<ReturnType<typeof documentTransformFixture>>;
function generationEvent(
  f: Fixture,
  requestId: string
): typeof documentGenerationRequestedSchema.Type {
  const row = f.context.db.orm.get(
    sql`SELECT payload FROM workflow_events WHERE type='DocumentGenerationRequested' AND correlation_id=${requestId} ORDER BY rowid DESC LIMIT 1`
  );
  assert.ok(row);
  const event = decodeEvent(String(row.payload));
  assert.equal(event.type, 'DocumentGenerationRequested');
  return event;
}
function create(title: string, blocks = [paragraph('alpha evidence')]) {
  return Effect.flatMap(Documents, (docs) =>
    docs.create({
      createKey: randomUUID(),
      title,
      document: { blocks, meta },
      inputs: [],
      citations: []
    })
  ).pipe(
    Effect.map((value) => {
      assert.ok(value.version);
      return { ...value, version: value.version };
    })
  );
}
function assertIndependentImage(independent: StudyDocumentVersion, proposal: StudyDocumentVersion) {
  assert.notEqual(independent.documentId, proposal.documentId);
  assert.deepEqual(independent.document.blocks[1]!.content, proposal.document.blocks[1]!.content);
  assert.notEqual(independent.document.blocks[1]!.id, proposal.document.blocks[1]!.id);
}
function assessApplied(version: StudyDocumentVersion) {
  return Effect.gen(function* () {
    const docs = yield* Documents;
    const cited = version.citations[0];
    assert.ok(cited?.target);
    const claimBlock = version.document.blocks[0]!;
    const assessment = yield* docs.assessCitation({
      claim: {
        documentId: version.documentId,
        range: {
          versionId: version.id,
          snapshotId: version.snapshotId,
          blockId: claimBlock.id,
          start: 0,
          end: claimBlock.text.length
        }
      },
      evidence: cited.input,
      evidenceRange: cited.target,
      marker: cited.marker,
      judgment: 'uncertain',
      note: 'Manual judgment'
    });
    assert.equal(assessment.assessment.suppliedBy, 'user');
    assert.equal(assessment.assessment.independentVerification, false);
    return assessment;
  });
}
function assertSupport(
  docs: Context.Service.Shape<typeof Documents>,
  versionId: StudyDocumentVersion['id'],
  state: 'assessed' | 'stale' | undefined
) {
  return docs
    .assessments({ versionId, marker: 1, limit: 10 })
    .pipe(Effect.map((page) => assert.equal(page.items[0]?.state, state)));
}
type Scenario =
  | 'apply'
  | 'target_changed'
  | 'input_changed'
  | 'selection_changed'
  | 'message_changed';
function changeRelevantContext(
  scenario: Scenario,
  target: StudyDocumentVersion,
  input: StudyDocumentVersion,
  context: {
    sessionId: typeof import('@study/contracts/ids').sessionIdSchema.Type;
    selectionRevision: bigint;
    messageId: typeof import('@study/contracts/ids').messageIdSchema.Type;
  }
) {
  return Effect.gen(function* () {
    const docs = yield* Documents;
    const chats = yield* Conversations;
    if (scenario === 'target_changed' || scenario === 'input_changed') {
      const version = scenario === 'target_changed' ? target : input;
      yield* docs.save({
        documentId: version.documentId,
        expectedVersionId: version.id,
        key: scenario,
        document: { blocks: [paragraph('Concurrent content')], meta }
      });
    }
    if (scenario === 'selection_changed')
      yield* chats.updateSessionSelection({
        sessionId: context.sessionId,
        expectedRevision: context.selectionRevision,
        targets: []
      });
    if (scenario === 'message_changed')
      yield* chats.editMessage({ messageId: context.messageId, text: 'Concurrent qualification' });
  });
}
for (const scenario of [
  'apply',
  'target_changed',
  'input_changed',
  'selection_changed',
  'message_changed'
] as const)
  testStable(
    `native authored proposal ${scenario} preserves exact receipts, alternatives, citations and independent retention`,
    async () => {
      const f = await documentTransformFixture();
      try {
        const setup = await Effect.runPromise(
          Effect.gen(function* () {
            const chats = yield* Conversations;
            const sources = yield* Sources;
            const session = yield* chats.createUntitledSession({});
            const message = yield* chats.postMessage({
              sessionId: session.id,
              text: 'alpha question'
            });
            const image = yield* sources.createSource({
              projectId: null,
              name: 'pixel.png',
              bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
            });
            const imageBlock = createBlock({
              type: 'image',
              sourceId: image.id,
              revision: 1,
              alt: ''
            });
            const target = yield* create('Target', [paragraph('alpha target'), imageBlock]);
            const input = yield* create('Evidence');
            yield* chats.updateSessionSelection({
              sessionId: session.id,
              expectedRevision: 0n,
              targets: [target, input].map((value) => ({
                input: { kind: 'document' as const, versionId: value.version.id },
                scope: { kind: 'document' as const }
              }))
            });
            const context = yield* chats.captureSessionContext({
              sessionId: session.id,
              intentKey: 'proposal',
              instruction: 'Clarify',
              preferences: {}
            });
            const request = yield* chats.requestDocumentTransform({
              title: 'Proposal',
              contextRequestId: context.requestId,
              operations: ['clarity'],
              editTargetVersionId: target.version.id
            });
            return { session, message, image, target, input, context, request, imageBlock };
          }).pipe(Effect.provide(f.domain()))
        );
        f.replies.push(
          { kind: 'sources', query: 'alpha target' },
          {
            kind: 'output',
            output: {
              blocks: [
                {
                  type: 'paragraph',
                  inlines: [{ type: 'text', text: 'Clear alpha [1]', marks: [] }]
                },
                { type: 'image', sourceId: String(setup.image.id), revision: 1, alt: '' }
              ],
              notes: [
                {
                  kind: 'limit',
                  explanation: 'Textual revision only; no independent verification',
                  blockOrdinals: []
                }
              ]
            }
          }
        );
        const event = generationEvent(f, setup.request.id);
        const proposalId = await f.executeAuthored(event, `proposal-${scenario}`);
        assert.equal(
          f.context.db.orm.get(
            sql`SELECT result_version_id FROM study_document_transform_requests WHERE id=${setup.request.id}`
          )?.result_version_id,
          proposalId
        );
        assert.equal(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
        assert.ok(f.bodies[0]!.includes('editable_target'));
        assert.ok(f.bodies[0]!.includes('supporting_evidence'));
        const outcomes = await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;
            const chats = yield* Conversations;
            const proposal = yield* docs.version({ id: proposalId });
            assert.equal(proposal.status, 'draft');
            assert.equal(proposal.documentId, setup.target.id);
            assert.equal(proposal.document.blocks[1]!.id, setup.imageBlock.id);
            assert.equal(
              (yield* docs.document({ id: setup.target.id })).headVersionId,
              setup.target.version.id
            );
            assert.ok(proposal.citations.length > 0);
            assert.deepEqual(proposal.citations[0]!.input, {
              kind: 'document',
              versionId: setup.target.version.id
            });
            for (const mutation of [
              sql`DELETE FROM document_assets WHERE document_id=${proposal.snapshotId}`,
              sql`DELETE FROM study_document_citations WHERE version_id=${proposalId}`,
              sql`UPDATE blocks SET text='forged' WHERE document_id=${proposal.snapshotId}`
            ])
              assert.throws(() => f.context.db.orm.run(mutation));
            yield* changeRelevantContext(scenario, setup.target.version, setup.input.version, {
              sessionId: setup.session.id,
              selectionRevision: setup.context.selectionRevision,
              messageId: setup.message.id
            });
            const value = {
              requestId: setup.request.id,
              key: 'apply',
              expectedVersionId: setup.target.version.id
            };
            const output = makeMaterialOutput({ db: f.context.db, clock: f.context.clock });
            const before = output();
            for (const invalid of [
              { ...value, key: 'wrong-expected', expectedVersionId: setup.input.version.id }
            ]) {
              assert.equal(
                (yield* Effect.flip(chats.applyDocumentProposal(invalid))).kind,
                'invalid_input'
              );
              assert.deepEqual(output(), before);
            }
            if (scenario === 'apply') {
              f.context.db.exec(
                "CREATE TRIGGER reject_proposal_event BEFORE INSERT ON workflow_events WHEN NEW.type='DocumentPublished' BEGIN SELECT RAISE(ABORT,'injected apply failure'); END"
              );
              yield* Effect.flip(chats.applyDocumentProposal(value));
              assert.deepEqual(output(), before);
              f.context.db.exec('DROP TRIGGER reject_proposal_event');
            }
            const result = yield* chats.applyDocumentProposal(value);
            assert.equal(result.outcome, scenario === 'apply' ? 'applied' : 'conflict');
            const after = output();
            assert.equal((yield* chats.applyDocumentProposal(value)).replayed, true);
            assert.deepEqual(output(), after);
            assert.equal(
              (yield* Effect.flip(
                chats.keepDocumentProposal({
                  requestId: value.requestId,
                  key: value.key,
                  title: 'Independent'
                })
              )).kind,
              'invalid_input'
            );
            assert.equal(
              (yield* Effect.flip(
                chats.applyDocumentProposal({ ...value, expectedVersionId: setup.input.version.id })
              )).kind,
              'invalid_input'
            );
            const compare = yield* docs.compareProposal({ requestId: setup.request.id });
            assert.equal(compare.beforeVersionId, setup.target.version.id);
            assert.equal(compare.proposedVersionId, proposalId);
            assert.equal(compare.evidence, 'structural_only');
            if (scenario === 'apply') {
              const beforeKeep = output();
              f.context.db.exec(
                "CREATE TRIGGER reject_keep_event BEFORE INSERT ON workflow_events WHEN NEW.type='DocumentPublished' BEGIN SELECT RAISE(ABORT,'injected keep failure'); END"
              );
              yield* Effect.flip(
                chats.keepDocumentProposal({
                  requestId: setup.request.id,
                  key: 'keep',
                  title: 'Independent'
                })
              );
              assert.deepEqual(output(), beforeKeep);
              f.context.db.exec('DROP TRIGGER reject_keep_event');
              assert.equal(
                (yield* Effect.flip(chats.applyDocumentProposal({ ...value, key: 'second-apply' })))
                  .kind,
                'invalid_input'
              );
            }
            const kept = yield* chats.keepDocumentProposal({
              requestId: setup.request.id,
              key: 'keep',
              title: 'Independent'
            });
            assert.equal(kept.outcome, 'kept');
            assert.ok(kept.resultVersionId);
            const independent = yield* docs.version({ id: kept.resultVersionId });
            assertIndependentImage(independent, proposal);
            assert.deepEqual(independent.inputs, proposal.inputs);
            assert.deepEqual(independent.citations, proposal.citations);
            assert.equal(
              (yield* chats.keepDocumentProposal({
                requestId: setup.request.id,
                key: 'keep',
                title: 'Independent'
              })).replayed,
              true
            );
            yield* assertSupport(docs, independent.id, undefined);
            assert.equal(
              (yield* Effect.flip(
                chats.keepDocumentProposal({
                  requestId: setup.request.id,
                  key: 'second-keep',
                  title: 'Independent'
                })
              )).kind,
              'invalid_input'
            );
            assert.throws(() =>
              f.context.db.orm.run(
                sql`UPDATE study_document_generation_requests SET intent_hash='forged' WHERE id=${setup.request.id}`
              )
            );
            const cited = independent.citations[0]!;
            assert.ok(cited.input.kind === 'document');
            const exact = yield* docs.version({ id: cited.input.versionId });
            assert.ok(exact.document.blocks.some((block) => block.text.includes(cited.quote)));

            if (result.resultVersionId) {
              const applied = yield* docs.version({ id: result.resultVersionId });
              assert.equal(applied.document.blocks[1]!.id, setup.imageBlock.id);
              assert.deepEqual(applied.citations, proposal.citations);
              assert.deepEqual(applied.parents, [setup.target.version.id]);
              yield* assessApplied(applied);
              yield* assertSupport(docs, applied.id, 'stale');
              const restore = {
                documentId: setup.target.id,
                expectedVersionId: applied.id,
                restoreVersionId: setup.target.version.id,
                key: 'restore'
              };
              const restored = yield* docs.restore(restore);
              assert.equal(restored.outcome, 'saved');
              yield* assertSupport(docs, restored.submittedVersionId, undefined);
              yield* assertSupport(docs, applied.id, 'stale');
              assert.equal((yield* docs.restore(restore)).replayed, true);
            }
            return { independentId: independent.id, resultVersionId: result.resultVersionId };
          }).pipe(Effect.provide(f.domain()))
        );
        f.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;
            const chats = yield* Conversations;
            assert.equal((yield* docs.version({ id: outcomes.independentId })).status, 'published');
            assert.equal(
              (yield* chats.keepDocumentProposal({
                requestId: setup.request.id,
                key: 'keep',
                title: 'Independent'
              })).replayed,
              true
            );
            if (outcomes.resultVersionId)
              yield* assertSupport(docs, outcomes.resultVersionId, 'stale');
          }).pipe(Effect.provide(f.domain()))
        );
        await Effect.runPromise(
          Effect.flatMap(Conversations, (chats) => chats.deleteSession(setup.session.id)).pipe(
            Effect.provide(f.domain())
          )
        );
        await cleanup(f, setup.session.id);
        const calls = f.bodies.length;
        await assert.rejects(f.executeAuthored(event, `retired-${scenario}`));
        assert.equal(f.bodies.length, calls);
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;
            assert.equal((yield* docs.version({ id: outcomes.independentId })).status, 'published');
          }).pipe(Effect.provide(f.domain()))
        );
        assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
      } finally {
        await f.close();
      }
    }
  );

for (const barrier of ['cancel', 'delete'] as const)
  testStable(
    `authored proposal ${barrier} before native execution fences late publication`,
    async () => {
      const f = await documentTransformFixture();
      try {
        const request = await Effect.runPromise(
          Effect.gen(function* () {
            const chats = yield* Conversations;
            const docs = yield* Documents;
            const session = yield* chats.createSession({ title: 'Fence' });
            const target = yield* create('Target');
            yield* chats.updateSessionSelection({
              sessionId: session.id,
              expectedRevision: 0n,
              targets: [
                {
                  input: { kind: 'document', versionId: target.version.id },
                  scope: { kind: 'document' }
                }
              ]
            });
            const context = yield* chats.captureSessionContext({
              sessionId: session.id,
              intentKey: barrier,
              instruction: '',
              preferences: {}
            });
            const request = yield* chats.requestDocumentTransform({
              title: 'Proposal',
              contextRequestId: context.requestId,
              operations: ['structure'],
              editTargetVersionId: target.version.id
            });
            if (barrier === 'delete') yield* chats.deleteSession(session.id);
            else yield* docs.cancelTransform({ requestId: request.id });
            return request;
          }).pipe(Effect.provide(f.domain()))
        );
        await assert.rejects(
          f.executeAuthored(generationEvent(f, request.id), `barrier-${barrier}`)
        );
        assert.equal(f.bodies.length, 0);
        assert.equal(
          f.context.db.orm.get(sql`SELECT count(*) n FROM study_document_proposals`)?.n,
          0n
        );
        assert.equal(f.context.db.orm.get(sql`SELECT count(*) n FROM study_documents`)?.n, 1n);
        assert.equal(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
      } finally {
        await f.close();
      }
    }
  );

testStable(
  'a captured block or passage cannot broaden into a whole authored target edit',
  async () => {
    const f = await documentTransformFixture();
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;
          const session = yield* chats.createUntitledSession({});
          const block = paragraph('alpha selected omega');
          const target = yield* create('Target', [block]);
          const input = { kind: 'document' as const, versionId: target.version.id };
          yield* chats.updateSessionSelection({
            sessionId: session.id,
            expectedRevision: 0n,
            targets: [{ input, scope: { kind: 'document' } }]
          });
          const scopes = [
            { kind: 'ranges', ranges: [{ blockId: block.id, start: 6, end: 14 }] },
            { kind: 'blocks', blockIds: [block.id] }
          ] as const;
          for (const [index, scope] of scopes.entries()) {
            yield* chats.updateSessionSelection({
              sessionId: session.id,
              expectedRevision: BigInt(index + 1),
              targets: [{ input, scope }]
            });
            const context = yield* chats.captureSessionContext({
              sessionId: session.id,
              intentKey: scope.kind,
              instruction: 'Clarify',
              preferences: {}
            });
            assert.equal(
              (yield* Effect.flip(
                chats.requestDocumentTransform({
                  title: 'Unsafe broadening',
                  contextRequestId: context.requestId,
                  operations: ['clarity'],
                  editTargetVersionId: target.version.id
                })
              )).kind,
              'invalid_input'
            );
          }
          assert.equal(
            f.context.db.orm.get(sql`SELECT count(*) n FROM study_document_transform_requests`)?.n,
            0n
          );
          assert.equal(f.bodies.length, 0);
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);
