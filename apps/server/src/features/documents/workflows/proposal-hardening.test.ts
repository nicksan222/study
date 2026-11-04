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

import { randomUUID } from 'node:crypto';

import type { runSelectionContextSchema } from '@study/contracts/conversations/context';
import type { StudyDocumentVersionId } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import type { Block } from '@study/contracts/sources/document';
import { blockContentSchema } from '@study/contracts/sources/schemas';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Deferred, Effect, Exit, Fiber, Schema } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import {
  documentTransformHandler,
  documentTransformWorkflow
} from '#server/features/documents/workflows/transform';
import { documentTransformFixture } from '#testing/document-transform';
import { makeMaterialOutput } from '#testing/material-output';

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

type CapturedContext = typeof runSelectionContextSchema.Type;

function capturedBlockIds(capture: CapturedContext, selectedId: Block['id']) {
  return capture.inputs.flatMap(
    (input) => input.document?.blocks.map((block) => block.id) ?? [selectedId]
  );
}

function assertProviderCapture(
  { captured, instructions }: ReturnType<typeof providerPrompt>,
  capture: CapturedContext,
  input: CapturedContext['inputs'][number] | undefined
) {
  expect(instructions).toMatch(/propose a revision of that exact target Document only/);

  assert.ok(captured.instruction === 'Clarify');

  const expectedRoles = capture.inputs.map((entry) =>
    input === undefined
      ? 'source'
      : json(entry.input) === json(input.input)
        ? 'editable_target'
        : 'supporting_evidence'
  );

  expect(captured.inputs.map((entry: { role: string }) => entry.role)).toStrictEqual(expectedRoles);

  expect(
    captured.inputs[2].excerpts.map((excerpt: { text: string; start: number; end: number }) => [
      excerpt.text,
      excerpt.start,
      excerpt.end
    ])
  ).toStrictEqual([['HIDDEN BEFORE alpha evidence HIDDEN AFTER', 0, 41]]);

  assert.strictEqual(captured.editTarget === undefined, input === undefined);

  if (input)
    expect(captured.editTarget).toStrictEqual(
      JSON.parse(
        json({
          input: input.input,
          snapshotId: input.snapshotId,
          documentId: input.documentId,
          document: input.document
        })
      )
    );
}

function assertGeneratedIdentity(value: {
  versionId: StudyDocumentVersionId;
  requestId: string;
  capture: CapturedContext;
  input: CapturedContext['inputs'][number] | undefined;
  retained: readonly Block[];
  selectedId: Block['id'];
  codeId: Block['id'];
  remintCode: boolean;
}) {
  return Effect.gen(function* () {
    const materials = yield* Documents;

    const version = yield* materials.version({ id: value.versionId });

    const ids = version.document.blocks.map((block) => block.id);

    const allInputIds = capturedBlockIds(value.capture, value.selectedId);

    assert.strictEqual(version.status, value.input ? 'draft' : 'published');

    assert.strictEqual(new Set(ids).size, ids.length);

    if (value.input?.document) {
      assert.strictEqual(version.documentId, value.input.documentId);

      expect(ids.slice(1, value.retained.length)).toStrictEqual(
        value.retained.slice(1).map((block) => block.id)
      );

      assert.ok(!ids.includes(value.retained[0]!.id));

      if (value.remintCode) assert.notStrictEqual(ids.at(-1), value.codeId);

      const comparison = yield* (yield* Documents).compareProposal({
        requestId: value.requestId
      });

      const retainedIds = new Set(value.retained.slice(1).map((block) => block.id));

      assert.ok(comparison.proposedChanges.every((change) => !retainedIds.has(change.blockId)));
    } else assert.ok(ids.every((id) => !allInputIds.includes(id)));

    const generation = yield* materials.transform({
      requestId: value.requestId
    });

    expect(generation.report?.notes[0]!.blockIds).toStrictEqual(ids);
  });
}

testStable(
  'A-target, B-target and no-target requests discriminate exact rich captures and preserve only target IDs',
  { timeout: 20000 },
  async () => {
    const f = await documentTransformFixture();

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Documents;

          const chats = yield* Conversations;

          const session = yield* chats.createSession({ title: 'Discrimination' });

          const a = yield* materials.create({
            sessionId: session.id,
            createKey: randomUUID(),
            inputs: [],
            citations: [],
            title: 'A',
            document: document(richBlocks('A'))
          });

          const code = createBlock({ type: 'code', code: 'support_only()', language: 'ts' });

          const b = yield* materials.create({
            sessionId: session.id,
            createKey: randomUUID(),
            inputs: [],
            citations: [],
            title: 'B',
            document: document([...richBlocks('B'), code])
          });

          const selected = paragraph('HIDDEN BEFORE alpha evidence HIDDEN AFTER');

          const support = yield* materials.create({
            sessionId: session.id,
            createKey: randomUUID(),
            inputs: [],
            citations: [],
            title: 'Range',
            document: document([selected])
          });

          assert.ok(a.version);
          assert.ok(b.version);
          assert.ok(support.version);
          yield* chats.updateSessionSelection({
            sessionId: session.id,
            expectedRevision: 0n,
            targets: [
              ...[a, b].map((item) => ({
                input: { kind: 'document' as const, versionId: item.version!.id },
                scope: { kind: 'document' as const }
              })),
              {
                input: { kind: 'document', versionId: support.version.id },
                scope: { kind: 'blocks', blockIds: [selected.id] }
              }
            ]
          });

          const whole = yield* chats.captureSessionContext({
            sessionId: session.id,
            intentKey: 'locate-range',
            instruction: 'Clarify',
            preferences: {}
          });

          assert.ok(whole.inputs[2]?.input.kind === 'document');

          yield* chats.updateSessionSelection({
            sessionId: session.id,
            expectedRevision: 1n,
            targets: [
              ...[a, b].map((item) => ({
                input: { kind: 'document' as const, versionId: item.version!.id },
                scope: { kind: 'document' as const }
              })),
              {
                input: { kind: 'document', versionId: support.version.id },
                scope: {
                  kind: 'ranges',
                  ranges: [
                    {
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
              editTargetVersionId: target?.version!.id
            };

            const request = yield* chats.requestDocumentTransform(value);

            assert.strictEqual((yield* chats.requestDocumentTransform(value)).id, request.id);

            assert.ok(
              (yield* Effect.flip(
                chats.requestDocumentTransform({
                  ...value,
                  editTargetVersionId: target === a ? b.version.id : a.version.id
                })
              )).kind === 'invalid_input'
            );

            requests.push({ capture, request, target });
          }

          // Current content and selection must never replace these immutable captures in the prompt.
          yield* materials.save({
            documentId: a.id,
            expectedVersionId: a.version.id,
            key: 'live-edit',
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

      assert.notStrictEqual(
        setup.requests[0]!.capture.requestId,
        setup.requests[1]!.capture.requestId
      );

      expect(setup.requests[0]!.capture.inputs).toStrictEqual(setup.requests[1]!.capture.inputs);

      const prompts = [];

      for (const [index, item] of setup.requests.entries()) {
        const input = item.capture.inputs.find(
          (input) =>
            input.input.kind === 'document' && input.input.versionId === item.target?.version!.id
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

        const result = await f.executeAuthored(
          f.authoredEvent(item.request.id),
          `discrimination-${index}`
        );

        const { captured, instructions } = providerPrompt(f.bodies[bodyIndex]!);

        prompts.push(captured);

        assertProviderCapture({ captured, instructions }, item.capture, input);

        for (const body of f.bodies.slice(bodyIndex)) {
          assert.ok(body.includes('HIDDEN BEFORE'));

          assert.ok(body.includes('HIDDEN AFTER'));

          assert.ok(!body.includes('LATEST PRIVATE TARGET'));
        }

        await Effect.runPromise(
          assertGeneratedIdentity({
            versionId: result,
            requestId: item.request.id,
            capture: item.capture,
            input,
            retained,
            selectedId: setup.selected.id,
            codeId: setup.code.id,
            remintCode: item.target === setup.a
          }).pipe(Effect.provide(f.domain()))
        );
      }

      expect(prompts[0].editTarget).not.toStrictEqual(prompts[1].editTarget);

      assert.strictEqual(
        f.context.db.orm.select().from(s.study_document_proposals).all().length,
        2
      );

      assert.strictEqual(f.bodies.length, 6);
    } finally {
      await f.close();
    }
  }
);

for (const barrier of ['cancel', 'delete'] as const) {
  testStable(
    `target proposal ${barrier} during the native output Activity fences all late publication`,
    { timeout: 15000 },
    async () => {
      const f = await documentTransformFixture();

      try {
        const setup = await Effect.runPromise(
          Effect.gen(function* () {
            const chats = yield* Conversations;

            const target = yield* (yield* Documents).create({
              createKey: randomUUID(),
              inputs: [],
              citations: [],
              title: 'Target',
              document: document([paragraph('alpha target')])
            });

            assert.ok(target.version);
            const session = yield* chats.createSession({ title: 'In flight' });

            yield* (yield* Documents).attach({ sessionId: session.id, documentId: target.id });

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

            return { session, target: { ...target, version: target.version }, request };
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

              yield* engine.register(documentTransformWorkflow, documentTransformHandler);

              const fiber = yield* Effect.forkChild(
                engine.execute(documentTransformWorkflow, {
                  executionId: `target-in-flight-${barrier}`,
                  payload: { event: f.authoredEvent(setup.request.id) }
                })
              );

              yield* Deferred.await(received);

              if (barrier === 'delete')
                yield* (yield* Conversations).deleteSession(setup.session.id);
              else yield* (yield* Documents).cancelTransform({ requestId: setup.request.id });

              yield* Deferred.succeed(release, undefined);

              assert.ok(Exit.isFailure(yield* Fiber.await(fiber)));
            })
          ).pipe(Effect.provide(f.services()), Effect.timeout('10 seconds'))
        );

        const after = output();

        expect(after.documents).toStrictEqual(before.documents);

        expect(after.blocks).toStrictEqual(before.blocks);

        expect(after.proposals).toStrictEqual([]);

        expect(after.proposalReceipts).toStrictEqual([]);

        expect(after.published).toStrictEqual(before.published);

        assert.strictEqual(f.bodies.length, 2);

        f.reopen();

        await expect(
          f.executeAuthored(f.authoredEvent(setup.request.id), `target-fence-reopen-${barrier}`)
        ).rejects.toSatisfy(() => true);

        assert.strictEqual(f.bodies.length, 2);

        await Effect.runPromise(
          Effect.gen(function* () {
            const chats = yield* Conversations;

            yield* Effect.flip(
              chats.applyDocumentProposal({
                requestId: setup.request.id,
                key: 'late-apply',
                expectedVersionId: setup.target.version.id
              })
            );

            yield* Effect.flip(
              chats.keepDocumentProposal({
                requestId: setup.request.id,
                key: 'late-keep',
                title: 'Late copy'
              })
            );

            assert.strictEqual(
              (yield* (yield* Documents).document({ id: setup.target.id })).version?.id,
              setup.target.version.id
            );
          }).pipe(Effect.provide(f.domain()))
        );

        expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      } finally {
        await f.close();
      }
    }
  );
}
