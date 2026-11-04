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

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import { createBlock } from '@study/contracts/sources/document';
import type { Block } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/node';
import { Deferred, Effect, Exit, Fiber } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import {
  documentTransformHandler,
  documentTransformWorkflow
} from '#server/features/documents/workflows/transform';
import { Sources } from '#server/features/sources/index';
import { workflowStore } from '#server/platform/workflows/store';
import { documentTransformFixture } from '#testing/document-transform';
import { withTestPublication } from '#testing/publication';
import { libraryState } from '#testing/session-deletion';

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
    const materials = yield* Documents;
    const chats = yield* Conversations;
    const session = yield* chats.createSession({ title: 'Transform' });
    const original = yield* materials.create({
      createKey: randomUUID(),
      inputs: [],
      citations: [],
      title: 'Immutable original',
      document: document(blocks)
    });

    assert.ok(original.version);
    yield* chats.updateSessionSelection({
      sessionId: session.id,
      expectedRevision: 0n,
      targets: [
        {
          input: { kind: 'document', versionId: original.version.id },
          scope: { kind: 'document' }
        }
      ]
    });
    const snapshot = yield* chats.captureSessionContext({
      sessionId: session.id,
      intentKey: 'original-snapshot',
      instruction: 'Keep the uncertainty',
      preferences: { detail: 'brief' }
    });
    const request = yield* chats.requestDocumentTransform({
      contextRequestId: snapshot.requestId,
      title: 'Derivative',
      operations: ['clarity', 'translate']
    });

    return { original: { ...original, version: original.version }, session, snapshot, request };
  });
}

testStable(
  'actual provider JSON images persist as canonical bigint assets and survive reopen/replay',
  async () => {
    const fixture = await documentTransformFixture();

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

      assert.equal(fixture.bodies.length, 2);
      assert.equal(fixture.replies.length, 0);
      fixture.reopen();
      assert.equal(await fixture.executeAuthored(event, 'json-image-replay'), result);
      assert.equal(fixture.bodies.length, 2);
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Documents;
          const read = yield* materials.version({ id: result });

          assert.deepEqual(read.document.blocks[1]!.content, {
            type: 'image',
            sourceId: setup.image.id,
            revision: 1,
            alt: 'Retained image'
          });
          assert.notEqual(read.document.blocks[1]!.id, setup.block.id);
          assert.deepEqual(read.document.blocks[1]!.anchor, { type: 'authored' });
          assert.deepEqual(read.inputs[0], {
            kind: 'document',
            versionId: setup.original.version.id
          });
          assert.deepEqual(
            (yield* materials.version({ id: setup.original.version.id })).document,
            setup.original.version.document
          );
          const chats = yield* Conversations;

          yield* chats.deleteSession(setup.session.id);
          yield* withTestPublication(
            fixture.context,
            chats
              .finishSessionDeletion({ sessionId: setup.session.id, attempt: 1 })
              .pipe(Effect.asVoid)
          );
          const retained = yield* materials.version({ id: result });

          assert.deepEqual(retained.document, read.document);
          assert.deepEqual(
            (yield* (yield* Sources).sourceSnapshot({ id: setup.image.id, revision: 1 })).bytes,
            new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
      await assert.rejects(fixture.executeAuthored(event, 'image-after-session-delete'));
      assert.equal(fixture.bodies.length, 2);
      assert.equal(
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
  testStable(`provider JSON ${mode} cannot publish unauthorized images`, async () => {
    const fixture = await documentTransformFixture();

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
          const chats = yield* Conversations;

          if (mode !== 'alt-range') return { ...initial, image };

          const input = initial.snapshot.inputs[0]!;

          yield* chats.updateSessionSelection({
            sessionId: initial.session.id,
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
          const snapshot = yield* chats.captureSessionContext({
            sessionId: initial.session.id,
            intentKey: 'text-only',
            instruction: 'Explain selected alt text',
            preferences: {}
          });
          const request = yield* chats.requestDocumentTransform({
            contextRequestId: snapshot.requestId,
            title: 'No image authorization',
            operations: ['explain']
          });

          return { ...initial, snapshot, request, image };
        }).pipe(Effect.provide(fixture.domain()))
      );
      const before = fixture.context.db.orm.select().from(s.study_document_versions).all();
      const published = fixture.context.db.orm
        .select()
        .from(s.workflowEvents)
        .all()
        .filter((row) => row.type === 'DocumentPublished');

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
      await assert.rejects(fixture.executeAuthored(fixture.authoredEvent(setup.request.id), mode));
      assert.equal(fixture.bodies.length, 2);
      assert.equal(fixture.replies.length, 0);
      assert.deepEqual(
        fixture.context.db.orm.select().from(s.study_document_versions).all(),
        before
      );
      assert.deepEqual(
        fixture.context.db.orm
          .select()
          .from(s.workflowEvents)
          .all()
          .filter((row) => row.type === 'DocumentPublished'),
        published
      );
      assert.equal(
        fixture.context.db.orm
          .select()
          .from(s.study_document_transform_requests)
          .where(eq(s.study_document_transform_requests.id, setup.request.id))
          .get()?.result_version_id,
        null
      );

      if (mode === 'alt-range') {
        const prompt = fixture.bodies[0]!;

        assert.ok(prompt.includes('assets'));
        assert.ok(!prompt.includes('alpha image'));
      }
    } finally {
      await fixture.close();
    }
  });
}

testStable(
  'transient provider retry keeps the exact original capture after current input and selection change',
  { timeout: 15000 },
  async () => {
    const fixture = await documentTransformFixture();

    try {
      const setup = await Effect.runPromise(
        capture([paragraph('alpha captured')]).pipe(Effect.provide(fixture.domain()))
      );

      fixture.beforeResponse(() =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* (yield* Documents).save({
              documentId: setup.original.id,
              expectedVersionId: setup.original.version.id,
              key: randomUUID(),
              document: document([paragraph('LATEST SECRET')])
            });
            yield* (yield* Conversations).updateSessionSelection({
              sessionId: setup.session.id,
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

      assert.equal(fixture.bodies.length, 3);
      assert.equal(fixture.replies.length, 0);

      for (const body of fixture.bodies) {
        assert.ok(body.includes('alpha captured'));
        assert.ok(!body.includes('LATEST SECRET'));
      }

      const attempts = fixture.context.db.orm
        .select()
        .from(s.workflow_activities)
        .where(eq(s.workflow_activities.execution_id, 'transient-retry'))
        .all();

      assert.deepEqual(
        attempts
          .filter((row) => row.name === 'generate-authored-document')
          .map((row) => Number(row.attempt)),
        [1, 2]
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Documents;
          const read = yield* materials.version({ id: result });
          const retry = yield* (yield* Conversations).retryDocumentTransform({
            requestId: setup.request.id,
            retryId: 'completed-retry'
          });

          assert.equal(retry.contextRequestId, setup.snapshot.requestId);
          assert.equal(retry.resultVersionId, result);
          assert.deepEqual(read.inputs, [
            { kind: 'document', versionId: setup.original.version.id }
          ]);
        }).pipe(Effect.provide(fixture.domain()))
      );
      fixture.reopen();
      assert.equal(
        await fixture.executeAuthored(fixture.authoredEvent(setup.request.id), 'retry-reopen'),
        result
      );
      assert.equal(fixture.bodies.length, 3);
      const regenerated = await Effect.runPromise(
        Effect.gen(function* () {
          const head = (yield* (yield* Documents).document({ id: setup.original.id })).version;

          assert.ok(head);
          const chats = yield* Conversations;

          yield* chats.updateSessionSelection({
            sessionId: setup.session.id,
            expectedRevision: 2n,
            targets: [
              { input: { kind: 'document', versionId: head.id }, scope: { kind: 'document' } }
            ]
          });
          const snapshot = yield* chats.captureSessionContext({
            sessionId: setup.session.id,
            intentKey: 'explicit-regenerate',
            instruction: 'Explain new input',
            preferences: {}
          });
          const request = yield* chats.requestDocumentTransform({
            contextRequestId: snapshot.requestId,
            title: 'New derivative',
            operations: ['explain']
          });

          assert.notEqual(request.id, setup.request.id);

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

      assert.notEqual(second, result);
      await Effect.runPromise(
        Effect.gen(function* () {
          const read = yield* (yield* Documents).version({ id: second });

          assert.deepEqual(read.inputs, [{ kind: 'document', versionId: regenerated.head.id }]);
        }).pipe(Effect.provide(fixture.domain()))
      );
      assert.equal(fixture.bodies.length, 5);
    } finally {
      await fixture.close();
    }
  }
);

testStable(
  'native cancellation before provider response fences publication and never resumes or retries',
  { timeout: 15000 },
  async () => {
    const fixture = await documentTransformFixture();

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
            yield* engine.register(documentTransformWorkflow, documentTransformHandler);
            const fiber = yield* Effect.forkChild(
              engine.execute(documentTransformWorkflow, {
                executionId: 'cancel-before-publication',
                payload: { event }
              })
            );

            yield* Deferred.await(received);
            const cancelled = yield* (yield* Documents).cancelTransform({
              requestId: setup.request.id
            });

            assert.equal(cancelled.cancelled, true);
            yield* Deferred.succeed(release, undefined);
            const exit = yield* Fiber.await(fiber);

            assert.ok(Exit.isFailure(exit));
            assert.equal(
              workflowStore(fixture.context).execution('cancel-before-publication')?.status,
              'cancelled'
            );
            yield* engine.resume(documentTransformWorkflow, 'cancel-before-publication');
            const error = yield* Effect.flip(
              (yield* Conversations).retryDocumentTransform({
                requestId: setup.request.id,
                retryId: 'cancelled-retry'
              })
            );

            assert.equal(error.kind, 'cancelled');
          })
        ).pipe(Effect.provide(fixture.services()), Effect.timeout('10 seconds'))
      );
      assert.equal(fixture.bodies.length, 2);
      assert.equal(fixture.context.db.orm.select().from(s.study_documents).all().length, 1);
      fixture.reopen();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(documentTransformWorkflow, documentTransformHandler);
            yield* engine.resume(documentTransformWorkflow, 'cancel-before-publication');
            const read = yield* (yield* Documents).transform({
              requestId: setup.request.id
            });

            assert.equal(read.cancelled, true);
            assert.equal(read.resultVersionId, null);
          })
        ).pipe(Effect.provide(fixture.services()))
      );
      assert.equal(fixture.bodies.length, 2);
    } finally {
      await fixture.close();
    }
  }
);

testStable(
  'committed publication wins actual native pending and unsafe cancellation before terminal checkpoint',
  { timeout: 15000 },
  async () => {
    const fixture = await documentTransformFixture();

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
            yield* engine.register(
              documentTransformWorkflow,
              holdAfterPublication(published, finish)
            );
            const fiber = yield* Effect.forkChild(
              engine.execute(documentTransformWorkflow, {
                executionId: 'publication-wins',
                payload: { event }
              })
            );

            yield* Deferred.await(published);
            yield* engine.interrupt(documentTransformWorkflow, 'publication-wins');
            assert.equal(workflowStore(fixture.context).interruptMode('publication-wins'), 'safe');
            const materials = yield* Documents;
            const pending = yield* materials.transform({
              requestId: setup.request.id
            });

            assert.ok(pending.resultVersionId);
            assert.equal(pending.cancelled, false);
            yield* engine.interruptUnsafe(documentTransformWorkflow, 'publication-wins');
            yield* Fiber.await(fiber);
            // Unsafe interruption can resume receipt replay before its terminal checkpoint.
            yield* Deferred.succeed(finish, undefined);

            while (
              workflowStore(fixture.context).execution('publication-wins')?.status !== 'cancelled'
            )
              yield* Effect.sleep('10 millis');

            assert.equal(
              workflowStore(fixture.context).execution('publication-wins')?.status,
              'cancelled'
            );
            const read = yield* materials.transform({
              requestId: setup.request.id
            });
            const cancelled = yield* materials.cancelTransform({
              requestId: setup.request.id
            });

            assert.equal(read.cancelled, false);
            assert.equal(cancelled.cancelled, false);
            assert.equal(read.resultVersionId, pending.resultVersionId);
            assert.equal(cancelled.resultVersionId, pending.resultVersionId);

            return pending.resultVersionId;
          })
        ).pipe(Effect.provide(fixture.services()), Effect.timeout('10 seconds'))
      );

      fixture.reopen();
      assert.equal(await fixture.executeAuthored(event, 'publication-wins-replay'), result);
      assert.equal(fixture.bodies.length, 2);
      assert.equal(fixture.context.db.orm.select().from(s.study_documents).all().length, 2);
    } finally {
      await fixture.close();
    }
  }
);

testStable(
  'provider markers preserve distinct duplicate-quote ranges in one block after session deletion',
  async () => {
    const fixture = await documentTransformFixture();

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const block = paragraph('😀 echo :: echo');
          const initial = yield* capture([block, paragraph('echo')]);
          const input = initial.snapshot.inputs[0]!;
          const chats = yield* Conversations;
          const range = {
            blockId: block.id
          };

          yield* chats.updateSessionSelection({
            sessionId: initial.session.id,
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
          const snapshot = yield* chats.captureSessionContext({
            sessionId: initial.session.id,
            intentKey: 'duplicate-ranges',
            instruction: 'Compare the selected occurrences',
            preferences: {}
          });
          const request = yield* chats.requestDocumentTransform({
            contextRequestId: snapshot.requestId,
            title: 'Duplicate evidence',
            operations: ['combine']
          });

          return { ...initial, request, range };
        }).pipe(Effect.provide(fixture.domain()))
      );

      fixture.replies.push(
        { kind: 'sources', query: 'echo' },
        { kind: 'output', output: { blocks: [providerParagraph('Both echo [1] [2]')], notes } }
      );
      const event = fixture.authoredEvent(setup.request.id);
      const result = await fixture.executeAuthored(event, 'duplicate-ranges');
      const retained = await libraryState(fixture, [result]);
      const outputCount = fixture.context.db.orm
        .select()
        .from(s.study_document_versions)
        .all().length;

      await Effect.runPromise(
        Effect.gen(function* () {
          yield* (yield* Conversations).deleteSession(setup.session.id);
        }).pipe(Effect.provide(fixture.domain()))
      );
      fixture.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Documents;
          const saved = (yield* materials.version({ id: result })).citations;

          assert.deepEqual(
            saved.map((citation) => citation.target),
            [
              { ...setup.range, start: 3, end: 7 },
              { ...setup.range, start: 11, end: 15 }
            ]
          );
          assert.deepEqual(
            saved.map(({ quote }) => quote),
            ['echo', 'echo']
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
      await assert.rejects(
        fixture.executeAuthored(event, 'duplicate-ranges-replay'),
        (error: unknown) => error instanceof StudyError && error.kind === 'cancelled'
      );
      assert.deepEqual(await libraryState(fixture, [result]), retained);
      assert.equal(
        fixture.context.db.orm.select().from(s.study_document_versions).all().length,
        outputCount
      );
      assert.equal(fixture.bodies.length, 2);
    } finally {
      await fixture.close();
    }
  }
);

testStable('provider report ordinals cannot reference an unavailable output block', async () => {
  const fixture = await documentTransformFixture();

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
    await assert.rejects(
      fixture.executeAuthored(fixture.authoredEvent(setup.request.id), 'bad-report-reference')
    );
    assert.equal(fixture.bodies.length, 2);
    assert.equal(fixture.context.db.orm.select().from(s.study_documents).all().length, 1);
    assert.equal(
      fixture.context.db.orm
        .select()
        .from(s.study_document_transform_requests)
        .where(eq(s.study_document_transform_requests.id, setup.request.id))
        .get()?.result_version_id,
      null
    );
  } finally {
    await fixture.close();
  }
});

for (const barrier of ['cancel', 'session-delete'] as const) {
  testStable(`native ${barrier} preflight prevents provider dispatch`, async () => {
    const fixture = await documentTransformFixture();

    try {
      const setup = await Effect.runPromise(
        capture([paragraph('alpha selected')]).pipe(Effect.provide(fixture.domain()))
      );
      const event = fixture.authoredEvent(setup.request.id);

      await Effect.runPromise(
        Effect.gen(function* () {
          if (barrier === 'cancel')
            yield* (yield* Documents).cancelTransform({ requestId: setup.request.id });
          else yield* (yield* Conversations).deleteSession(setup.session.id);
        }).pipe(Effect.provide(fixture.domain()))
      );
      await assert.rejects(fixture.executeAuthored(event, `preflight-${barrier}`));
      assert.equal(fixture.bodies.length, 0);
      assert.equal(fixture.context.db.orm.select().from(s.study_documents).all().length, 1);
      assert.equal(
        fixture.context.db.orm
          .select()
          .from(s.study_document_transform_requests)
          .where(eq(s.study_document_transform_requests.id, setup.request.id))
          .get()?.result_version_id,
        null
      );
    } finally {
      await fixture.close();
    }
  });
}

/** Hold the real handler after publication while the native checkpoint is still pending. */
function holdAfterPublication(published: Deferred.Deferred<void>, finish: Deferred.Deferred<void>) {
  return (payload: typeof documentTransformWorkflow.payloadSchema.Type) =>
    documentTransformHandler(payload).pipe(
      Effect.tap(Deferred.succeed(published, undefined)),
      Effect.tap(Deferred.await(finish))
    );
}
