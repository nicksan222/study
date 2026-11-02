/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises session proposals through the controlled native generation path.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Covers application, keep, undo, changed inputs and publication fences.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Execution status: UNRUN pending CI; uses the shared provider fixture.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  MaterialId,
  MaterialVersionId,
  SessionId,
  MessageId,
  SourceId
} from '@study/contracts/ids';
import type {
  materialVersionDetailSchema,
  materialCitationSchema
} from '@study/contracts/materials/schemas';
import type { Block } from '@study/contracts/sources/document';
import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Effect } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import { Sources } from '#server/features/sources/index';
import { documentTransformFixture } from '#testing/document-transform';
import { makeMaterialOutput } from '#testing/material-output';
import { withTestPublication } from '#testing/publication';

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

type Scenario =
  | 'apply'
  | 'target_changed'
  | 'input_changed'
  | 'selection_changed'
  | 'message_changed';

type ProposalSetup = {
  target: { id: MaterialId; version: { id: MaterialVersionId } };
  input: { id: MaterialId; version: { id: MaterialVersionId } };
  session: { id: SessionId };
  context: { selectionRevision: bigint };
  message: { id: MessageId };
};

function changeRelevantContext(scenario: Scenario, setup: ProposalSetup) {
  return Effect.gen(function* () {
    const materials = yield* Materials;

    const chats = yield* Conversations;

    if (scenario === 'target_changed' || scenario === 'input_changed') {
      const target = scenario === 'target_changed' ? setup.target : setup.input;

      yield* materials.saveDocument({
        materialId: target.id,
        expectedVersionId: target.version.id,
        saveKey: scenario,
        document: { blocks: [paragraph('Concurrent content')], meta }
      });
    }

    if (scenario === 'selection_changed')
      yield* chats.updateSessionSelection({
        sessionId: setup.session.id,
        expectedRevision: setup.context.selectionRevision,
        targets: []
      });

    if (scenario === 'message_changed')
      yield* chats.editMessage({ messageId: setup.message.id, text: 'Concurrent qualification' });
  });
}

function assertIndependentImage(
  independent: typeof materialVersionDetailSchema.Type,
  proposal: typeof materialVersionDetailSchema.Type,
  imageId: SourceId
) {
  assert.equal(independent.kind, 'document');

  if (independent.kind !== 'document' || proposal.kind !== 'document')
    throw new Error('Missing rich Document');

  assert.deepEqual(independent.content.blocks[1]!.content, {
    type: 'image',
    sourceId: imageId,
    revision: 1,
    alt: ''
  });

  assert.notEqual(independent.content.blocks[1]!.id, proposal.content.blocks[1]!.id);
}

function assessAppliedCitation(
  applied: typeof materialVersionDetailSchema.Type,
  cited: typeof materialCitationSchema.Type
) {
  return Effect.gen(function* () {
    const materials = yield* Materials;

    if (applied.content.kind !== 'document') throw new Error('Missing applied Document');

    if (!cited.target || cited.evidence?.availability !== 'available')
      throw new Error('Expected exact proposal citation');

    const claimBlock = applied.content.blocks[0]!;
    const claimEvidence = yield* materials.resolveEvidence({
      kind: 'anchor',
      versionId: applied.id,
      anchor: { type: 'authored' },
      quote: ''
    });

    if (
      claimEvidence.availability !== 'available' ||
      claimEvidence.revision.inputDocumentId === null
    )
      throw new Error('Expected retained applied Document');

    const assessed = yield* materials.assessCitation({
      claim: {
        materialId: applied.material_id,
        range: {
          versionId: applied.id,
          documentId: claimEvidence.revision.inputDocumentId,
          blockId: claimBlock.id,
          start: 0,
          end: claimBlock.text.length
        }
      },
      evidence: { materialId: cited.evidence.materialId, range: cited.target },
      marker: 1n,
      judgment: 'uncertain',
      note: 'Manual judgment on the applied revision'
    });

    assert.notEqual(assessed.state, 'unassessed');

    if (assessed.state !== 'unassessed') {
      assert.equal(assessed.claim.availability, 'available');
      assert.equal(assessed.evidence.availability, 'available');
      assert.equal(assessed.assessment.suppliedBy, 'user');
      assert.equal(assessed.assessment.independentVerification, false);
    }

    return assessed;
  });
}

function assertHistoricProposalEvidence(cited: typeof materialCitationSchema.Type) {
  return Effect.gen(function* () {
    const materials = yield* Materials;

    if (cited.target && cited.evidence?.availability === 'available') {
      const historical = yield* materials.resolveEvidence({
        kind: 'range',
        target: { materialId: cited.evidence.materialId, range: cited.target }
      });

      assert.equal(historical.availability, 'available');

      if (historical.availability === 'available')
        assert.equal(historical.excerpt?.includes(cited.quote), true);
    }
  });
}

function undoAppliedProposal(
  setup: ProposalSetup & { imageBlock: { id: Block['id'] } },
  proposalId: MaterialVersionId,
  resultVersionId: MaterialVersionId | null
) {
  return Effect.gen(function* () {
    if (resultVersionId === null) return;

    const materials = yield* Materials;

    const applied = yield* materials.materialVersion({ id: resultVersionId });

    if (applied.content.kind !== 'document') throw new Error('Missing applied Document');

    assert.equal(applied.content.blocks[1]!.id, setup.imageBlock.id);

    assert.deepEqual(
      (yield* materials.citations({ id: applied.id, limit: 10 })).items,
      (yield* materials.citations({ id: proposalId, limit: 10 })).items
    );

    const cited = (yield* materials.citations({ id: applied.id, limit: 10 })).items[0]!;

    assert.equal(cited.support?.state, 'unassessed');
    assert.equal(cited.evidence?.availability, 'available');

    assert.deepEqual(applied.parents, [setup.target.version.id]);

    const assessed = yield* assessAppliedCitation(applied, cited);

    const value = {
      materialId: setup.target.id,
      expectedVersionId: resultVersionId,
      restoreVersionId: setup.target.version.id,
      undoKey: 'undo'
    };

    const undo = yield* materials.undoDocument(value);

    assert.equal(undo.outcome, 'saved');

    assert.equal(
      (yield* materials.citationSupport({ versionId: undo.submittedVersionId, marker: 1n })).state,
      'unassessed'
    );

    yield* assertHistoricProposalEvidence(cited);

    const historicSupport = yield* materials.citationSupport({ versionId: applied.id, marker: 1n });

    assert.equal(historicSupport.state, 'stale');

    if (assessed.state !== 'unassessed') {
      assert.ok(historicSupport.reasons.includes('claim_changed'));
      assert.deepEqual(historicSupport.assessment, assessed.assessment);
      assert.equal(historicSupport.evidence.availability, 'available');
    }

    assert.equal((yield* materials.undoDocument(value)).replayed, true);
  });
}

for (const scenario of [
  'apply',
  'target_changed',
  'input_changed',
  'selection_changed',
  'message_changed'
] as const) {
  test(`native proposal ${scenario}: exact receipt, comparison, keep and guarded undo`, async () => {
    const f = await documentTransformFixture();

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials;

          const chats = yield* Conversations;

          const session = yield* chats.createSession({ title: 'Editing' });

          const message = yield* chats.postMessage({
            sessionId: session.id,
            text: 'Preserve this qualification',
            requestReply: false
          });

          const image = yield* (yield* Sources).createSource({
            projectId: null,
            name: 'managed.png',
            bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
          });

          const imageBlock = createBlock({
            type: 'image',
            sourceId: image.id,
            revision: 1,
            alt: ''
          });

          const target = yield* materials.createManualDocument({
            title: 'Target',
            document: { blocks: [paragraph('alpha target'), imageBlock], meta }
          });

          const input = yield* materials.createManualDocument({
            title: 'Evidence',
            document: { blocks: [paragraph('alpha evidence')], meta }
          });

          yield* chats.updateSessionSelection({
            sessionId: session.id,
            expectedRevision: 0n,
            targets: [target, input].map((material) => ({
              versionId: material.version.id,
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

          return { session, message, target, input, context, request, image, imageBlock };
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

      const event = f.event(setup.request.id);

      const proposalId = await f.execute(event, `proposal-${scenario}`);

      const receipt = f.context.db.orm
        .select()
        .from(s.material_generation_requests)
        .where(eq(s.material_generation_requests.id, setup.request.id))
        .get()!;

      const retainedProposal = f.context.db.orm
        .select()
        .from(s.document_proposals)
        .where(eq(s.document_proposals.request_id, setup.request.id))
        .get()!;

      await Effect.runPromise(
        Effect.gen(function* () {
          const page = yield* (yield* Conversations).sessionGenerations({
            sessionId: setup.session.id,
            limit: 10
          });
          const discovered = page.items.find((item) => item.requestId === setup.request.id);
          assert.ok(discovered);
          assert.equal(discovered.contextRequestId, setup.context.requestId);
          assert.equal(discovered.resultVersionId, proposalId);
          assert.equal(discovered.proposedVersionId, proposalId);
          assert.equal(discovered.baseVersionId, setup.target.version.id);
        }).pipe(Effect.provide(f.domain()))
      );
      assert.equal(receipt.result_version_id, proposalId);

      assert.match(receipt.result_hash!, /^[0-9a-f]{64}$/);

      assert.ok(receipt.result_metadata);

      assert.deepEqual(retainedProposal, {
        request_id: setup.request.id,
        session_id: setup.session.id,
        base_version_id: setup.target.version.id,
        proposed_version_id: proposalId
      });

      assert.equal(f.context.db.orm.select().from(s.materials).all().length, 3);

      const targetPrompt = JSON.stringify(
        {
          materialId: setup.target.id,
          versionId: setup.target.version.id,
          documentId: setup.context.inputs[0]!.documentId,
          document: setup.context.inputs[0]!.document
        },
        (_, value: unknown) => (typeof value === 'bigint' ? String(value) : value)
      );

      assert.ok(f.bodies[0]!.includes(JSON.stringify(targetPrompt).slice(1, -1)));

      assert.ok(f.bodies[0]!.includes('editable_target'));

      assert.ok(f.bodies[0]!.includes('supporting_evidence'));

      const outcomes = await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials;

          const chats = yield* Conversations;

          const proposal = yield* materials.materialVersion({ id: proposalId });

          assert.equal(proposal.status, 'draft');

          assert.equal(proposal.material_id, setup.target.id);

          const proposalDocument = f.context.db.orm
            .select()
            .from(s.material_document_versions)
            .where(eq(s.material_document_versions.version_id, proposalId))
            .get()!;

          assert.equal(
            f.context.db.orm
              .select()
              .from(s.document_edit_receipts)
              .where(eq(s.document_edit_receipts.submitted_version_id, proposalId))
              .all().length,
            0
          );

          assert.throws(() =>
            f.context.db.orm.run(
              sql`DELETE FROM document_assets WHERE document_id=${proposalDocument.document_id}`
            )
          );

          assert.throws(() =>
            f.context.db.orm.run(
              sql`DELETE FROM material_version_citations WHERE version_id=${proposalId}`
            )
          );

          if (proposal.content.kind !== 'document') throw new Error('Missing proposal Document');

          assert.equal(proposal.content.blocks[1]!.id, setup.imageBlock.id);

          assert.equal(
            (yield* materials.material({ id: setup.target.id })).latestPublishedVersion?.id,
            setup.target.version.id
          );

          assert.deepEqual(
            (yield* materials.citations({ id: proposalId, limit: 10 })).items[0]?.target?.versionId,
            setup.target.version.id
          );

          yield* changeRelevantContext(scenario, setup);

          const value = {
            requestId: setup.request.id,
            key: 'apply',
            expectedVersionId: setup.target.version.id,
            baseVersionId: setup.target.version.id
          };

          const output = makeMaterialOutput({ db: f.context.db, clock: f.context.clock });

          const beforeApplication = output();

          for (const invalid of [
            { ...value, key: 'wrong-base', baseVersionId: setup.input.version.id },
            { ...value, key: 'wrong-expected', expectedVersionId: setup.input.version.id }
          ]) {
            assert.equal(
              (yield* Effect.flip(chats.applyDocumentProposal(invalid))).kind,
              'invalid_input'
            );

            assert.deepEqual(output(), beforeApplication);
          }

          function assertApplicationRollback() {
            return Effect.gen(function* () {
              if (scenario === 'apply') {
                f.context.db.orm.run(
                  sql`CREATE TRIGGER reject_proposal_event BEFORE INSERT ON workflow_events WHEN NEW.type='MaterialPublished' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END`
                );

                yield* Effect.flip(chats.applyDocumentProposal(value));

                assert.deepEqual(output(), beforeApplication);

                f.context.db.orm.run(sql`DROP TRIGGER reject_proposal_event`);
              }
            });
          }

          yield* assertApplicationRollback();

          const result = yield* chats.applyDocumentProposal(value);

          assert.equal(result.outcome, scenario === 'apply' ? 'applied' : 'conflict');

          const afterApplication = output();

          if (result.outcome === 'applied')
            assert.equal(
              (yield* Effect.flip(chats.applyDocumentProposal({ ...value, key: 'second-apply' })))
                .kind,
              'invalid_input'
            );

          assert.equal((yield* chats.applyDocumentProposal(value)).replayed, true);

          assert.deepEqual(output(), afterApplication);

          assert.equal(
            (yield* Effect.flip(
              chats.keepDocumentProposal({ requestId: value.requestId, key: value.key })
            )).kind,
            'invalid_input'
          );

          assert.equal(
            (yield* Effect.flip(
              chats.applyDocumentProposal({ ...value, baseVersionId: setup.input.version.id })
            )).kind,
            'invalid_input'
          );

          const compare = yield* chats.compareDocumentProposal({ requestId: setup.request.id });

          assert.equal(compare.beforeVersionId, setup.target.version.id);

          assert.equal(compare.proposedVersionId, proposalId);

          assert.equal(compare.evidence, 'structural_only');

          assert.ok(
            !compare.proposedChanges.some((change) => change.blockId === setup.imageBlock.id)
          );

          if (scenario === 'apply') {
            const beforeKeep = output();

            f.context.db.orm.run(
              sql`CREATE TRIGGER reject_keep_event BEFORE INSERT ON workflow_events WHEN NEW.type='MaterialPublished' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END`
            );

            yield* Effect.flip(
              chats.keepDocumentProposal({ requestId: setup.request.id, key: 'keep' })
            );

            assert.deepEqual(output(), beforeKeep);

            f.context.db.orm.run(sql`DROP TRIGGER reject_keep_event`);
          }

          const kept = yield* chats.keepDocumentProposal({
            requestId: setup.request.id,
            key: 'keep'
          });

          assert.equal(kept.outcome, 'kept');

          assert.ok(kept.resultVersionId);

          const independent = yield* materials.materialVersion({ id: kept.resultVersionId! });

          const independentCitations = (yield* materials.citations({
            id: independent.id,
            limit: 10
          })).items;

          assert.equal(independentCitations[0]?.support?.state, 'unassessed');
          assert.equal(independentCitations[0]?.evidence?.availability, 'available');

          assert.notEqual(independent.material_id, setup.target.id);

          assertIndependentImage(independent, proposal, setup.image.id);

          assert.deepEqual(
            (yield* materials.citations({ id: independent.id, limit: 10 })).items,
            (yield* materials.citations({ id: proposalId, limit: 10 })).items
          );

          assert.equal(
            (yield* chats.keepDocumentProposal({ requestId: setup.request.id, key: 'keep' }))
              .resultVersionId,
            kept.resultVersionId
          );

          assert.equal(
            (yield* Effect.flip(
              chats.keepDocumentProposal({ requestId: setup.request.id, key: 'second-keep' })
            )).kind,
            'invalid_input'
          );

          assert.equal(f.context.db.orm.select().from(s.materials).all().length, 4);

          yield* undoAppliedProposal(setup, proposalId, result.resultVersionId);
          assert.equal(
            (yield* materials.citationSupport({ versionId: independent.id, marker: 1n })).state,
            'unassessed'
          );
          assert.equal(
            (yield* materials.citationSupport({ versionId: proposalId, marker: 1n })).state,
            'unassessed'
          );

          return {
            independentId: independent.id,
            applyValue: value,
            resultVersionId: result.resultVersionId
          };
        }).pipe(Effect.provide(f.domain()))
      );

      f.reopen();

      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations,
            materials = yield* Materials;

          assert.equal(
            (yield* chats.applyDocumentProposal(outcomes.applyValue)).resultVersionId,
            outcomes.resultVersionId
          );

          assert.equal(
            (yield* chats.keepDocumentProposal({ requestId: setup.request.id, key: 'keep' }))
              .resultVersionId,
            outcomes.independentId
          );

          if (outcomes.resultVersionId !== null)
            assert.equal(
              (yield* materials.citationSupport({
                versionId: outcomes.resultVersionId,
                marker: 1n
              })).state,
              'stale'
            );

          assert.equal(
            (yield* materials.citationSupport({ versionId: outcomes.independentId, marker: 1n }))
              .state,
            'unassessed'
          );
          yield* chats.deleteSession(setup.session.id);

          assert.equal(
            (yield* chats.keepDocumentProposal({ requestId: setup.request.id, key: 'keep' }))
              .resultVersionId,
            outcomes.independentId
          );

          assert.equal(
            (yield* chats.applyDocumentProposal(outcomes.applyValue)).resultVersionId,
            outcomes.resultVersionId
          );

          assert.equal(
            (yield* materials.materialVersion({ id: outcomes.independentId })).status,
            'published'
          );

          assert.equal(
            (yield* Effect.flip(
              chats.keepDocumentProposal({ requestId: setup.request.id, key: 'after-delete' })
            )).kind,
            'not_found'
          );
          yield* withTestPublication(
            f.context,
            chats
              .finishSessionDeletion({ sessionId: setup.session.id, attempt: 1 })
              .pipe(Effect.asVoid)
          );
          assert.equal(
            (yield* materials.materialVersion({ id: outcomes.independentId })).status,
            'published'
          );

          if (outcomes.resultVersionId !== null)
            assert.equal(
              (yield* materials.citationSupport({
                versionId: outcomes.resultVersionId,
                marker: 1n
              })).state,
              'stale'
            );
        }).pipe(Effect.provide(f.domain()))
      );

      await assert.rejects(f.execute(event, `proposal-replay-${scenario}`));

      assert.equal(f.bodies.length, 2);

      assert.equal(
        f.context.db.orm
          .select()
          .from(s.document_proposals)
          .where(eq(s.document_proposals.request_id, setup.request.id))
          .all().length,
        0
      );
    } finally {
      await f.close();
    }
  });
}

for (const barrier of ['cancel', 'delete'] as const) {
  test(`proposal ${barrier} before native execution cannot publish late content`, async () => {
    const f = await documentTransformFixture();

    try {
      const request = await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials,
            chats = yield* Conversations;

          const session = yield* chats.createSession({ title: 'Fence' });

          const target = yield* materials.createManualDocument({
            title: 'Target',
            document: { blocks: [paragraph('alpha')], meta }
          });

          yield* chats.updateSessionSelection({
            sessionId: session.id,
            expectedRevision: 0n,
            targets: [{ versionId: target.version.id, scope: { kind: 'document' } }]
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
          else yield* materials.cancelMaterialGeneration({ requestId: request.id });

          return request;
        }).pipe(Effect.provide(f.domain()))
      );

      await assert.rejects(f.execute(f.event(request.id), `barrier-${barrier}`));

      assert.equal(f.bodies.length, 0);

      assert.equal(f.context.db.orm.select().from(s.document_proposals).all().length, 0);

      assert.equal(f.context.db.orm.select().from(s.materials).all().length, 1);
    } finally {
      await f.close();
    }
  });
}

test('a captured passage cannot silently broaden into a whole-Document target edit', async () => {
  const f = await documentTransformFixture();

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials,
          chats = yield* Conversations;

        const session = yield* chats.createSession({ title: 'Passage' });

        const block = paragraph('alpha selected');

        const target = yield* materials.createManualDocument({
          title: 'Target',
          document: { blocks: [block], meta }
        });

        yield* chats.updateSessionSelection({
          sessionId: session.id,
          expectedRevision: 0n,
          targets: [{ versionId: target.version.id, scope: { kind: 'document' } }]
        });

        const whole = yield* chats.captureSessionContext({
          sessionId: session.id,
          intentKey: 'whole',
          instruction: '',
          preferences: {}
        });

        const documentId = whole.inputs[0]!.documentId;

        const scopes = [
          {
            kind: 'ranges',
            ranges: [
              { versionId: target.version.id, documentId, blockId: block.id, start: 6, end: 14 }
            ]
          },
          { kind: 'blocks', blockIds: [block.id] }
        ] as const;

        for (const [index, scope] of scopes.entries()) {
          yield* chats.updateSessionSelection({
            sessionId: session.id,
            expectedRevision: BigInt(index + 1),
            targets: [{ versionId: target.version.id, documentId, scope }]
          });

          const passage = yield* chats.captureSessionContext({
            sessionId: session.id,
            intentKey: scope.kind,
            instruction: 'Clarify',
            preferences: {}
          });

          const error = yield* Effect.flip(
            chats.requestDocumentTransform({
              title: 'Unsafe broadening',
              contextRequestId: passage.requestId,
              operations: ['clarity'],
              editTargetVersionId: target.version.id
            })
          );

          assert.equal(error.kind, 'invalid_input');
        }

        assert.equal(
          f.context.db.orm.select().from(s.material_generation_requests).all().length,
          0
        );

        assert.equal(f.bodies.length, 0);
      }).pipe(Effect.provide(f.domain()))
    );
  } finally {
    await f.close();
  }
});
