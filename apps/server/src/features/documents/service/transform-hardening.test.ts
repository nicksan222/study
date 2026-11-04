/** Exact authored transform publication keeps selected ranges, immutable receipts and atomic alternatives. */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { citationSchema } from '@study/contracts/documents/schemas';
import type { transformPublicationSchema } from '@study/contracts/documents/transform';
import { studyDocumentVersionIdSchema } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/node';
import { Effect, Schema } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import { documentTransformFixture } from '#testing/document-transform';
import { makeMaterialOutput } from '#testing/material-output';
import { withTestPublication } from '#testing/publication';

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
const paragraph = (text: string) =>
  createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] });
type Fixture = Awaited<ReturnType<typeof documentTransformFixture>>;
type Publication = typeof transformPublicationSchema.Type;
function state(f: Fixture) {
  return {
    ...makeMaterialOutput({ db: f.context.db, clock: f.context.clock })(),
    generation: f.context.db.orm.select().from(s.study_document_generation_requests).all(),
    transforms: f.context.db.orm.select().from(s.study_document_transform_requests).all()
  };
}
function publish(f: Fixture, value: Publication) {
  return Effect.gen(function* () {
    const chats = yield* Conversations;
    yield* withTestPublication(
      f.context,
      chats.publishDocumentTransform(value).pipe(Effect.asVoid)
    );
  }).pipe(Effect.provide(f.domain()));
}
function create(title: string, blocks = [paragraph('alpha evidence')]) {
  return Effect.flatMap(Documents, (docs) =>
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
function capture(exactTarget: boolean) {
  return Effect.gen(function* () {
    const chats = yield* Conversations;
    const block = paragraph('😀 echo :: echo');
    const unselected = paragraph('echo');
    const original = yield* create('Repeated phrases', [block, unselected]);
    const session = yield* chats.createUntitledSession({});
    const input = { kind: 'document' as const, versionId: original.version.id };
    const target = {
      blockId: block.id,
      start: exactTarget ? 0 : 11,
      end: exactTarget ? block.text.length : 15
    };
    yield* chats.updateSessionSelection({
      sessionId: session.id,
      expectedRevision: 0n,
      targets: [
        { input, scope: exactTarget ? { kind: 'document' } : { kind: 'ranges', ranges: [target] } }
      ]
    });
    const snapshot = yield* chats.captureSessionContext({
      sessionId: session.id,
      intentKey: 'selected',
      instruction: 'Clarify',
      preferences: {}
    });
    const request = yield* chats.requestDocumentTransform({
      contextRequestId: snapshot.requestId,
      title: 'Selected only',
      operations: ['clarity'],
      ...(exactTarget ? { editTargetVersionId: original.version.id } : {})
    });
    const output = paragraph('echo [1] [2]');
    const publication: Publication = {
      requestId: request.id,
      generationEventId: request.eventId,
      language: 'english',
      document: { blocks: [output], meta },
      citations: [1, 2].map((marker) => ({
        marker,
        input,
        anchor: block.anchor,
        target,
        quote: exactTarget ? block.text : 'echo'
      })),
      report: { notes: [{ kind: 'limit', explanation: 'Selected only', blockIds: [output.id] }] }
    };
    return { original, session, input, target, unselected, request, publication };
  });
}

testStable(
  'only selected duplicate ranges publish and exact citation identities and report hashes remain immutable across reopen',
  async () => {
    const f = await documentTransformFixture();
    try {
      const saved = await Effect.runPromise(capture(false).pipe(Effect.provide(f.domain())));
      const cited = saved.publication.citations[0]!;
      const forged: (typeof citationSchema.Type)[] = [
        { ...cited, target: null },
        { ...cited, target: { ...saved.target, start: 3, end: 7 } },
        { ...cited, target: { blockId: saved.unselected.id, start: 0, end: 4 } },
        {
          ...cited,
          input: {
            kind: 'document',
            versionId: Schema.decodeUnknownSync(studyDocumentVersionIdSchema)(
              saved.original.version.id + 999n
            )
          }
        },
        { ...cited, quote: '😀' }
      ];
      const before = state(f);
      for (const citation of forged) {
        await assert.rejects(
          Effect.runPromise(publish(f, { ...saved.publication, citations: [citation] }))
        );
        assert.deepEqual(state(f), before);
      }
      await Effect.runPromise(publish(f, saved.publication));
      const after = state(f);
      await Effect.runPromise(
        publish(f, {
          ...saved.publication,
          citations: [...saved.publication.citations].reverse().map((citation) => ({
            ...citation,
            target: {
              end: saved.target.end,
              start: saved.target.start,
              blockId: saved.target.blockId
            }
          }))
        })
      );
      assert.deepEqual(state(f), after);
      for (const changed of [
        { ...saved.publication, language: 'italian' },
        {
          ...saved.publication,
          report: { notes: [{ kind: 'limit' as const, explanation: 'Changed', blockIds: [] }] }
        },
        {
          ...saved.publication,
          citations: [{ ...cited, target: { ...saved.target, start: 3, end: 7 } }]
        }
      ]) {
        await assert.rejects(Effect.runPromise(publish(f, changed)));
        assert.deepEqual(state(f), after);
      }
      const versionId = after.transforms.find(
        (row) => row.id === saved.request.id
      )?.result_version_id;
      assert.ok(versionId);
      for (const mutation of [
        sql`UPDATE study_document_citations SET target=NULL WHERE version_id=${versionId}`,
        sql`UPDATE study_document_citations SET target='{}' WHERE version_id=${versionId}`,
        sql`DELETE FROM study_document_citations WHERE version_id=${versionId}`,
        sql`UPDATE study_document_transform_requests SET result_hash='forged' WHERE id=${saved.request.id}`,
        sql`UPDATE study_document_transform_requests SET report=NULL WHERE id=${saved.request.id}`
      ]) {
        assert.throws(() => f.context.db.orm.run(mutation));
        assert.deepEqual(state(f), after);
      }
      f.reopen();
      await Effect.runPromise(publish(f, saved.publication));
      assert.deepEqual(state(f), after);
      await Effect.runPromise(
        Effect.flatMap(Conversations, (chats) => chats.deleteSession(saved.session.id)).pipe(
          Effect.provide(f.domain())
        )
      );
      const retired = state(f);
      await Effect.runPromise(publish(f, saved.publication));
      assert.deepEqual(state(f), retired);
      const docs = await Effect.runPromise(Documents.pipe(Effect.provide(f.domain())));
      const version = await Effect.runPromise(
        docs.version({ id: versionId }).pipe(Effect.provide(f.domain()))
      );
      assert.deepEqual(version.citations, saved.publication.citations);
      assert.deepEqual(version.inputs, [saved.input]);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'canonical authored citations reject fabricated exact inputs and UTF16 splits while anchor-only provenance stays explicitly inexact',
  async () => {
    const f = await documentTransformFixture();
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Documents;
          const block = paragraph('😀 echo');
          const evidence = yield* create('Evidence', [block]);
          const input = { kind: 'document' as const, versionId: evidence.version.id };
          const citation = {
            marker: 1,
            input,
            anchor: block.anchor,
            quote: 'echo',
            target: { blockId: block.id, start: 3, end: 7 }
          };
          const write = (value: typeof citationSchema.Type) =>
            docs.create({
              createKey: randomUUID(),
              title: 'Cited output',
              document: { blocks: [paragraph('echo [1]')], meta },
              inputs: [input],
              citations: [value]
            });
          const exact = yield* write(citation);
          assert.deepEqual(exact.version?.citations, [citation]);
          const approximate = yield* write({ ...citation, target: null });
          assert.equal(approximate.version?.citations[0]?.target, null);
          const before = state(f);
          for (const target of [
            { ...citation.target, start: 1 },
            { ...citation.target, end: 100 },
            { ...citation.target, start: 0, end: 2 },
            { ...citation.target, blockId: exact.version!.document.blocks[0]!.id }
          ]) {
            assert.equal(
              (yield* Effect.flip(write({ ...citation, target }))).kind,
              'invalid_input'
            );
            assert.deepEqual(state(f), before);
          }
          assert.equal(
            (yield* Effect.flip(
              write({
                ...citation,
                input: {
                  kind: 'document',
                  versionId: Schema.decodeUnknownSync(studyDocumentVersionIdSchema)(
                    evidence.version.id + 999n
                  )
                }
              })
            )).kind,
            'not_found'
          );
          assert.deepEqual(state(f), before);
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'conversation-only publication rejects separator-only tables without outputs, receipts, memberships or events',
  async () => {
    const f = await documentTransformFixture();
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;
          const session = yield* chats.createUntitledSession({});
          yield* chats.postMessage({
            sessionId: session.id,
            text: 'Explain this',
            requestReply: false
          });
          const context = yield* chats.captureSessionContext({
            sessionId: session.id,
            intentKey: 'conversation-only',
            instruction: 'Explain',
            preferences: {}
          });
          const request = yield* chats.requestDocumentTransform({
            contextRequestId: context.requestId,
            title: 'Empty table',
            operations: ['explain']
          });
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
          const before = state(f);
          const failure = yield* Effect.flip(
            publish(f, {
              requestId: request.id,
              generationEventId: request.eventId,
              document: { blocks: [table], meta },
              citations: [],
              report: { notes: [{ kind: 'limit', explanation: 'No text', blockIds: [table.id] }] }
            })
          );
          assert.equal(failure.kind, 'invalid_input');
          assert.deepEqual(state(f), before);
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);

for (const table of ['study_document_proposals', 'study_document_transform_requests'] as const)
  testStable(
    `proposal publication rolls back ${table} failure before same-key retry and reopen`,
    async () => {
      const f = await documentTransformFixture();
      try {
        const saved = await Effect.runPromise(capture(true).pipe(Effect.provide(f.domain())));
        const before = state(f);
        f.context.db.exec(
          table === 'study_document_proposals'
            ? "CREATE TRIGGER reject_publication BEFORE INSERT ON study_document_proposals BEGIN SELECT RAISE(ABORT,'fixture rollback'); END"
            : "CREATE TRIGGER reject_publication BEFORE UPDATE OF result_version_id ON study_document_transform_requests WHEN NEW.result_version_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'fixture rollback'); END"
        );
        await assert.rejects(Effect.runPromise(publish(f, saved.publication)));
        assert.deepEqual(state(f), before);
        f.context.db.exec('DROP TRIGGER reject_publication');
        await Effect.runPromise(publish(f, saved.publication));
        const after = state(f);
        const versionId = after.transforms.find(
          (row) => row.id === saved.request.id
        )?.result_version_id;
        assert.ok(versionId);
        assert.equal(after.proposals[0]?.proposed_version_id, versionId);
        assert.equal(after.proposals[0]?.base_version_id, saved.original.version.id);
        assert.equal(after.documents.find((row) => row.id === versionId)?.status, 'draft');
        assert.equal(after.published.length, before.published.length + 1);
        assert.equal(after.published.at(-1)?.correlationId, saved.request.id);
        assert.equal(
          after.documents.find((row) => row.id === saved.original.version.id)?.status,
          'published'
        );
        await Effect.runPromise(publish(f, saved.publication));
        assert.deepEqual(state(f), after);
        f.reopen();
        await Effect.runPromise(publish(f, saved.publication));
        assert.deepEqual(state(f), after);
        assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
      } finally {
        await f.close();
      }
    }
  );
