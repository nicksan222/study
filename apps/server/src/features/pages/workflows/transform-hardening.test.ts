import { StudyError } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises image authorization and cancellation through real transform Activities.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies JSON image persistence, immutable retries and native cancellation races.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ A controlled transport supplies output; native services and migrated SQLite own state.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { createBlock } from '@study/contracts';
import type { Block } from '@study/contracts';
import { eq, sql } from '@study/db';
import * as s from '@study/db';
import { test } from '@study/testing';
import { Deferred, Effect, Exit, Fiber } from 'effect';
import { Activity, WorkflowEngine } from 'effect/workflow';

import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import {
  pageTransformHandler,
  pageTransformWorkflow
} from '#server/features/pages/workflows/transform';
import { Sources } from '#server/features/sources/index';
import { reconcileCancellation } from '#server/platform/workflows/cancellation';
import { workflowStore } from '#server/platform/workflows/store';
import { libraryState } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';
import { withTestPublication } from '#testing/publication';
import { withTestAdmission } from '#testing/workflow-admission';

const providerParagraph = (text: string) => ({
  type: 'paragraph' as const,
  inlines: [{ type: 'text' as const, text, marks: [] }]
});

const paragraph = (text: string) => createBlock(providerParagraph(text));

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

const notes = [
  { kind: 'limit' as const, explanation: 'Captured evidence only', blockOrdinals: [0] }
];

function capture(blocks: Block[]) {
  return Effect.gen(function* () {
    const materials = yield* Pages;
    const chats = yield* Notes;
    const note = yield* chats.createNote({ title: 'Transform' });
    const original = yield* materials.create({
      noteId: note.id,
      createKey: crypto.randomUUID(),
      inputs: [],
      citations: [],
      title: 'Immutable original',
      document: document(blocks)
    });

    test.assert.ok(original.version);
    yield* chats.updateNoteSelection({
      noteId: note.id,
      expectedRevision: 0n,
      targets: [
        {
          input: { kind: 'page', versionId: original.version.id },
          scope: { kind: 'document' }
        }
      ]
    });
    const snapshot = yield* chats.captureNoteContext({
      noteId: note.id,
      intentKey: 'original-snapshot',
      instruction: 'Keep the uncertainty',
      preferences: { detail: 'brief' }
    });
    const request = yield* chats.requestPageTransform({
      contextRequestId: snapshot.requestId,
      title: 'Derivative',
      operations: ['clarity', 'translate']
    });

    return { original: { ...original, version: original.version }, note, snapshot, request };
  });
}

test.stable(
  'actual provider JSON images persist as canonical bigint assets and survive reopen/replay',
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const image = yield* (yield* Sources).createSource({
            projectId: null,
            name: 'managed.png',
            bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
          });
          const block = createBlock({
            type: 'image',
            sourceId: image.id,
            revision: 1,
            alt: 'alpha image'
          });

          return { ...(yield* capture([paragraph('alpha selected'), block])), image, block };
        }).pipe(Effect.provide(fixture.domain()))
      );
      const event = fixture.authoredEvent(setup.request.id);

      fixture.replies.push(
        { kind: 'sources', query: 'alpha selected' },
        {
          kind: 'output',
          output: {
            blocks: [
              providerParagraph('Selected alpha [1]'),
              {
                type: 'image',
                sourceId: String(setup.image.id),
                revision: 1,
                alt: 'Retained image'
              }
            ],
            notes
          }
        }
      );
      const result = await fixture.executeAuthored(event, 'json-image');

      test.assert.strictEqual(fixture.bodies.length, 2);
      test.assert.strictEqual(fixture.replies.length, 0);
      await fixture.reopen();
      test.assert.strictEqual(await fixture.executeAuthored(event, 'json-image-replay'), result);
      test.assert.strictEqual(fixture.bodies.length, 2);
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Pages;
          const read = yield* materials.version({ id: result });

          test.expect(read.document.blocks[1]!.content).toStrictEqual({
            type: 'image',
            sourceId: setup.image.id,
            revision: 1,
            alt: 'Retained image'
          });
          test.assert.notStrictEqual(read.document.blocks[1]!.id, setup.block.id);
          test.expect(read.document.blocks[1]!.anchor).toStrictEqual({ type: 'authored' });
          test.expect(read.inputs[0]).toStrictEqual({
            kind: 'page',
            versionId: setup.original.version.id
          });
          test
            .expect((yield* materials.version({ id: setup.original.version.id })).document)
            .toStrictEqual(setup.original.version.document);
          const chats = yield* Notes;

          yield* chats.deleteNote(setup.note.id);
          yield* withTestPublication(
            fixture.context,
            chats.finishNoteDeletion({ noteId: setup.note.id, attempt: 1 }).pipe(Effect.asVoid)
          );
          const retained = yield* materials.version({ id: result });

          test.expect(retained.document).toStrictEqual(read.document);
          test
            .expect(
              (yield* (yield* Sources).sourceSnapshot({ id: setup.image.id, revision: 1 })).bytes
            )
            .toStrictEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
        }).pipe(Effect.provide(fixture.domain()))
      );
      await test
        .expect(fixture.executeAuthored(event, 'image-after-note-delete'))
        .rejects.toSatisfy(() => true);
      test.assert.strictEqual(fixture.bodies.length, 2);
      test.assert.strictEqual(
        fixture.context.db.orm.all(
          sql`SELECT * FROM document_assets WHERE source_id=${setup.image.id}`
        ).length,
        2
      );
    } finally {
      await fixture.close();
    }
  }
);

for (const mode of ['fake-id', 'fake-revision', 'alt-range'] as const) {
  test.stable(
    mode === 'alt-range'
      ? 'stored alt-text range still captures the whole document image'
      : `provider JSON ${mode} cannot publish unauthorized images`,
    async ({ databases }) => {
      const fixture = await pageTransformFixture(databases);

      try {
        const setup = await Effect.runPromise(
          Effect.gen(function* () {
            const image = yield* (yield* Sources).createSource({
              projectId: null,
              name: 'alpha.png',
              bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
            });
            const block = createBlock({
              type: 'image',
              sourceId: image.id,
              revision: 1,
              alt: 'alpha image'
            });
            const initial = yield* capture([block]);
            const chats = yield* Notes;

            if (mode !== 'alt-range') return { ...initial, image };

            const input = initial.snapshot.inputs[0]!;

            yield* chats.updateNoteSelection({
              noteId: initial.note.id,
              expectedRevision: 1n,
              targets: [
                {
                  input: input.input,
                  scope: {
                    kind: 'ranges',
                    ranges: [
                      {
                        blockId: block.id,
                        start: 0,
                        end: 5
                      }
                    ]
                  }
                }
              ]
            });
            const snapshot = yield* chats.captureNoteContext({
              noteId: initial.note.id,
              intentKey: 'text-only',
              instruction: 'Explain selected alt text',
              preferences: {}
            });
            const request = yield* chats.requestPageTransform({
              contextRequestId: snapshot.requestId,
              title: 'Whole image authorization',
              operations: ['explain']
            });

            return { ...initial, snapshot, request, image };
          }).pipe(Effect.provide(fixture.domain()))
        );
        const before = fixture.context.db.orm.select().from(s.page_versions).all();
        const published = fixture.context.db.orm
          .select()
          .from(s.workflowEvents)
          .all()
          .filter((row) => row.type === 'PagePublished');

        fixture.replies.push(
          { kind: 'sources', query: 'alpha' },
          {
            kind: 'output',
            output: {
              blocks: [
                providerParagraph('alpha [1]'),
                {
                  type: 'image',
                  sourceId: String(mode === 'fake-id' ? setup.image.id + 999n : setup.image.id),
                  revision: mode === 'fake-revision' ? 999 : 1,
                  alt: 'alpha image'
                }
              ],
              notes
            }
          }
        );

        if (mode === 'alt-range') {
          const result = await fixture.executeAuthored(
            fixture.authoredEvent(setup.request.id),
            mode
          );
          const saved = await Effect.runPromise(
            Effect.flatMap(Pages, (docs) => docs.version({ id: result })).pipe(
              Effect.provide(fixture.domain())
            )
          );

          test.assert.ok(
            saved.document.blocks.some(
              (block) => block.content.type === 'image' && block.content.sourceId === setup.image.id
            )
          );
          test.assert.strictEqual(fixture.bodies.length, 2);
          test.assert.strictEqual(fixture.replies.length, 0);
          test.assert.ok(fixture.bodies[0]!.includes('alpha image'));

          return;
        }

        await test
          .expect(fixture.executeAuthored(fixture.authoredEvent(setup.request.id), mode))
          .rejects.toSatisfy(() => true);
        test.assert.strictEqual(fixture.bodies.length, 2);
        test.assert.strictEqual(fixture.replies.length, 0);
        test
          .expect(fixture.context.db.orm.select().from(s.page_versions).all())
          .toStrictEqual(before);
        test
          .expect(
            fixture.context.db.orm
              .select()
              .from(s.workflowEvents)
              .all()
              .filter((row) => row.type === 'PagePublished')
          )
          .toStrictEqual(published);
        test.assert.ok(
          fixture.context.db.orm
            .select()
            .from(s.page_transform_requests)
            .where(eq(s.page_transform_requests.id, setup.request.id))
            .get()?.result_version_id === null
        );
      } finally {
        await fixture.close();
      }
    }
  );
}

test.stable(
  'transient provider retry keeps the exact original capture after current input and selection change',
  { timeout: 15000 },
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);

    try {
      const setup = await Effect.runPromise(
        capture([paragraph('alpha captured')]).pipe(Effect.provide(fixture.domain()))
      );

      fixture.beforeResponse(() =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* (yield* Pages).save({
              pageId: setup.original.id,
              expectedVersionId: setup.original.version.id,
              key: crypto.randomUUID(),
              document: document([paragraph('LATEST SECRET')])
            });
            yield* (yield* Notes).updateNoteSelection({
              noteId: setup.note.id,
              expectedRevision: 1n,
              targets: []
            });
          }).pipe(Effect.provide(fixture.domain()))
        )
      );
      fixture.replies.push(
        { kind: 'transient' },
        { kind: 'sources', query: 'alpha' },
        { kind: 'output', output: { blocks: [providerParagraph('alpha [1]')], notes } }
      );
      const result = await fixture.executeAuthored(
        fixture.authoredEvent(setup.request.id),
        'transient-retry'
      );

      test.assert.strictEqual(fixture.bodies.length, 3);
      test.assert.strictEqual(fixture.replies.length, 0);

      for (const body of fixture.bodies) {
        test.assert.ok(body.includes('alpha captured'));
        test.assert.ok(!body.includes('LATEST SECRET'));
      }

      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Pages;
          const read = yield* materials.version({ id: result });
          const retry = yield* (yield* Notes).retryPageTransform({
            requestId: setup.request.id,
            retryId: 'completed-retry'
          });

          test.assert.strictEqual(retry.contextRequestId, setup.snapshot.requestId);
          test.assert.strictEqual(retry.resultVersionId, result);
          test
            .expect(read.inputs)
            .toStrictEqual([{ kind: 'page', versionId: setup.original.version.id }]);
        }).pipe(Effect.provide(fixture.domain()))
      );
      await fixture.reopen();
      test.assert.strictEqual(
        await fixture.executeAuthored(fixture.authoredEvent(setup.request.id), 'retry-reopen'),
        result
      );
      test.assert.strictEqual(fixture.bodies.length, 3);
      const regenerated = await Effect.runPromise(
        Effect.gen(function* () {
          const head = (yield* (yield* Pages).page({ id: setup.original.id })).version;

          test.assert.ok(head);
          const chats = yield* Notes;

          yield* chats.updateNoteSelection({
            noteId: setup.note.id,
            expectedRevision: 2n,
            targets: [{ input: { kind: 'page', versionId: head.id }, scope: { kind: 'document' } }]
          });
          const snapshot = yield* chats.captureNoteContext({
            noteId: setup.note.id,
            intentKey: 'explicit-regenerate',
            instruction: 'Explain new input',
            preferences: {}
          });
          const request = yield* chats.requestPageTransform({
            contextRequestId: snapshot.requestId,
            title: 'New derivative',
            operations: ['explain']
          });

          test.assert.notStrictEqual(request.id, setup.request.id);

          return { request, head };
        }).pipe(Effect.provide(fixture.domain()))
      );

      fixture.replies.push(
        { kind: 'sources', query: 'LATEST' },
        {
          kind: 'output',
          output: { blocks: [providerParagraph('Latest explanation [1]')], notes }
        }
      );
      const second = await fixture.executeAuthored(
        fixture.authoredEvent(regenerated.request.id),
        'explicit-regenerate'
      );

      test.assert.notStrictEqual(second, result);
      await Effect.runPromise(
        Effect.gen(function* () {
          const read = yield* (yield* Pages).version({ id: second });

          test.expect(read.inputs).toStrictEqual([
            { kind: 'page', versionId: regenerated.head.id },
            { kind: 'page', versionId: result }
          ]);
        }).pipe(Effect.provide(fixture.domain()))
      );
      test.assert.strictEqual(fixture.bodies.length, 5);
    } finally {
      await fixture.close();
    }
  }
);

test.stable(
  'native cancellation before provider response fences publication and never resumes or retries',
  { timeout: 15000 },
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);

    try {
      const setup = await Effect.runPromise(
        capture([paragraph('alpha selected')]).pipe(Effect.provide(fixture.domain()))
      );
      const event = fixture.authoredEvent(setup.request.id);

      fixture.replies.push(
        { kind: 'sources', query: 'alpha' },
        { kind: 'output', output: { blocks: [providerParagraph('alpha [1]')], notes } }
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;
            const received = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();

            yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
            fixture.beforeOutput(() =>
              Effect.runPromise(
                Deferred.succeed(received, undefined).pipe(Effect.andThen(Deferred.await(release)))
              )
            );
            yield* engine.register(pageTransformWorkflow, pageTransformHandler);
            const fiber = yield* Effect.forkChild(
              withTestAdmission(
                fixture.context,
                pageTransformWorkflow,
                'cancel-before-publication',
                { event },
                engine.execute(pageTransformWorkflow, {
                  executionId: 'cancel-before-publication',
                  payload: { event }
                })
              )
            );

            yield* Deferred.await(received);
            const cancelled = yield* (yield* Pages).cancelTransform({
              requestId: setup.request.id
            });

            test.assert.ok(cancelled.cancelled === true);
            yield* Deferred.succeed(release, undefined);
            const exit = yield* Fiber.await(fiber);

            test.assert.ok(Exit.isFailure(exit));
            yield* reconcileCancellation(
              fixture.context,
              pageTransformWorkflow,
              'cancel-before-publication',
              'safe',
              true
            );
            test.assert.ok(
              workflowStore(fixture.context).execution('cancel-before-publication')?.status ===
                'cancelled'
            );
            yield* engine.resume(pageTransformWorkflow, 'cancel-before-publication');
            const error = yield* Effect.flip(
              (yield* Notes).retryPageTransform({
                requestId: setup.request.id,
                retryId: 'cancelled-retry'
              })
            );

            test.assert.ok(error.kind === 'cancelled');
          })
        ).pipe(Effect.provide(fixture.services()), Effect.timeout('10 seconds'))
      );
      test.assert.strictEqual(fixture.bodies.length, 2);
      test.assert.strictEqual(fixture.context.db.orm.select().from(s.pages).all().length, 1);
      await fixture.reopen();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(pageTransformWorkflow, pageTransformHandler);
            yield* engine.resume(pageTransformWorkflow, 'cancel-before-publication');
            const read = yield* (yield* Pages).transform({
              requestId: setup.request.id
            });

            test.assert.ok(read.cancelled === true);
            test.assert.ok(read.resultVersionId === null);
          })
        ).pipe(Effect.provide(fixture.services()))
      );
      test.assert.strictEqual(fixture.bodies.length, 2);
    } finally {
      await fixture.close();
    }
  }
);

test.stable(
  'committed publication wins actual native pending and unsafe cancellation before terminal checkpoint',
  { timeout: 15000 },
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);

    try {
      const setup = await Effect.runPromise(
        capture([paragraph('alpha selected')]).pipe(Effect.provide(fixture.domain()))
      );
      const event = fixture.authoredEvent(setup.request.id);

      fixture.replies.push(
        { kind: 'sources', query: 'alpha' },
        { kind: 'output', output: { blocks: [providerParagraph('alpha [1]')], notes } }
      );
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;
            const published = yield* Deferred.make<void>();
            const finish = yield* Deferred.make<void>();

            yield* Effect.addFinalizer(() => Deferred.succeed(finish, undefined));
            yield* engine.register(pageTransformWorkflow, holdAfterPublication(published, finish));
            const fiber = yield* Effect.forkChild(
              withTestAdmission(
                fixture.context,
                pageTransformWorkflow,
                'publication-wins',
                { event },
                engine.execute(pageTransformWorkflow, {
                  executionId: 'publication-wins',
                  payload: { event }
                })
              )
            );

            yield* Deferred.await(published);
            workflowStore(fixture.context).requestCancellation('publication-wins', 'safe');
            yield* engine.interrupt(pageTransformWorkflow, 'publication-wins');
            test.assert.ok(
              workflowStore(fixture.context).execution('publication-wins')?.cancellation_mode ===
                'safe'
            );
            const materials = yield* Pages;
            const pending = yield* materials.transform({
              requestId: setup.request.id
            });

            test.assert.ok(pending.resultVersionId);
            test.assert.ok(pending.cancelled === false);
            const cancellation = yield* reconcileCancellation(
              fixture.context,
              pageTransformWorkflow,
              'publication-wins',
              'unsafe',
              true
            ).pipe(Effect.forkChild);

            yield* Fiber.await(fiber);
            // Unsafe interruption can resume receipt replay before its terminal checkpoint.
            yield* Deferred.succeed(finish, undefined);
            yield* Fiber.join(cancellation);

            yield* test.pollUntil(
              Effect.sync(
                () => workflowStore(fixture.context).execution('publication-wins')?.status
              ),
              (status) => status === 'cancelled',
              {
                attempts: 500,
                interval: '10 millis',
                message: 'Publication-wins execution did not become cancelled'
              }
            );

            test.assert.ok(
              workflowStore(fixture.context).execution('publication-wins')?.status === 'cancelled'
            );
            const read = yield* materials.transform({
              requestId: setup.request.id
            });
            const cancelled = yield* materials.cancelTransform({
              requestId: setup.request.id
            });

            test.assert.ok(read.cancelled === false);
            test.assert.ok(cancelled.cancelled === false);
            test.assert.strictEqual(read.resultVersionId, pending.resultVersionId);
            test.assert.strictEqual(cancelled.resultVersionId, pending.resultVersionId);

            return pending.resultVersionId;
          })
        ).pipe(Effect.provide(fixture.services()), Effect.timeout('10 seconds'))
      );

      await fixture.reopen();
      test.assert.strictEqual(
        await fixture.executeAuthored(event, 'publication-wins-replay'),
        result
      );
      test.assert.strictEqual(fixture.bodies.length, 2);
      test.assert.strictEqual(fixture.context.db.orm.select().from(s.pages).all().length, 2);
    } finally {
      await fixture.close();
    }
  }
);

test.stable(
  'provider markers preserve distinct whole-block evidence after note deletion',
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const block = paragraph('😀 echo :: echo');
          const duplicate = paragraph('echo');
          const initial = yield* capture([block, duplicate]);
          const input = initial.snapshot.inputs[0]!;
          const chats = yield* Notes;
          const range = {
            blockId: block.id
          };

          yield* chats.updateNoteSelection({
            noteId: initial.note.id,
            expectedRevision: 1n,
            targets: [
              {
                input: input.input,
                scope: {
                  kind: 'ranges',
                  ranges: [
                    { ...range, start: 3, end: 7 },
                    { ...range, start: 11, end: 15 }
                  ]
                }
              }
            ]
          });
          const snapshot = yield* chats.captureNoteContext({
            noteId: initial.note.id,
            intentKey: 'duplicate-ranges',
            instruction: 'Compare the selected occurrences',
            preferences: {}
          });
          const request = yield* chats.requestPageTransform({
            contextRequestId: snapshot.requestId,
            title: 'Duplicate evidence',
            operations: ['combine']
          });

          return { ...initial, request, range, block, duplicate };
        }).pipe(Effect.provide(fixture.domain()))
      );

      fixture.replies.push(
        { kind: 'sources', query: 'echo' },
        { kind: 'output', output: { blocks: [providerParagraph('Both echo [1] [2]')], notes } }
      );
      const event = fixture.authoredEvent(setup.request.id);
      const result = await fixture.executeAuthored(event, 'duplicate-ranges');
      const retained = await libraryState(fixture, [result]);
      const outputCount = fixture.context.db.orm.select().from(s.page_versions).all().length;

      await Effect.runPromise(
        Effect.gen(function* () {
          yield* (yield* Notes).deleteNote(setup.note.id);
        }).pipe(Effect.provide(fixture.domain()))
      );
      await fixture.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Pages;
          const saved = (yield* materials.version({ id: result })).citations;

          test.expect(saved.map((citation) => citation.target)).toStrictEqual([
            { ...setup.range, start: 0, end: setup.block.text.length },
            { blockId: setup.duplicate.id, start: 0, end: setup.duplicate.text.length }
          ]);
          test
            .expect(saved.map(({ quote }) => quote))
            .toStrictEqual([setup.block.text, setup.duplicate.text]);
        }).pipe(Effect.provide(fixture.domain()))
      );
      await test
        .expect(fixture.executeAuthored(event, 'duplicate-ranges-replay'))
        .rejects.toSatisfy(
          (error: unknown) => error instanceof StudyError && error.kind === 'cancelled'
        );
      test.expect(await libraryState(fixture, [result])).toStrictEqual(retained);
      test.assert.strictEqual(
        fixture.context.db.orm.select().from(s.page_versions).all().length,
        outputCount
      );
      test.assert.strictEqual(fixture.bodies.length, 2);
    } finally {
      await fixture.close();
    }
  }
);

test.stable(
  'provider report ordinals cannot reference an unavailable output block',
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);

    try {
      const setup = await Effect.runPromise(
        capture([paragraph('alpha selected')]).pipe(Effect.provide(fixture.domain()))
      );

      fixture.replies.push(
        { kind: 'sources', query: 'alpha' },
        {
          kind: 'output',
          output: {
            blocks: [providerParagraph('alpha [1]')],
            notes: [
              {
                kind: 'correction_proposal',
                explanation: 'Proposed change [1]',
                blockOrdinals: [99]
              }
            ]
          }
        }
      );
      await test
        .expect(
          fixture.executeAuthored(fixture.authoredEvent(setup.request.id), 'bad-report-reference')
        )
        .rejects.toSatisfy(() => true);
      test.assert.strictEqual(fixture.bodies.length, 2);
      test.assert.strictEqual(fixture.context.db.orm.select().from(s.pages).all().length, 1);
      test.assert.ok(
        fixture.context.db.orm
          .select()
          .from(s.page_transform_requests)
          .where(eq(s.page_transform_requests.id, setup.request.id))
          .get()?.result_version_id === null
      );
    } finally {
      await fixture.close();
    }
  }
);

for (const barrier of ['cancel', 'note-delete'] as const) {
  test.stable(`native ${barrier} preflight prevents provider dispatch`, async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);

    try {
      const setup = await Effect.runPromise(
        capture([paragraph('alpha selected')]).pipe(Effect.provide(fixture.domain()))
      );
      const event = fixture.authoredEvent(setup.request.id);

      await Effect.runPromise(
        Effect.gen(function* () {
          if (barrier === 'cancel')
            yield* (yield* Pages).cancelTransform({ requestId: setup.request.id });
          else yield* (yield* Notes).deleteNote(setup.note.id);
        }).pipe(Effect.provide(fixture.domain()))
      );
      await test
        .expect(fixture.executeAuthored(event, `preflight-${barrier}`))
        .rejects.toSatisfy(() => true);
      test.assert.strictEqual(fixture.bodies.length, 0);
      test.assert.strictEqual(fixture.context.db.orm.select().from(s.pages).all().length, 1);
      test.assert.ok(
        fixture.context.db.orm
          .select()
          .from(s.page_transform_requests)
          .where(eq(s.page_transform_requests.id, setup.request.id))
          .get()?.result_version_id === null
      );
    } finally {
      await fixture.close();
    }
  });
}

/** Hold the real handler after publication while the native checkpoint is still pending. */
function holdAfterPublication(published: Deferred.Deferred<void>, finish: Deferred.Deferred<void>) {
  return (payload: typeof pageTransformWorkflow.payloadSchema.Type) =>
    pageTransformHandler(payload).pipe(
      Effect.tap(Deferred.succeed(published, undefined)),
      Effect.tap(
        Activity.make({ name: 'post-publication-cleanup', execute: Deferred.await(finish) })
      )
    );
}

for (const size of [90_000]) {
  test.stable(
    `oversized captured Page input (${size}) fails with typed admission error before dispatch`,
    async ({ databases }) => {
      const fixture = await pageTransformFixture(databases);

      try {
        const setup = await Effect.runPromise(
          capture([paragraph('\u0000'.repeat(size))]).pipe(Effect.provide(fixture.domain()))
        );
        const event = fixture.authoredEvent(setup.request.id);
        const executionId = `oversized-${size}`;
        const failure = await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const engine = yield* WorkflowEngine.WorkflowEngine;

              yield* engine.register(pageTransformWorkflow, pageTransformHandler);

              return yield* withTestAdmission(
                fixture.context,
                pageTransformWorkflow,
                executionId,
                { event },
                engine.execute(pageTransformWorkflow, { executionId, payload: { event } })
              ).pipe(Effect.catch((error) => Effect.succeed(error.kind)));
            }).pipe(Effect.provide(fixture.services()))
          )
        );

        test.assert.strictEqual(failure, 'not_enough');
        test.assert.strictEqual(fixture.bodies.length, 0);
        test.assert.strictEqual(fixture.context.db.orm.select().from(s.pages).all().length, 1);
        test.assert.strictEqual(
          fixture.context.db.orm
            .select()
            .from(s.page_transform_requests)
            .where(eq(s.page_transform_requests.id, setup.request.id))
            .get()?.result_version_id,
          null
        );
      } finally {
        await fixture.close();
      }
    }
  );
}
