/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises authored Page proposals behavior through real persistence                │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies a captured block or passage cannot broaden into a whole authored target edit. │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import type { pageGenerationRequestedSchema } from '@study/contracts/events';
import type { messageIdSchema, noteIdSchema } from '@study/contracts/ids';
import type { PageVersion } from '@study/contracts/pages/types';
import { createBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import type { Context } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';
import { decodeEvent } from '#server/platform/workflows/events';
import { makeMaterialOutput } from '#testing/material-output';
import { cleanup } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';

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

type Fixture = Awaited<ReturnType<typeof pageTransformFixture>>;

function generationEvent(f: Fixture, requestId: string): typeof pageGenerationRequestedSchema.Type {
  const row = f.context.db.orm.get(
    sql`SELECT payload FROM workflow_events WHERE type='PageGenerationRequested' AND correlation_id=${requestId} ORDER BY rowid DESC LIMIT 1`
  );

  assert.ok(row);
  const event = decodeEvent(String(row.payload));

  assert.ok(event.type === 'PageGenerationRequested');

  return event;
}

function create(title: string, blocks = [paragraph('alpha evidence')]) {
  return Effect.flatMap(Pages, (docs) =>
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

function assertIndependentImage(independent: PageVersion, proposal: PageVersion) {
  assert.notStrictEqual(independent.pageId, proposal.pageId);
  expect(independent.document.blocks[1]!.content).toStrictEqual(
    proposal.document.blocks[1]!.content
  );
  assert.notStrictEqual(independent.document.blocks[1]!.id, proposal.document.blocks[1]!.id);
}

function assessApplied(version: PageVersion) {
  return Effect.gen(function* () {
    const docs = yield* Pages;
    const cited = version.citations[0];

    assert.ok(cited?.target);
    const claimBlock = version.document.blocks[0]!;
    const assessment = yield* docs.assessCitation({
      claim: {
        pageId: version.pageId,
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

    assert.ok(assessment.assessment.suppliedBy === 'user');
    assert.ok(assessment.assessment.independentVerification === false);

    return assessment;
  });
}

function assertSupport(
  docs: Context.Service.Shape<typeof Pages>,
  versionId: PageVersion['id'],
  state: 'assessed' | 'stale' | undefined
) {
  return docs
    .assessments({ versionId, marker: 1, limit: 10 })
    .pipe(Effect.map((page) => assert.strictEqual(page.items[0]?.state, state)));
}

type Scenario =
  | 'apply'
  | 'target_changed'
  | 'input_changed'
  | 'selection_changed'
  | 'message_changed';

function changeRelevantContext(
  scenario: Scenario,
  target: PageVersion,
  input: PageVersion,
  context: {
    noteId: typeof noteIdSchema.Type;
    selectionRevision: bigint;
    messageId: typeof messageIdSchema.Type;
  }
) {
  return Effect.gen(function* () {
    const docs = yield* Pages;
    const chats = yield* Notes;

    if (scenario === 'target_changed' || scenario === 'input_changed') {
      const version = scenario === 'target_changed' ? target : input;

      yield* docs.save({
        pageId: version.pageId,
        expectedVersionId: version.id,
        key: scenario,
        document: { blocks: [paragraph('Concurrent content')], meta }
      });
    }

    if (scenario === 'selection_changed')
      yield* chats.updateNoteSelection({
        noteId: context.noteId,
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
      const f = await pageTransformFixture();

      try {
        const setup = await Effect.runPromise(
          Effect.gen(function* () {
            const chats = yield* Notes;
            const sources = yield* Sources;
            const note = yield* chats.createUntitledNote({});
            const message = yield* chats.postMessage({
              noteId: note.id,
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

            for (const document of [target, input])
              yield* (yield* Pages).attach({ noteId: note.id, pageId: document.id });

            yield* chats.updateNoteSelection({
              noteId: note.id,
              expectedRevision: 0n,
              targets: [target, input].map((value) => ({
                input: { kind: 'page' as const, versionId: value.version.id },
                scope: { kind: 'document' as const }
              }))
            });
            const context = yield* chats.captureNoteContext({
              noteId: note.id,
              intentKey: 'proposal',
              instruction: 'Clarify',
              preferences: {}
            });
            const request = yield* chats.requestPageTransform({
              title: 'Proposal',
              contextRequestId: context.requestId,
              operations: ['clarity'],
              editTargetVersionId: target.version.id
            });

            return { note, message, image, target, input, context, request, imageBlock };
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

        assert.strictEqual(
          f.context.db.orm.get(
            sql`SELECT result_version_id FROM page_transform_requests WHERE id=${setup.request.id}`
          )?.result_version_id,
          proposalId
        );
        assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
        assert.ok(f.bodies[0]!.includes('editable_target'));
        assert.ok(f.bodies[0]!.includes('supporting_evidence'));
        const outcomes = await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;
            const chats = yield* Notes;
            const proposal = yield* docs.version({ id: proposalId });

            assert.ok(proposal.status === 'draft');
            assert.strictEqual(proposal.pageId, setup.target.id);
            assert.strictEqual(proposal.document.blocks[1]!.id, setup.imageBlock.id);
            assert.strictEqual(
              (yield* docs.page({ id: setup.target.id })).headVersionId,
              setup.target.version.id
            );
            assert.ok(proposal.citations.length > 0);
            expect(proposal.citations[0]!.input).toStrictEqual({
              kind: 'page',
              versionId: setup.target.version.id
            });

            for (const mutation of [
              sql`DELETE FROM document_assets WHERE document_id=${proposal.snapshotId}`,
              sql`DELETE FROM page_citations WHERE version_id=${proposalId}`,
              sql`UPDATE blocks SET text='forged' WHERE document_id=${proposal.snapshotId}`
            ])
              assert.throws(() => f.context.db.orm.run(mutation));

            yield* changeRelevantContext(scenario, setup.target.version, setup.input.version, {
              noteId: setup.note.id,
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
              assert.ok(
                (yield* Effect.flip(chats.applyPageProposal(invalid))).kind === 'invalid_input'
              );
              expect(output()).toStrictEqual(before);
            }

            if (scenario === 'apply') {
              f.context.db.exec(
                "CREATE TRIGGER reject_proposal_event BEFORE INSERT ON workflow_events WHEN NEW.type='PagePublished' BEGIN SELECT RAISE(ABORT,'injected apply failure'); END"
              );
              yield* Effect.flip(chats.applyPageProposal(value));
              expect(output()).toStrictEqual(before);
              f.context.db.exec('DROP TRIGGER reject_proposal_event');
            }

            const result = yield* chats.applyPageProposal(value);

            assert.strictEqual(result.outcome, scenario === 'apply' ? 'applied' : 'conflict');
            const after = output();

            assert.ok((yield* chats.applyPageProposal(value)).replayed === true);
            expect(output()).toStrictEqual(after);
            assert.ok(
              (yield* Effect.flip(
                chats.keepPageProposal({
                  requestId: value.requestId,
                  key: value.key,
                  title: 'Independent'
                })
              )).kind === 'invalid_input'
            );
            assert.ok(
              (yield* Effect.flip(
                chats.applyPageProposal({
                  ...value,
                  expectedVersionId: setup.input.version.id
                })
              )).kind === 'invalid_input'
            );
            const compare = yield* docs.compareProposal({ requestId: setup.request.id });

            assert.strictEqual(compare.beforeVersionId, setup.target.version.id);
            assert.strictEqual(compare.proposedVersionId, proposalId);
            assert.ok(compare.evidence === 'structural_only');

            if (scenario === 'apply') {
              const beforeKeep = output();

              f.context.db.exec(
                "CREATE TRIGGER reject_keep_event BEFORE INSERT ON workflow_events WHEN NEW.type='PagePublished' BEGIN SELECT RAISE(ABORT,'injected keep failure'); END"
              );
              yield* Effect.flip(
                chats.keepPageProposal({
                  requestId: setup.request.id,
                  key: 'keep',
                  title: 'Independent'
                })
              );
              expect(output()).toStrictEqual(beforeKeep);
              f.context.db.exec('DROP TRIGGER reject_keep_event');
              assert.ok(
                (yield* Effect.flip(chats.applyPageProposal({ ...value, key: 'second-apply' })))
                  .kind === 'invalid_input'
              );
            }

            const kept = yield* chats.keepPageProposal({
              requestId: setup.request.id,
              key: 'keep',
              title: 'Independent'
            });

            assert.ok(kept.outcome === 'kept');
            assert.ok(kept.resultVersionId);
            const independent = yield* docs.version({ id: kept.resultVersionId });

            assertIndependentImage(independent, proposal);
            expect(independent.inputs).toStrictEqual(proposal.inputs);
            expect(independent.citations).toStrictEqual(proposal.citations);
            assert.ok(
              (yield* chats.keepPageProposal({
                requestId: setup.request.id,
                key: 'keep',
                title: 'Independent'
              })).replayed === true
            );
            yield* assertSupport(docs, independent.id, undefined);
            assert.ok(
              (yield* Effect.flip(
                chats.keepPageProposal({
                  requestId: setup.request.id,
                  key: 'second-keep',
                  title: 'Independent'
                })
              )).kind === 'invalid_input'
            );
            assert.throws(() =>
              f.context.db.orm.run(
                sql`UPDATE page_generation_requests SET intent_hash='forged' WHERE id=${setup.request.id}`
              )
            );
            const cited = independent.citations[0]!;

            assert.ok(cited.input.kind === 'page');
            const exact = yield* docs.version({ id: cited.input.versionId });

            assert.ok(exact.document.blocks.some((block) => block.text.includes(cited.quote)));

            if (result.resultVersionId) {
              const applied = yield* docs.version({ id: result.resultVersionId });

              assert.strictEqual(applied.document.blocks[1]!.id, setup.imageBlock.id);
              expect(applied.citations).toStrictEqual(proposal.citations);
              expect(applied.parents).toStrictEqual([setup.target.version.id]);
              yield* assessApplied(applied);
              yield* assertSupport(docs, applied.id, 'stale');
              const restore = {
                pageId: setup.target.id,
                expectedVersionId: applied.id,
                restoreVersionId: setup.target.version.id,
                key: 'restore'
              };
              const restored = yield* docs.restore(restore);

              assert.ok(restored.outcome === 'saved');
              yield* assertSupport(docs, restored.submittedVersionId, undefined);
              yield* assertSupport(docs, applied.id, 'stale');
              assert.ok((yield* docs.restore(restore)).replayed === true);
            }

            return { independentId: independent.id, resultVersionId: result.resultVersionId };
          }).pipe(Effect.provide(f.domain()))
        );

        f.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;
            const chats = yield* Notes;

            assert.ok((yield* docs.version({ id: outcomes.independentId })).status === 'published');
            assert.ok(
              (yield* chats.keepPageProposal({
                requestId: setup.request.id,
                key: 'keep',
                title: 'Independent'
              })).replayed === true
            );

            if (outcomes.resultVersionId)
              yield* assertSupport(docs, outcomes.resultVersionId, 'stale');
          }).pipe(Effect.provide(f.domain()))
        );
        await Effect.runPromise(
          Effect.flatMap(Notes, (chats) => chats.deleteNote(setup.note.id)).pipe(
            Effect.provide(f.domain())
          )
        );
        await cleanup(f, setup.note.id);
        const calls = f.bodies.length;

        await expect(f.executeAuthored(event, `retired-${scenario}`)).rejects.toSatisfy(() => true);
        assert.strictEqual(f.bodies.length, calls);
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;

            assert.ok((yield* docs.version({ id: outcomes.independentId })).status === 'published');
          }).pipe(Effect.provide(f.domain()))
        );
        expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      } finally {
        await f.close();
      }
    }
  );

for (const barrier of ['cancel', 'delete'] as const)
  testStable(
    `authored proposal ${barrier} before native execution fences late publication`,
    async () => {
      const f = await pageTransformFixture();

      try {
        const request = await Effect.runPromise(
          Effect.gen(function* () {
            const chats = yield* Notes;
            const docs = yield* Pages;
            const note = yield* chats.createNote({ title: 'Fence' });
            const target = yield* create('Target');

            yield* docs.attach({ noteId: note.id, pageId: target.id });

            yield* chats.updateNoteSelection({
              noteId: note.id,
              expectedRevision: 0n,
              targets: [
                {
                  input: { kind: 'page', versionId: target.version.id },
                  scope: { kind: 'document' }
                }
              ]
            });
            const context = yield* chats.captureNoteContext({
              noteId: note.id,
              intentKey: barrier,
              instruction: '',
              preferences: {}
            });
            const request = yield* chats.requestPageTransform({
              title: 'Proposal',
              contextRequestId: context.requestId,
              operations: ['structure'],
              editTargetVersionId: target.version.id
            });

            if (barrier === 'delete') yield* chats.deleteNote(note.id);
            else yield* docs.cancelTransform({ requestId: request.id });

            return request;
          }).pipe(Effect.provide(f.domain()))
        );

        await expect(
          f.executeAuthored(generationEvent(f, request.id), `barrier-${barrier}`)
        ).rejects.toSatisfy(() => true);
        assert.strictEqual(f.bodies.length, 0);
        assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM page_proposals`)?.n, 0n);
        assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM pages`)?.n, 1n);
        assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
      } finally {
        await f.close();
      }
    }
  );

testStable(
  'stored block and passage selection does not narrow automatic whole-document target captures',
  async () => {
    const f = await pageTransformFixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;
          const note = yield* chats.createUntitledNote({});
          const block = paragraph('alpha selected omega');
          const target = yield* create('Target', [block]);

          yield* (yield* Pages).attach({ noteId: note.id, pageId: target.id });
          const input = { kind: 'page' as const, versionId: target.version.id };

          yield* chats.updateNoteSelection({
            noteId: note.id,
            expectedRevision: 0n,
            targets: [{ input, scope: { kind: 'document' } }]
          });
          const scopes = [
            { kind: 'ranges', ranges: [{ blockId: block.id, start: 6, end: 14 }] },
            { kind: 'blocks', blockIds: [block.id] }
          ] as const;

          for (const [index, scope] of scopes.entries()) {
            yield* chats.updateNoteSelection({
              noteId: note.id,
              expectedRevision: BigInt(index + 1),
              targets: [{ input, scope }]
            });
            const context = yield* chats.captureNoteContext({
              noteId: note.id,
              intentKey: scope.kind,
              instruction: 'Clarify',
              preferences: {}
            });

            expect(context.inputs[0]?.scope).toStrictEqual({ kind: 'document' });
            expect(context.inputs[0]?.excerpts.map(({ text }) => text)).toStrictEqual([block.text]);
            const request = yield* chats.requestPageTransform({
              title: 'Whole-document target',
              contextRequestId: context.requestId,
              operations: ['clarity'],
              editTargetVersionId: target.version.id
            });

            assert.strictEqual(request.editTargetVersionId, target.version.id);
          }

          assert.strictEqual(
            f.context.db.orm.get(sql`SELECT count(*) n FROM page_transform_requests`)?.n,
            2n
          );
          assert.strictEqual(f.bodies.length, 0);
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);
