import { createBlock } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises durable document merge capture publication and failure recovery.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verify merge invariants against real SQLite persistence.                               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests exercise public services and production database ownership boundaries.             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import * as s from '@study/db';
import { test } from '@study/testing';
import { Deferred, Effect, Exit, Fiber } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { Pages } from '#server/features/pages/index';
import {
  pageTransformHandler,
  pageTransformWorkflow
} from '#server/features/pages/workflows/transform';
import { reconcileCancellation } from '#server/platform/workflows/cancellation';
import { decodeEvent } from '#server/platform/workflows/events';
import { workflowStore } from '#server/platform/workflows/store';
import { pageTransformFixture } from '#testing/page-transform';
import { withTestAdmission } from '#testing/workflow-admission';

const content = () => ({
  blocks: [
    createBlock({
      type: 'paragraph',
      inlines: [{ type: 'text', text: 'alpha selected', marks: [] }]
    })
  ],
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

type Fixture = Awaited<ReturnType<typeof pageTransformFixture>>;

function setup(fixture: Fixture) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Pages;
      const docs = yield* Effect.all(
        ['First', 'Second'].map((title) =>
          service.create({
            title,
            createKey: crypto.randomUUID(),
            document: content(),
            inputs: [],
            citations: []
          })
        )
      );
      const input = {
        key: crypto.randomUUID(),
        title: 'Combined',
        versions: docs.map((doc) => doc.version!.id),
        instruction: '',
        language: 'english' as const
      };
      const request = yield* service.merge(input);

      return { docs, input, request };
    }).pipe(Effect.provide(fixture.domain()))
  );
}

function eventFor(
  { assert: assertions }: Pick<test.Context, 'assert'>,
  fixture: Fixture,
  requestId: string
) {
  const assert: test.Assert = assertions;

  const event = decodeEvent(
    fixture.context.db.orm
      .select()
      .from(s.workflowEvents)
      .all()
      .find((row) => row.correlationId === requestId)!.payload
  );

  assert.ok(event.type === 'PageGenerationRequested');

  return event;
}

function reply(fixture: Fixture) {
  fixture.replies.push(
    { kind: 'sources', query: 'alpha' },
    {
      kind: 'output',
      output: {
        blocks: [
          { type: 'paragraph', inlines: [{ type: 'text', text: 'alpha merged [1]', marks: [] }] }
        ],
        notes: [{ kind: 'limit', explanation: 'Combined selected pages', blockOrdinals: [] }]
      }
    }
  );
}

test.stable(
  'merge publishes once, retains exact inputs and archives originals only on success',
  async ({ databases, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const fixture = await pageTransformFixture(databases);

    try {
      const { docs, input, request } = await setup(fixture);

      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Pages;

          expect((yield* service.page({ id: docs[0]!.id })).archivedAt).toBeNull();
          expect(yield* service.merge(input)).toEqual(request);
          expect((yield* service.merges({})).map((item) => item.id)).toContain(request.id);
          expect((yield* service.merge({ ...input, title: 'Other' }).pipe(Effect.exit))._tag).toBe(
            'Failure'
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
      const event = eventFor({ assert }, fixture, request.id);

      reply(fixture);
      const versionId = await fixture.executeAuthored(event, 'merge');

      expect(await fixture.executeAuthored(event, 'merge-replay')).toEqual(versionId);
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Pages;
          const result = yield* service.version({ id: versionId });

          expect(result.inputs).toEqual(
            input.versions.map((versionId) => ({ kind: 'page', versionId }))
          );

          for (const doc of docs) {
            expect((yield* service.page({ id: doc.id })).archivedAt).not.toBeNull();
            expect((yield* service.version({ id: doc.version!.id })).document).toEqual(
              doc.version!.document
            );
            yield* service.archive({ id: doc.id, archived: false });
          }

          expect((yield* service.merges({}))[0]!.resultVersionId).toEqual(versionId);
        }).pipe(Effect.provide(fixture.domain()))
      );
      expect(await fixture.executeAuthored(event, 'merge-restored-replay')).toEqual(versionId);
      expect(fixture.bodies).toHaveLength(2);
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Pages;
          const result = yield* service.version({ id: versionId });
          const preview = yield* service.previewDeletion({ id: result.pageId });

          yield* service.delete({ pageId: result.pageId, token: preview.token });
          const retained = yield* service.transform({ requestId: request.id });

          expect(retained.resultVersionId).toEqual(versionId);
          expect(retained.title).toBe('-');
          expect(retained.merge?.title).toBe('-');
          expect(retained.merge?.instruction).toBe('');
          expect(retained.merge?.versions).toEqual(input.versions);
          expect(retained.report).toBeNull();

          for (const doc of docs)
            expect((yield* service.version({ id: doc.version!.id })).document).toEqual(
              doc.version!.document
            );
        }).pipe(Effect.provide(fixture.services()))
      );
    } finally {
      await fixture.close();
    }
  }
);

test.stable(
  'a concurrent edit fences real merge publication and keeps both originals visible',
  async ({ databases, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const fixture = await pageTransformFixture(databases);

    try {
      const { docs, request } = await setup(fixture);

      reply(fixture);
      fixture.beforeOutput(() =>
        Effect.runPromise(
          Effect.flatMap(Pages, (service) =>
            service.save({
              pageId: docs[0]!.id,
              expectedVersionId: docs[0]!.version!.id,
              key: crypto.randomUUID(),
              document: content()
            })
          ).pipe(Effect.asVoid, Effect.provide(fixture.domain()))
        )
      );
      await expect(
        fixture.executeAuthored(eventFor({ assert }, fixture, request.id), 'merge-edit')
      ).rejects.toBeDefined();
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Pages;

          for (const doc of docs)
            expect((yield* service.page({ id: doc.id })).archivedAt).toBeNull();

          const result = yield* service.transform({ requestId: request.id });

          expect(result.resultVersionId).toBeNull();
          expect(result.errorKind).toBe('invalid_input');
        }).pipe(Effect.provide(fixture.domain()))
      );
      expect(fixture.context.db.orm.select().from(s.pages).all()).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  }
);

test.stable(
  'cancelling while the provider runs fences late publication without archiving originals',
  async ({ databases, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const fixture = await pageTransformFixture(databases);

    try {
      const { docs, request } = await setup(fixture);

      reply(fixture);
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
                'merge-cancel',
                { event: eventFor({ assert }, fixture, request.id) },
                engine.execute(pageTransformWorkflow, {
                  executionId: 'merge-cancel',
                  payload: { event: eventFor({ assert }, fixture, request.id) }
                })
              )
            );

            yield* Deferred.await(received);
            yield* (yield* Pages).cancelTransform({ requestId: request.id });
            yield* Deferred.succeed(release, undefined);
            expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true);
            yield* reconcileCancellation(
              fixture.context,
              pageTransformWorkflow,
              'merge-cancel',
              'safe',
              true
            );
            expect(workflowStore(fixture.context).execution('merge-cancel')?.status).toBe(
              'cancelled'
            );
          })
        ).pipe(Effect.provide(fixture.services()), Effect.timeout('10 seconds'))
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Pages;

          for (const doc of docs)
            expect((yield* service.page({ id: doc.id })).archivedAt).toBeNull();

          const result = yield* service.transform({ requestId: request.id });

          expect(result.cancelled).toBe(true);
          expect(result.resultVersionId).toBeNull();
        }).pipe(Effect.provide(fixture.domain()))
      );
      expect(fixture.context.db.orm.select().from(s.pages).all()).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  }
);

test.stable(
  'duplicate merge inputs are rejected and older pending work stays reachable',
  async ({ databases, expect }) => {
    const fixture = await pageTransformFixture(databases);

    try {
      const { input, request } = await setup(fixture);

      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Pages;

          expect(
            (yield* service
              .merge({
                ...input,
                key: crypto.randomUUID(),
                versions: [input.versions[0]!, input.versions[0]!]
              })
              .pipe(Effect.exit))._tag
          ).toBe('Failure');

          for (let index = 0; index < 1000; index++)
            yield* service.merge({ ...input, key: crypto.randomUUID() });

          const pending = yield* service.merges({});

          expect(pending).toHaveLength(1001);
          expect(pending.map((item) => item.id)).toContain(request.id);
          yield* service.cancelTransform({ requestId: request.id });
          expect((yield* service.merges({})).map((item) => item.id)).not.toContain(request.id);
        }).pipe(Effect.provide(fixture.domain()))
      );
    } finally {
      await fixture.close();
    }
  }
);
