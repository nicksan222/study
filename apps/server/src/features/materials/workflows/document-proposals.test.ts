/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises session proposals through the controlled native generation path.       │
 * │                                                                                        │
 * │ Responsibilities:                                                                      │
 * │ - Covers application, keep, undo, changed inputs and publication fences.               │
 * │                                                                                        │
 * │ Boundaries:                                                                            │
 * │ Execution status: UNRUN pending CI; uses the shared provider fixture.                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Effect } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import { Sources } from '#server/features/sources/index';
import { documentTransformFixture } from '#testing/document-transform';

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

for (const scenario of ['apply', 'target_changed', 'input_changed', 'selection_changed'] as const) {
  test(`native proposal ${scenario}: exact receipt, comparison, keep and guarded undo`, async () => {
    const f = await documentTransformFixture();

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials;

          const chats = yield* Conversations;

          const session = yield* chats.createSession({ title: 'Editing' });

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

          return { session, target, input, context, request, image, imageBlock };
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

          const value = {
            requestId: setup.request.id,
            key: 'apply',
            expectedVersionId: setup.target.version.id,
            baseVersionId: setup.target.version.id
          };

          if (scenario === 'apply') {
            const versionsBefore = f.context.db.orm.select().from(s.material_versions).all().length;

            f.context.db.orm.run(
              sql`CREATE TRIGGER reject_proposal_event BEFORE INSERT ON workflow_events WHEN NEW.type='MaterialPublished' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END`
            );

            yield* Effect.flip(chats.applyDocumentProposal(value));

            assert.equal(
              f.context.db.orm.select().from(s.material_versions).all().length,
              versionsBefore
            );

            assert.equal(
              f.context.db.orm.select().from(s.document_proposal_receipts).all().length,
              0
            );

            f.context.db.orm.run(sql`DROP TRIGGER reject_proposal_event`);
          }

          const result = yield* chats.applyDocumentProposal(value);

          assert.equal(result.outcome, scenario === 'apply' ? 'applied' : 'conflict');

          assert.equal((yield* chats.applyDocumentProposal(value)).replayed, true);

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

          const kept = yield* chats.keepDocumentProposal({
            requestId: setup.request.id,
            key: 'keep'
          });

          assert.equal(kept.outcome, 'kept');

          assert.ok(kept.resultVersionId);

          const independent = yield* materials.materialVersion({ id: kept.resultVersionId! });

          assert.notEqual(independent.material_id, setup.target.id);

          assert.equal(independent.kind, 'document');

          if (independent.kind !== 'document' || proposal.kind !== 'document')
            throw new Error('Missing rich Document');

          assert.deepEqual(independent.content.blocks[1]!.content, {
            type: 'image',
            sourceId: setup.image.id,
            revision: 1,
            alt: ''
          });

          assert.notEqual(independent.content.blocks[1]!.id, proposal.content.blocks[1]!.id);

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

          if (result.resultVersionId !== null) {
            const applied = yield* materials.materialVersion({ id: result.resultVersionId });

            if (applied.content.kind !== 'document') throw new Error('Missing applied Document');

            assert.equal(applied.content.blocks[1]!.id, setup.imageBlock.id);

            const undo = yield* materials.undoDocument({
              materialId: setup.target.id,
              expectedVersionId: result.resultVersionId,
              restoreVersionId: setup.target.version.id,
              undoKey: 'undo'
            });

            assert.equal(undo.outcome, 'saved');

            assert.equal(
              (yield* materials.undoDocument({
                materialId: setup.target.id,
                expectedVersionId: result.resultVersionId,
                restoreVersionId: setup.target.version.id,
                undoKey: 'undo'
              })).replayed,
              true
            );
          }
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
        }).pipe(Effect.provide(f.domain()))
      );

      assert.equal(await f.execute(event, `proposal-replay-${scenario}`), proposalId);

      assert.equal(f.bodies.length, 2);

      assert.equal(
        f.context.db.orm
          .select()
          .from(s.document_proposals)
          .where(eq(s.document_proposals.request_id, setup.request.id))
          .all().length,
        1
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

        yield* chats.updateSessionSelection({
          sessionId: session.id,
          expectedRevision: 1n,
          targets: [
            {
              versionId: target.version.id,
              documentId,
              scope: {
                kind: 'ranges',
                ranges: [
                  { versionId: target.version.id, documentId, blockId: block.id, start: 6, end: 14 }
                ]
              }
            }
          ]
        });

        const passage = yield* chats.captureSessionContext({
          sessionId: session.id,
          intentKey: 'passage',
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
