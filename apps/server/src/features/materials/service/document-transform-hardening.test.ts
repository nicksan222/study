/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Hardens exact transform citations, immutable receipts and empty output barriers.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts failed guarded publications leave all durable output tables unchanged.         │
 * │ - Exercises retained citation targets and legacy draft citation compatibility.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Public services use migrated SQLite and real publication ownership without a provider.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { documentIdSchema, materialVersionIdSchema } from '@study/contracts/ids';
import type { materialGenerationPublicationSchema } from '@study/contracts/materials/schemas';
import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Schema } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
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

function fixture() {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  let output = makeMaterialOutput({ db: context.db, clock: context.clock });

  return {
    get context() {
      return context;
    },
    output: () => output(),
    services: () =>
      Layer.mergeAll(Materials.layer, Conversations.layer, Settings.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      ),
    reopen() {
      context.close();
      context = new ServerContext(location.open());
      output = makeMaterialOutput({ db: context.db, clock: context.clock });
    },
    close() {
      context.close();
      location.cleanup();
    }
  };
}

test('only the selected duplicate range can publish; target identity is hashed, immutable and retained', async () => {
  const f = fixture();

  try {
    const setup = await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const chats = yield* Conversations;
        const session = yield* chats.createSession({ title: 'Ranges' });
        const block = paragraph('😀 echo :: echo');
        const unselected = paragraph('echo');
        const original = yield* materials.create({
          title: 'Repeated phrases',
          content: { kind: 'document', blocks: [block, unselected], meta },
          publish: true
        });

        yield* chats.updateSessionSelection({
          sessionId: session.id,
          expectedRevision: 0n,
          targets: [{ versionId: original.version.id, scope: { kind: 'document' } }]
        });
        const whole = yield* chats.captureSessionContext({
          sessionId: session.id,
          intentKey: 'whole',
          instruction: '',
          preferences: {}
        });
        const target = {
          versionId: original.version.id,
          documentId: whole.inputs[0]!.documentId,
          blockId: block.id,
          start: 11,
          end: 15
        };

        yield* chats.updateSessionSelection({
          sessionId: session.id,
          expectedRevision: 1n,
          targets: [
            {
              versionId: original.version.id,
              scope: { kind: 'ranges', ranges: [target] }
            }
          ]
        });
        const snapshot = yield* chats.captureSessionContext({
          sessionId: session.id,
          intentKey: 'second-echo',
          instruction: '',
          preferences: {}
        });
        const request = yield* chats.requestDocumentTransform({
          contextRequestId: snapshot.requestId,
          title: 'Only selected',
          operations: ['clarity']
        });
        const output = paragraph('echo [1] [2]');
        const publication: typeof materialGenerationPublicationSchema.Type = {
          requestId: request.id,
          language: 'english',
          content: { kind: 'document', blocks: [output], meta },
          citations: [
            {
              marker: 1n,
              inputVersionId: original.version.id,
              blockOrdinal: 0,
              quote: 'echo',
              target
            },
            {
              marker: 2n,
              inputVersionId: original.version.id,
              blockOrdinal: 0,
              quote: 'echo',
              target
            }
          ],
          report: {
            notes: [{ kind: 'limit', explanation: 'Selected evidence only', blockIds: [output.id] }]
          }
        };

        return { original, session, request, target, publication, unselected };
      }).pipe(Effect.provide(f.services()))
    );
    const publish = (publication: typeof materialGenerationPublicationSchema.Type) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* withTestPublication(
            f.context,
            (yield* Conversations).publishDocumentTransform(publication).pipe(Effect.asVoid)
          );
        }).pipe(Effect.provide(f.services()))
      );
    const citation = setup.publication.citations[0]!;
    const invalid = [
      { ...citation, target: undefined },
      { ...citation, target: { ...setup.target, start: 3, end: 7 } },
      { ...citation, target: { ...setup.target, blockId: setup.unselected.id, start: 0, end: 4 } },
      {
        ...citation,
        target: {
          ...setup.target,
          versionId: Schema.decodeUnknownSync(materialVersionIdSchema)(setup.target.versionId + 1n)
        }
      },
      {
        ...citation,
        target: {
          ...setup.target,
          documentId: Schema.decodeUnknownSync(documentIdSchema)(setup.target.documentId + 1n)
        }
      },
      { ...citation, blockOrdinal: 1 },
      { ...citation, quote: '😀' }
    ];
    const before = f.output();

    for (const forged of invalid) {
      await assert.rejects(
        publish({
          ...setup.publication,
          citations: [forged]
        })
      );
      assert.deepEqual(f.output(), before);
    }

    await publish(setup.publication);
    const after = f.output();

    await publish({
      ...setup.publication,
      citations: [...setup.publication.citations].reverse().map((citation) => ({
        ...citation,
        target: {
          end: setup.target.end,
          start: setup.target.start,
          blockId: setup.target.blockId,
          documentId: setup.target.documentId,
          versionId: setup.target.versionId
        }
      }))
    });
    assert.deepEqual(f.output(), after);

    for (const changed of [
      {
        ...setup.publication,
        citations: [
          { ...citation, target: { ...setup.target, start: 3, end: 7 } },
          setup.publication.citations[1]!
        ]
      },
      { ...setup.publication, language: 'italian' },
      {
        ...setup.publication,
        report: { notes: [{ kind: 'limit' as const, explanation: 'Changed', blockIds: [] }] }
      }
    ]) {
      await assert.rejects(publish(changed));
      assert.deepEqual(f.output(), after);
    }

    const versionId = after.requests.find((row) => row.id === setup.request.id)!.result_version_id;

    assert.ok(versionId);

    for (const mutation of [
      sql`UPDATE material_version_citations SET target=NULL WHERE version_id=${versionId}`,
      sql`UPDATE material_version_citations SET target='{}' WHERE version_id=${versionId}`,
      sql`DELETE FROM material_version_citations WHERE version_id=${versionId}`,
      sql`INSERT INTO material_version_citations(version_id,marker,input_version_id,anchor,quote,target) SELECT version_id,3,input_version_id,anchor,quote,target FROM material_version_citations WHERE version_id=${versionId} LIMIT 1`,
      sql`UPDATE material_generation_requests SET result_hash='forged' WHERE id=${setup.request.id}`,
      sql`UPDATE material_generation_requests SET result_metadata=NULL WHERE id=${setup.request.id}`
    ]) {
      assert.throws(() => f.context.db.orm.run(mutation));
      assert.deepEqual(f.output(), after);
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* (yield* Conversations).deleteSession(setup.session.id);
      }).pipe(Effect.provide(f.services()))
    );
    f.reopen();
    await publish(setup.publication);
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const saved = (yield* materials.citations({ id: versionId, limit: 10 })).items;
        const page = yield* materials.citations({ id: versionId, limit: 1, cursor: 1n });

        assert.deepEqual(saved[0]!.target, setup.target);
        assert.deepEqual(page.items[0]!.target, setup.target);
        assert.deepEqual(saved[0]!.anchor, { type: 'authored' });
        assert.deepEqual(
          (yield* materials.materialVersion({ id: setup.original.version.id })).content,
          setup.original.version.content
        );
      }).pipe(Effect.provide(f.services()))
    );
  } finally {
    f.close();
  }
});

test('canonical citation targets reject fabricated identities and UTF16 splits while legacy citations remain usable', async () => {
  const f = fixture();

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const chats = yield* Conversations;
        const block = paragraph('😀 echo');
        const source = yield* materials.create({
          title: 'Evidence',
          content: { kind: 'document', blocks: [block], meta },
          publish: true
        });
        const session = yield* chats.createSession({ title: 'Read' });

        yield* chats.updateSessionSelection({
          sessionId: session.id,
          expectedRevision: 0n,
          targets: [{ versionId: source.version.id, scope: { kind: 'document' } }]
        });
        const capture = yield* chats.captureSessionContext({
          sessionId: session.id,
          intentKey: 'canonical-target',
          instruction: '',
          preferences: {}
        });
        const draft = yield* materials.create({
          title: 'Draft',
          content: { kind: 'document', blocks: [paragraph('echo')], meta },
          inputs: [source.version.id],
          publish: false
        });
        const legacy = {
          marker: 1n,
          inputVersionId: source.version.id,
          anchor: { type: 'authored' as const },
          quote: 'echo'
        };

        yield* materials.setCitations({ id: draft.version.id, citations: [legacy] });
        assert.equal(
          (yield* materials.citations({ id: draft.version.id, limit: 1 })).items[0]!.target,
          undefined
        );
        const target = {
          versionId: source.version.id,
          documentId: capture.inputs[0]!.documentId,
          blockId: block.id,
          start: 3,
          end: 7
        };
        const valid = { ...legacy, target };

        const full = yield* materials.setCitations({ id: draft.version.id, citations: [valid] });

        assert.deepEqual(full, [valid]);
        assert.deepEqual(
          (yield* materials.citations({ id: draft.version.id, limit: 1 })).items,
          full
        );

        for (const invalid of [
          { ...target, start: 1 },
          { ...target, end: 100 },
          { ...target, start: 0, end: 2 },
          {
            ...target,
            documentId: Schema.decodeUnknownSync(documentIdSchema)(target.documentId + 1n)
          },
          {
            ...target,
            versionId: Schema.decodeUnknownSync(materialVersionIdSchema)(source.version.id + 1n)
          },
          {
            ...target,
            blockId:
              draft.version.content.kind === 'document'
                ? draft.version.content.blocks[0]!.id
                : block.id
          }
        ]) {
          const error = yield* Effect.flip(
            materials.setCitations({
              id: draft.version.id,
              citations: [{ ...valid, target: invalid }]
            })
          );

          assert.equal(error.kind, 'invalid_input');
          assert.deepEqual((yield* materials.citations({ id: draft.version.id, limit: 1 })).items, [
            valid
          ]);
        }

        yield* materials.publishVersion({ id: draft.version.id });
        yield* chats.deleteSession(session.id);
        assert.deepEqual((yield* materials.citations({ id: draft.version.id, limit: 10 })).items, [
          valid
        ]);
      }).pipe(Effect.provide(f.services()))
    );
  } finally {
    f.close();
  }
});

test('guarded conversation-only publication rejects separator tables without result, membership or outbox writes', async () => {
  const f = fixture();

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const chats = yield* Conversations;
        const session = yield* chats.createSession({ title: 'Conversation' });

        yield* chats.postMessage({
          sessionId: session.id,
          text: 'Explain this',
          requestReply: false
        });
        const snapshot = yield* chats.captureSessionContext({
          sessionId: session.id,
          intentKey: 'conversation-only',
          instruction: 'Explain',
          preferences: {}
        });
        const request = yield* chats.requestDocumentTransform({
          contextRequestId: snapshot.requestId,
          title: 'Empty table',
          operations: ['explain']
        });
        const before = f.output();
        const table = createBlock({
          type: 'table',
          rows: [
            {
              cells: [
                { header: false, paragraphs: [[]] },
                { header: false, paragraphs: [[]] }
              ]
            }
          ]
        });
        const error = yield* Effect.flip(
          withTestPublication(
            f.context,
            chats
              .publishDocumentTransform({
                requestId: request.id,
                content: { kind: 'document', blocks: [table], meta },
                citations: [],
                report: {
                  notes: [
                    { kind: 'limit', explanation: 'No textual evidence', blockIds: [table.id] }
                  ]
                }
              })
              .pipe(Effect.asVoid)
          )
        );

        assert.equal(error.kind, 'invalid_input');
        assert.deepEqual(f.output(), before);
        assert.equal(
          f.context.db.orm
            .select()
            .from(s.material_generation_requests)
            .where(eq(s.material_generation_requests.id, request.id))
            .get()?.result_version_id,
          null
        );
      }).pipe(Effect.provide(f.services()))
    );
  } finally {
    f.close();
  }
});
