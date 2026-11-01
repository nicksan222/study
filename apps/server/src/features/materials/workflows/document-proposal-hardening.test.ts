/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Hardens exact target prompts and in-flight proposal publication fences.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Distinguishes target revisions from independent derivatives on the native path.        │
 * │ - Suspends the controlled provider while real cancellation and deletion execute.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses migrated SQLite, native Workflow/Activity and the shared transport                  │
 * │ fixture.                                                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBlock } from '@study/contracts/sources/document';
import type { Block } from '@study/contracts/sources/document';
import { blockContentSchema } from '@study/contracts/sources/schemas';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { Deferred, Effect, Exit, Fiber, Schema } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import { documentTransformFixture } from '#testing/document-transform';
import { makeMaterialOutput } from '#testing/material-output';

import { materialGenerationHandler, materialGenerationWorkflow } from './generation.ts';

const paragraph = (text: string) =>
  createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] });

const document = (blocks: Block[]) => ({
  blocks,
  meta: {
    extractor: null,
    extractorVersion: 1,
    provider: null,
    durationMs: null,
    pageCount: null,
    refiners: [],
    waitingFor: [],
    corrected: false,
    omissions: []
  }
});

const json = (value: unknown) =>
  JSON.stringify(value, (_, item: unknown) => (typeof item === 'bigint' ? String(item) : item));

function providerPrompt(body: string) {
  const request = JSON.parse(body);
  const user = request.input.find((item: { role?: string }) => item.role === 'user');

  assert.ok(user, 'Provider request must contain the captured user prompt');

  return {
    instructions: request.instructions as string,
    captured: JSON.parse(
      user.content.find((item: { type: string }) => item.type === 'input_text').text
    )
  };
}

function richBlocks(label: string) {
  return [
    paragraph(`alpha target ${label}`),
    createBlock({ type: 'math', expression: 'x² + y²' }),
    createBlock({
      type: 'table',
      rows: [
        {
          cells: [
            {
              header: true,
              paragraphs: [
                [{ type: 'text', text: label, marks: ['strong'] }],
                [{ type: 'math', text: 'z²' }]
              ]
            }
          ]
        }
      ]
    }),
    createBlock({
      type: 'list_item',
      items: [
        { depth: 0, ordered: true, start: 3, inlines: [{ type: 'text', text: label, marks: [] }] },
        {
          depth: 1,
          ordered: false,
          start: 1,
          inlines: [{ type: 'link', text: 'reference', href: 'https://example.com' }]
        }
      ]
    })
  ];
}

test(
  'A-target, B-target and no-target requests discriminate exact rich captures and preserve only target IDs',
  { timeout: 20000 },
  async () => {
    const f = await documentTransformFixture();

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials;
          const chats = yield* Conversations;
          const session = yield* chats.createSession({ title: 'Discrimination' });
          const a = yield* materials.createManualDocument({
            title: 'A',
            document: document(richBlocks('A'))
          });
          const code = createBlock({ type: 'code', code: 'support_only()', language: 'ts' });
          const b = yield* materials.createManualDocument({
            title: 'B',
            document: document([...richBlocks('B'), code])
          });
          const selected = paragraph('HIDDEN BEFORE alpha evidence HIDDEN AFTER');
          const support = yield* materials.createManualDocument({
            title: 'Range',
            document: document([selected])
          });

          yield* chats.updateSessionSelection({
            sessionId: session.id,
            expectedRevision: 0n,
            targets: [
              ...[a, b].map((item) => ({
                versionId: item.version.id,
                scope: { kind: 'document' as const }
              })),
              { versionId: support.version.id, scope: { kind: 'blocks', blockIds: [selected.id] } }
            ]
          });
          const whole = yield* chats.captureSessionContext({
            sessionId: session.id,
            intentKey: 'locate-range',
            instruction: 'Clarify',
            preferences: {}
          });
          const supportDocumentId = whole.inputs[2]!.documentId;

          yield* chats.updateSessionSelection({
            sessionId: session.id,
            expectedRevision: 1n,
            targets: [
              ...[a, b].map((item) => ({
                versionId: item.version.id,
                scope: { kind: 'document' as const }
              })),
              {
                versionId: support.version.id,
                scope: {
                  kind: 'ranges',
                  ranges: [
                    {
                      versionId: support.version.id,
                      documentId: supportDocumentId,
                      blockId: selected.id,
                      start: 14,
                      end: 28
                    }
                  ]
                }
              }
            ]
          });
          const requests = [];

          for (const [intentKey, target] of [
            ['target-a', a],
            ['target-b', b],
            ['independent', undefined]
          ] as const) {
            const capture = yield* chats.captureSessionContext({
              sessionId: session.id,
              intentKey,
              instruction: 'Clarify',
              preferences: {}
            });
            const value = {
              title: 'Proposal',
              contextRequestId: capture.requestId,
              operations: ['clarity'] as const,
              editTargetVersionId: target?.version.id
            };
            const request = yield* chats.requestDocumentTransform(value);

            assert.equal((yield* chats.requestDocumentTransform(value)).id, request.id);
            assert.equal(
              (yield* Effect.flip(
                chats.requestDocumentTransform({
                  ...value,
                  editTargetVersionId: target === a ? b.version.id : a.version.id
                })
              )).kind,
              'invalid_input'
            );
            requests.push({ capture, request, target });
          }

          // Current content and selection must never replace these immutable captures in the prompt.
          yield* materials.saveDocument({
            materialId: a.id,
            expectedVersionId: a.version.id,
            saveKey: 'live-edit',
            document: document([paragraph('LATEST PRIVATE TARGET')])
          });
          yield* chats.updateSessionSelection({
            sessionId: session.id,
            expectedRevision: 2n,
            targets: []
          });

          return { a, b, code, selected, requests };
        }).pipe(Effect.provide(f.domain()))
      );

      assert.notEqual(setup.requests[0]!.capture.requestId, setup.requests[1]!.capture.requestId);
      assert.deepEqual(setup.requests[0]!.capture.inputs, setup.requests[1]!.capture.inputs);

      const prompts = [];

      for (const [index, item] of setup.requests.entries()) {
        const input = item.capture.inputs.find(
          (input) => input.versionId === item.target?.version.id
        );
        const retained =
          input?.document?.blocks ?? setup.requests[0]!.capture.inputs[0]!.document!.blocks;
        const outputBlocks = [
          paragraph('alpha revision [1]'),
          ...retained.slice(1),
          ...(item.target === setup.b ? [] : [setup.code])
        ];
        const bodyIndex = f.bodies.length;

        f.replies.push(
          { kind: 'sources', query: 'alpha target' },
          {
            kind: 'output',
            output: {
              blocks: outputBlocks.map((block) =>
                Schema.encodeSync(Schema.toCodecJson(blockContentSchema))(block.content)
              ),
              notes: [
                {
                  kind: 'limit',
                  explanation: 'Structural revision only',
                  blockOrdinals: outputBlocks.map((_, ordinal) => ordinal)
                }
              ]
            }
          }
        );
        const result = await f.execute(f.event(item.request.id), `discrimination-${index}`);
        const { captured, instructions } = providerPrompt(f.bodies[bodyIndex]!);

        prompts.push(captured);
        assert.match(instructions, /propose a revision of that exact target Document only/);
        assert.equal(captured.instruction, 'Clarify');
        assert.deepEqual(
          captured.inputs.map((entry: { role: string }) => entry.role),
          item.target
            ? [
                item.target === setup.a ? 'editable_target' : 'supporting_evidence',
                item.target === setup.b ? 'editable_target' : 'supporting_evidence',
                'supporting_evidence'
              ]
            : ['source', 'source', 'source']
        );
        assert.deepEqual(
          captured.inputs[2].excerpts.map(
            (excerpt: { text: string; start: number; end: number }) => [
              excerpt.text,
              excerpt.start,
              excerpt.end
            ]
          ),
          [['alpha evidence', 14, 28]]
        );
        assert.equal(captured.editTarget === undefined, item.target === undefined);

        if (input)
          assert.deepEqual(
            captured.editTarget,
            JSON.parse(
              json({
                materialId: input.materialId,
                versionId: input.versionId,
                documentId: input.documentId,
                document: input.document
              })
            )
          );

        for (const body of f.bodies.slice(bodyIndex)) {
          assert.ok(!body.includes('HIDDEN BEFORE'));
          assert.ok(!body.includes('HIDDEN AFTER'));
          assert.ok(!body.includes('LATEST PRIVATE TARGET'));
        }

        await Effect.runPromise(
          Effect.gen(function* () {
            const materials = yield* Materials;
            const version = yield* materials.materialVersion({ id: result });

            if (version.content.kind !== 'document') throw new Error('Missing rich Document');

            const ids = version.content.blocks.map((block) => block.id);
            const allInputIds = item.capture.inputs.flatMap(
              (input) => input.document?.blocks.map((block) => block.id) ?? [setup.selected.id]
            );

            assert.equal(version.status, item.target ? 'draft' : 'published');
            assert.equal(new Set(ids).size, ids.length);

            if (input?.document) {
              assert.equal(version.material_id, input.materialId);
              assert.deepEqual(
                ids.slice(1, retained.length),
                retained.slice(1).map((block) => block.id)
              );
              assert.ok(!ids.includes(retained[0]!.id));

              if (item.target === setup.a) assert.notEqual(ids.at(-1), setup.code.id);

              const comparison = yield* (yield* Conversations).compareDocumentProposal({
                requestId: item.request.id
              });

              assert.ok(
                comparison.proposedChanges.every(
                  (change) => !retained.slice(1).some((block) => block.id === change.blockId)
                )
              );
            } else assert.ok(ids.every((id) => !allInputIds.includes(id)));

            const generation = yield* materials.materialGeneration({
              requestId: item.request.id,
              verifyOnly: true
            });

            assert.deepEqual(generation.report?.notes[0]!.blockIds, ids);
          }).pipe(Effect.provide(f.domain()))
        );
      }

      assert.notDeepEqual(prompts[0].editTarget, prompts[1].editTarget);
      assert.equal(f.context.db.orm.select().from(s.document_proposals).all().length, 2);
      assert.equal(f.bodies.length, 6);
    } finally {
      await f.close();
    }
  }
);

for (const barrier of ['cancel', 'delete'] as const) {
  test(
    `target proposal ${barrier} during the native output Activity fences all late publication`,
    { timeout: 15000 },
    async () => {
      const f = await documentTransformFixture();

      try {
        const setup = await Effect.runPromise(
          Effect.gen(function* () {
            const chats = yield* Conversations;
            const target = yield* (yield* Materials).createManualDocument({
              title: 'Target',
              document: document([paragraph('alpha target')])
            });
            const session = yield* chats.createSession({ title: 'In flight' });

            yield* chats.updateSessionSelection({
              sessionId: session.id,
              expectedRevision: 0n,
              targets: [{ versionId: target.version.id, scope: { kind: 'document' } }]
            });
            const capture = yield* chats.captureSessionContext({
              sessionId: session.id,
              intentKey: barrier,
              instruction: 'Clarify',
              preferences: {}
            });
            const request = yield* chats.requestDocumentTransform({
              title: 'Proposal',
              contextRequestId: capture.requestId,
              operations: ['clarity'],
              editTargetVersionId: target.version.id
            });

            return { session, target, request };
          }).pipe(Effect.provide(f.domain()))
        );
        const output = makeMaterialOutput({ db: f.context.db, clock: f.context.clock });
        const before = output();

        f.replies.push(
          { kind: 'sources', query: 'alpha' },
          {
            kind: 'output',
            output: {
              blocks: [
                Schema.encodeSync(Schema.toCodecJson(blockContentSchema))(
                  paragraph('alpha [1]').content
                )
              ],
              notes: [{ kind: 'limit', explanation: 'Captured only', blockOrdinals: [0] }]
            }
          }
        );
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const engine = yield* WorkflowEngine.WorkflowEngine;
              const received = yield* Deferred.make<void>();
              const release = yield* Deferred.make<void>();

              yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
              f.beforeOutput(() =>
                Effect.runPromise(
                  Deferred.succeed(received, undefined).pipe(
                    Effect.andThen(Deferred.await(release))
                  )
                )
              );
              yield* engine.register(materialGenerationWorkflow, materialGenerationHandler);
              const fiber = yield* Effect.forkChild(
                engine.execute(materialGenerationWorkflow, {
                  executionId: `target-in-flight-${barrier}`,
                  payload: { event: f.event(setup.request.id) }
                })
              );

              yield* Deferred.await(received);

              if (barrier === 'delete')
                yield* (yield* Conversations).deleteSession(setup.session.id);
              else
                yield* (yield* Materials).cancelMaterialGeneration({ requestId: setup.request.id });

              yield* Deferred.succeed(release, undefined);
              assert.ok(Exit.isFailure(yield* Fiber.await(fiber)));
            })
          ).pipe(Effect.provide(f.services()), Effect.timeout('10 seconds'))
        );
        const after = output();

        assert.deepEqual(after.versions, before.versions);
        assert.deepEqual(after.blocks, before.blocks);
        assert.deepEqual(after.proposals, []);
        assert.deepEqual(after.proposalReceipts, []);
        assert.deepEqual(after.published, before.published);
        assert.equal(f.bodies.length, 2);
        f.reopen();
        await assert.rejects(
          f.execute(f.event(setup.request.id), `target-fence-reopen-${barrier}`)
        );
        assert.equal(f.bodies.length, 2);
        await Effect.runPromise(
          Effect.gen(function* () {
            const chats = yield* Conversations;

            yield* Effect.flip(
              chats.applyDocumentProposal({
                requestId: setup.request.id,
                key: 'late-apply',
                baseVersionId: setup.target.version.id,
                expectedVersionId: setup.target.version.id
              })
            );
            yield* Effect.flip(
              chats.keepDocumentProposal({ requestId: setup.request.id, key: 'late-keep' })
            );
            assert.equal(
              (yield* (yield* Materials).material({ id: setup.target.id })).version.id,
              setup.target.version.id
            );
          }).pipe(Effect.provide(f.domain()))
        );
        assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
      } finally {
        await f.close();
      }
    }
  );
}
