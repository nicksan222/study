/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises authored Page source evidence behavior through real persistence          │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies source correction and replacement retain exact citations, independent         │
 * │   authored copies and user judgments.                                                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { NotesRpc } from '@study/contracts/notes/rpc';
import { PagesRpc } from '@study/contracts/pages/rpc';
import { createBlock, correctBlockText } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import { NotesRpcLive } from '#server/features/notes/rpc/index';
import { Pages } from '#server/features/pages/index';
import { PagesRpcLive } from '#server/features/pages/rpc/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { decodeEvent } from '#server/platform/workflows/events';
import { withTestPublication } from '#testing/publication';

function requireRow<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined);

  return value;
}

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

testStable(
  'source correction and replacement retain exact citations, independent authored copies and user judgments',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const handlers = Layer.mergeAll(PagesRpcLive, NotesRpcLive).pipe(
      Layer.provideMerge(Layer.mergeAll(Pages.layer, Notes.layer, Sources.layer, Settings.layer)),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(PagesRpc.merge(NotesRpc));
            const sources = yield* Sources;
            const notes = yield* Notes;
            const source = yield* sources.createSource({
              name: 'source.txt',
              projectId: null,
              bytes: new TextEncoder().encode('A😀B original')
            });
            const block = createBlock(
              { type: 'paragraph', inlines: [{ type: 'text', text: 'A😀B original', marks: [] }] },
              { type: 'text', lineStart: 0, lineEnd: 0, start: 0, end: 'A😀B original'.length }
            );
            const publish = (document: { blocks: (typeof block)[]; meta: typeof meta }) =>
              Effect.gen(function* () {
                const state = yield* sources.sourceProcessing(source.id);
                const row = context.db.orm.get(
                  sql`SELECT payload FROM workflow_events WHERE correlation_id=${state.requestId} ORDER BY rowid DESC LIMIT 1`
                );

                assert.ok(row);
                const event = decodeEvent(String(row.payload));

                assert.ok(
                  event.type === 'SourceProcessingRequested' ||
                    event.type === 'SourceCorrectionRequested'
                );
                yield* withTestPublication(
                  context,
                  sources.publishSourceDocument({ event, document }).pipe(Effect.asVoid)
                );
                const current = yield* sources.currentExtraction({ id: source.id });

                assert.ok(current);

                return current.snapshotId;
              });
            const first = yield* publish({ blocks: [block], meta });
            const input = {
              kind: 'source' as const,
              sourceId: source.id,
              revision: 1n,
              snapshotId: first
            };

            assert.strictEqual(
              requireRow(context.db.orm.get(sql`SELECT count(*) n FROM materials`)).n,
              0n
            );
            assert.strictEqual(
              requireRow(context.db.orm.get(sql`SELECT count(*) n FROM pages`)).n,
              0n
            );
            const note = yield* rpc['notes.createNote']({ title: 'Historic source' });

            yield* sources.attachSource({ noteId: note.id, sourceId: source.id });
            const range = { blockId: block.id, start: 1, end: 3 };

            yield* rpc['notes.updateNoteSelection']({
              noteId: note.id,
              expectedRevision: 0n,
              targets: [{ input, scope: { kind: 'ranges', ranges: [range] } }]
            });
            const request = yield* rpc['notes.requestReply']({
              noteId: note.id,
              intentKey: randomUUID(),
              instruction: 'Explain the selected passage'
            });

            yield* withTestPublication(
              context,
              notes
                .publishReply({
                  requestId: request.requestId,
                  text: 'Historic citation [1]',
                  citations: [
                    {
                      marker: 1,
                      sourceId: source.id,
                      input,
                      documentId: first,
                      blockOrdinal: 0,
                      selectedRange: { blockId: block.id, start: 0, end: block.text.length },
                      quote: block.text
                    }
                  ]
                })
                .pipe(Effect.asVoid)
            );
            const original = yield* rpc['notes.message']({ id: request.messageId });
            const stored = context.db.orm.select().from(s.citations).all();
            const citation = original.citations[0];

            assert.ok(citation);
            assert.ok(citation.evidence?.availability === 'available');

            if (citation.evidence?.availability === 'available') {
              assert.ok(citation.evidence.excerpt === block.text);
              assert.ok(citation.evidence.precision === 'exact');
            }

            const copy = yield* rpc['pages.copySource']({
              createKey: randomUUID(),
              title: 'Independent copy',
              ...input
            });

            assert.ok(copy.version);
            const copyBlock = copy.version.document.blocks[0]!;
            const annotation = yield* rpc['pages.createAnnotation']({
              target: {
                pageId: copy.id,
                range: {
                  versionId: copy.version.id,
                  snapshotId: copy.version.snapshotId,
                  blockId: copyBlock.id,
                  start: 1,
                  end: 3
                }
              },
              kind: 'highlight',
              note: 'historic'
            });
            const claimBlock = createBlock({
              type: 'paragraph',
              inlines: [{ type: 'text', text: 'Independent [1]', marks: [] }]
            });
            const claim = yield* rpc['pages.create']({
              createKey: randomUUID(),
              title: 'Derivative',
              document: { blocks: [claimBlock], meta },
              inputs: [input],
              citations: [{ marker: 1, input, target: range, anchor: block.anchor, quote: '😀' }]
            });

            assert.ok(claim.version);
            yield* rpc['pages.assessCitation']({
              claim: {
                pageId: claim.id,
                range: {
                  versionId: claim.version.id,
                  snapshotId: claim.version.snapshotId,
                  blockId: claimBlock.id,
                  start: 0,
                  end: claimBlock.text.length
                }
              },
              evidence: input,
              evidenceRange: range,
              marker: 1,
              judgment: 'supports',
              note: 'My assessment of the original extraction'
            });
            const support = () =>
              rpc['pages.assessments']({ versionId: claim.version!.id, marker: 1, limit: 10 });

            assert.ok((yield* support()).items[0]?.state === 'assessed');
            yield* sources.correctBlock({
              id: source.id,
              documentId: first,
              ordinal: 0,
              before: block.text,
              after: 'A😀B corrected'
            });
            assert.strictEqual(yield* sources.currentExtraction({ id: source.id }), null);
            assert.strictEqual(
              (yield* sources.extraction(input)).document.blocks[0]?.text,
              block.text
            );
            assert.ok((yield* support()).items[0]?.state === 'stale');
            const corrected = yield* publish({
              blocks: [correctBlockText(block, 'A😀B corrected')],
              meta: { ...meta, corrected: true }
            });

            assert.notStrictEqual(corrected, first);
            assert.strictEqual(
              (yield* sources.currentExtraction({ id: source.id }))?.snapshotId,
              corrected
            );
            const afterCorrection = yield* rpc['notes.message']({ id: request.messageId });

            expect(afterCorrection.citations).toStrictEqual(original.citations);
            const edited = yield* rpc['notes.editMessage']({
              messageId: request.messageId,
              text: 'Qualified historic citation [1]'
            });

            expect(edited.citations).toStrictEqual(original.citations);
            const restored = yield* rpc['notes.setActiveVersion']({
              messageId: request.messageId,
              versionId: original.activeVersionId!
            });

            expect(restored.citations).toStrictEqual(original.citations);
            yield* sources.replaceSource({
              id: source.id,
              expectedRevision: 1,
              name: 'replacement.txt',
              bytes: new TextEncoder().encode('replacement')
            });
            assert.strictEqual(yield* sources.currentExtraction({ id: source.id }), null);
            assert.ok(
              new TextDecoder().decode(
                (yield* sources.exportRevision({ sourceId: source.id, revision: 1n })).bytes
              ) === 'A😀B original'
            );
            assert.strictEqual(
              (yield* sources.extraction(input)).document.blocks[0]?.text,
              block.text
            );
            expect(
              (yield* rpc['notes.message']({ id: request.messageId })).citations
            ).toStrictEqual(original.citations);
            const retainedCitations = new Set(
              stored.map((old) => `${old.version_id}:${old.marker}`)
            );

            expect(
              context.db.orm
                .select()
                .from(s.citations)
                .all()
                .filter((row) => retainedCitations.has(`${row.version_id}:${row.marker}`))
            ).toStrictEqual(stored);
            expect((yield* rpc['pages.version']({ id: claim.version.id })).inputs).toStrictEqual([
              input
            ]);
            assert.strictEqual(
              (yield* rpc['pages.version']({ id: copy.version.id })).document.blocks[0]?.text,
              block.text
            );
            expect(
              (yield* rpc['pages.annotation']({ id: annotation.annotation.id })).target
            ).toStrictEqual(annotation.annotation.target);
            assert.ok(
              (yield* sources.previewDeletion({ id: source.id })).blockedBy.includes('exact_inputs')
            );
            assert.ok(
              (yield* Effect.flip(sources.deleteSource({ id: source.id }))).kind === 'invalid_input'
            );
            assert.strictEqual(
              requireRow(context.db.orm.get(sql`SELECT count(*) n FROM materials`)).n,
              0n
            );
            expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
          }).pipe(Effect.provide(handlers))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
