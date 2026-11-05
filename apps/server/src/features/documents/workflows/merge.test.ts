import { createBlock } from '@study/contracts/sources/document';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Documents } from '#server/features/documents/index';
import { decodeEvent } from '#server/platform/workflows/events';
import { documentTransformFixture } from '#testing/document-transform';

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
type Fixture = Awaited<ReturnType<typeof documentTransformFixture>>;

function setup(fixture: Fixture) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Documents;
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

function eventFor(fixture: Fixture, requestId: string) {
  const event = decodeEvent(
    fixture.context.db.orm
      .select()
      .from(s.workflowEvents)
      .all()
      .find((row) => row.correlationId === requestId)!.payload
  );
  assert.ok(event.type === 'DocumentGenerationRequested');
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
        notes: [{ kind: 'limit', explanation: 'Combined selected documents', blockOrdinals: [] }]
      }
    }
  );
}

testStable(
  'merge publishes once, retains exact inputs and archives originals only on success',
  async () => {
    const fixture = await documentTransformFixture();
    try {
      const { docs, input, request } = await setup(fixture);
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Documents;
          expect((yield* service.document({ id: docs[0]!.id })).archivedAt).toBeNull();
          expect(yield* service.merge(input)).toEqual(request);
          expect((yield* service.merges({})).map((item) => item.id)).toContain(request.id);
          expect((yield* service.merge({ ...input, title: 'Other' }).pipe(Effect.exit))._tag).toBe(
            'Failure'
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
      const event = eventFor(fixture, request.id);
      reply(fixture);
      const versionId = await fixture.executeAuthored(event, 'merge');
      expect(await fixture.executeAuthored(event, 'merge-replay')).toEqual(versionId);
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Documents;
          const result = yield* service.version({ id: versionId });
          expect(result.inputs).toEqual(
            input.versions.map((versionId) => ({ kind: 'document', versionId }))
          );
          for (const doc of docs) {
            expect((yield* service.document({ id: doc.id })).archivedAt).not.toBeNull();
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
    } finally {
      await fixture.close();
    }
  }
);

testStable(
  'a concurrent edit fences real merge publication and keeps both originals visible',
  async () => {
    const fixture = await documentTransformFixture();
    try {
      const { docs, request } = await setup(fixture);
      reply(fixture);
      fixture.beforeOutput(() =>
        Effect.runPromise(
          Effect.flatMap(Documents, (service) =>
            service.save({
              documentId: docs[0]!.id,
              expectedVersionId: docs[0]!.version!.id,
              key: crypto.randomUUID(),
              document: content()
            })
          ).pipe(Effect.asVoid, Effect.provide(fixture.domain()))
        )
      );
      await expect(
        fixture.executeAuthored(eventFor(fixture, request.id), 'merge-edit')
      ).rejects.toBeDefined();
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Documents;
          for (const doc of docs)
            expect((yield* service.document({ id: doc.id })).archivedAt).toBeNull();
          const result = yield* service.transform({ requestId: request.id });
          expect(result.resultVersionId).toBeNull();
          expect(result.errorKind).toBe('invalid_input');
        }).pipe(Effect.provide(fixture.domain()))
      );
      expect(fixture.context.db.orm.select().from(s.study_documents).all()).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  }
);

testStable(
  'cancelling while the provider runs fences late publication without archiving originals',
  async () => {
    const fixture = await documentTransformFixture();
    try {
      const { docs, request } = await setup(fixture);
      reply(fixture);
      fixture.beforeOutput(() =>
        Effect.runPromise(
          Effect.flatMap(Documents, (service) =>
            service.cancelTransform({
              requestId: request.id
            })
          ).pipe(Effect.asVoid, Effect.provide(fixture.domain()))
        )
      );
      await expect(
        fixture.executeAuthored(eventFor(fixture, request.id), 'merge-cancel')
      ).rejects.toBeDefined();
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Documents;
          for (const doc of docs)
            expect((yield* service.document({ id: doc.id })).archivedAt).toBeNull();
          const result = yield* service.transform({ requestId: request.id });
          expect(result.cancelled).toBe(true);
          expect(result.resultVersionId).toBeNull();
        }).pipe(Effect.provide(fixture.domain()))
      );
      expect(fixture.context.db.orm.select().from(s.study_documents).all()).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  }
);

testStable(
  'duplicate merge inputs are rejected and older pending work stays reachable',
  async () => {
    const fixture = await documentTransformFixture();
    try {
      const { input, request } = await setup(fixture);
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Documents;
          expect(
            (yield* service
              .merge({
                ...input,
                key: crypto.randomUUID(),
                versions: [input.versions[0]!, input.versions[0]!]
              })
              .pipe(Effect.exit))._tag
          ).toBe('Failure');
          for (let index = 0; index < 31; index++)
            yield* service.merge({ ...input, key: crypto.randomUUID() });
          const pending = yield* service.merges({});
          expect(pending).toHaveLength(32);
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
