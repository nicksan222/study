/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies authored document transformation integrity across persistence boundaries. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises immutable captures, publication ownership and exact retained citations.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use real SQLite fixtures and public feature services exclusively.                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { pageVersionIdSchema } from '@study/contracts/ids';
import type { citationSchema } from '@study/contracts/pages/schemas';
import type { transformPublicationSchema } from '@study/contracts/pages/transform';
import { createBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Effect, Schema } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { makeMaterialOutput } from '#testing/material-output';
import { pageTransformFixture } from '#testing/page-transform';
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

type Fixture = Awaited<ReturnType<typeof pageTransformFixture>>;

type Publication = typeof transformPublicationSchema.Type;

function state(f: Fixture) {
  return {
    ...makeMaterialOutput(f.context)(),
    generation: f.context.db.orm.select().from(s.page_generation_requests).all(),
    transforms: f.context.db.orm.select().from(s.page_transform_requests).all()
  };
}

function publish(f: Fixture, value: Publication) {
  return Effect.gen(function* () {
    const chats = yield* Notes;

    yield* withTestPublication(f.context, chats.publishPageTransform(value).pipe(Effect.asVoid));
  }).pipe(Effect.provide(f.domain()));
}

function create(title: string, blocks = [paragraph('alpha evidence')]) {
  return Effect.flatMap(Pages, (docs) =>
    docs.create({
      createKey: crypto.randomUUID(),
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
    const chats = yield* Notes;
    const block = paragraph('😀 echo :: echo');
    const unselected = paragraph('echo');
    const original = yield* create('Repeated phrases', [block, unselected]);
    const note = yield* chats.createUntitledNote({});

    yield* (yield* Pages).attach({ noteId: note.id, pageId: original.id });
    const input = { kind: 'page' as const, versionId: original.version.id };
    const target = {
      blockId: block.id,
      start: 0,
      end: block.text.length
    };

    yield* chats.updateNoteSelection({
      noteId: note.id,
      expectedRevision: 0n,
      targets: [
        { input, scope: exactTarget ? { kind: 'document' } : { kind: 'ranges', ranges: [target] } }
      ]
    });
    const snapshot = yield* chats.captureNoteContext({
      noteId: note.id,
      intentKey: 'selected',
      instruction: 'Clarify',
      preferences: {}
    });
    const request = yield* chats.requestPageTransform({
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
        quote: block.text
      })),
      report: { notes: [{ kind: 'limit', explanation: 'Selected only', blockIds: [output.id] }] }
    };

    return { original, note, input, target, unselected, request, publication };
  });
}

testStable(
  'whole captured blocks publish and exact citation identities and report hashes remain immutable across reopen',
  async () => {
    const f = await pageTransformFixture();

    try {
      const saved = await Effect.runPromise(capture(false).pipe(Effect.provide(f.domain())));
      const cited = saved.publication.citations[0]!;
      const forged: (typeof citationSchema.Type)[] = [
        { ...cited, target: null },
        { ...cited, target: { ...saved.target, start: 3, end: 7 } },
        { ...cited, target: { blockId: saved.unselected.id, start: 0, end: 999 } },
        {
          ...cited,
          input: {
            kind: 'page',
            versionId: Schema.decodeUnknownSync(pageVersionIdSchema)(
              saved.original.version.id + 999n
            )
          }
        },
        { ...cited, quote: '😀' }
      ];
      const before = state(f);

      for (const citation of forged) {
        await expect(
          Effect.runPromise(publish(f, { ...saved.publication, citations: [citation] }))
        ).rejects.toSatisfy(() => true);
        expect(state(f)).toStrictEqual(before);
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
      expect(state(f)).toStrictEqual(after);

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
        await expect(Effect.runPromise(publish(f, changed))).rejects.toSatisfy(() => true);
        expect(state(f)).toStrictEqual(after);
      }

      const versionId = after.transforms.find(
        (row) => row.id === saved.request.id
      )?.result_version_id;

      assert.ok(versionId);

      for (const mutation of [
        sql`UPDATE page_citations SET target=NULL WHERE version_id=${versionId}`,
        sql`UPDATE page_citations SET target='{}' WHERE version_id=${versionId}`,
        sql`DELETE FROM page_citations WHERE version_id=${versionId}`,
        sql`UPDATE page_transform_requests SET result_hash='forged' WHERE id=${saved.request.id}`,
        sql`UPDATE page_transform_requests SET report=NULL WHERE id=${saved.request.id}`
      ]) {
        assert.throws(() => f.context.db.orm.run(mutation));
        expect(state(f)).toStrictEqual(after);
      }

      await f.reopen();
      await Effect.runPromise(publish(f, saved.publication));
      expect(state(f)).toStrictEqual(after);
      await Effect.runPromise(
        Effect.flatMap(Notes, (chats) => chats.deleteNote(saved.note.id)).pipe(
          Effect.provide(f.domain())
        )
      );
      const retired = state(f);

      await Effect.runPromise(publish(f, saved.publication));
      expect(state(f)).toStrictEqual(retired);
      const docs = await Effect.runPromise(Pages.pipe(Effect.provide(f.domain())));
      const version = await Effect.runPromise(
        docs.version({ id: versionId }).pipe(Effect.provide(f.domain()))
      );

      expect(version.citations).toStrictEqual(saved.publication.citations);
      expect(version.inputs).toStrictEqual([saved.input]);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'canonical authored citations reject fabricated exact inputs and UTF16 splits while anchor-only provenance stays explicitly inexact',
  async () => {
    const f = await pageTransformFixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const block = paragraph('😀 echo');
          const evidence = yield* create('Evidence', [block]);
          const input = { kind: 'page' as const, versionId: evidence.version.id };
          const citation = {
            marker: 1,
            input,
            anchor: block.anchor,
            quote: 'echo',
            target: { blockId: block.id, start: 3, end: 7 }
          };
          const write = (value: typeof citationSchema.Type) =>
            docs.create({
              createKey: crypto.randomUUID(),
              title: 'Cited output',
              document: { blocks: [paragraph('echo [1]')], meta },
              inputs: [input],
              citations: [value]
            });
          const exact = yield* write(citation);

          expect(exact.version?.citations).toStrictEqual([citation]);
          const approximate = yield* write({ ...citation, target: null });

          assert.ok(approximate.version?.citations[0]?.target === null);
          const before = state(f);

          for (const target of [
            { ...citation.target, start: 1 },
            { ...citation.target, end: 100 },
            { ...citation.target, start: 0, end: 2 },
            { ...citation.target, blockId: exact.version!.document.blocks[0]!.id }
          ]) {
            assert.ok(
              (yield* Effect.flip(write({ ...citation, target }))).kind === 'invalid_input'
            );
            expect(state(f)).toStrictEqual(before);
          }

          assert.ok(
            (yield* Effect.flip(
              write({
                ...citation,
                input: {
                  kind: 'page',
                  versionId: Schema.decodeUnknownSync(pageVersionIdSchema)(
                    evidence.version.id + 999n
                  )
                }
              })
            )).kind === 'not_found'
          );
          expect(state(f)).toStrictEqual(before);
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'note-only publication rejects separator-only tables without outputs, receipts, memberships or events',
  async () => {
    const f = await pageTransformFixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;
          const note = yield* chats.createUntitledNote({});

          yield* chats.postMessage({
            noteId: note.id,
            text: 'Explain this',
            requestReply: false
          });
          const context = yield* chats.captureNoteContext({
            noteId: note.id,
            intentKey: 'note-only',
            instruction: 'Explain',
            preferences: {}
          });
          const request = yield* chats.requestPageTransform({
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

          assert.ok(failure.kind === 'invalid_input');
          expect(state(f)).toStrictEqual(before);
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);

for (const table of ['page_proposals', 'page_transform_requests'] as const)
  testStable(
    `proposal publication rolls back ${table} failure before same-key retry and reopen`,
    async () => {
      const f = await pageTransformFixture();

      try {
        const saved = await Effect.runPromise(capture(true).pipe(Effect.provide(f.domain())));
        const before = state(f);

        f.context.db.exec(
          table === 'page_proposals'
            ? "CREATE TRIGGER reject_publication BEFORE INSERT ON page_proposals BEGIN SELECT RAISE(ABORT,'fixture rollback'); END"
            : "CREATE TRIGGER reject_publication BEFORE UPDATE OF result_version_id ON page_transform_requests WHEN NEW.result_version_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'fixture rollback'); END"
        );
        await expect(Effect.runPromise(publish(f, saved.publication))).rejects.toSatisfy(
          () => true
        );
        expect(state(f)).toStrictEqual(before);
        f.context.db.exec('DROP TRIGGER reject_publication');
        await Effect.runPromise(publish(f, saved.publication));
        const after = state(f);
        const versionId = after.transforms.find(
          (row) => row.id === saved.request.id
        )?.result_version_id;

        assert.ok(versionId);
        assert.strictEqual(after.proposals[0]?.proposed_version_id, versionId);
        assert.strictEqual(after.proposals[0]?.base_version_id, saved.original.version.id);
        assert.ok(after.pages.find((row) => row.id === versionId)?.status === 'draft');
        assert.strictEqual(after.published.length, before.published.length + 1);
        assert.strictEqual(after.published.at(-1)?.correlationId, saved.request.id);
        assert.ok(
          after.pages.find((row) => row.id === saved.original.version.id)?.status === 'published'
        );
        await Effect.runPromise(publish(f, saved.publication));
        expect(state(f)).toStrictEqual(after);
        await f.reopen();
        await Effect.runPromise(publish(f, saved.publication));
        expect(state(f)).toStrictEqual(after);
        expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      } finally {
        await f.close();
      }
    }
  );
