/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Hardens retained autosave assets and exact editing ancestry in migrated SQLite.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Isolates a losing draft's asset root from every published import pin.                  │
 * │ - Exercises immutable imports, canonical replay and guarded history restoration.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses real service transactions; no retention or publication guard is                     │
 * │ disabled.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Effect, Layer } from 'effect';

import { Documents } from '#server/features/documents/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { makeMaterialOutput } from '#testing/material-output';
import { createUnregisteredSource } from '#testing/source';

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

  return {
    get context() {
      return context;
    },
    services: () =>
      Layer.mergeAll(Documents.layer, Sources.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      ),
    reopen() {
      context.close();
      context = new ServerContext(location.open());
    },
    close() {
      context.close();
      location.cleanup();
    }
  };
}

testStable(
  'an image exclusive to a losing autosave retains its association and exact snapshot after reopen',
  async () => {
    const f = fixture();
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const documents = yield* Documents;
          // Existing owning-store acquisition fixture avoids a separate published import pin.
          const image = yield* createUnregisteredSource({
            projectId: null,
            name: 'exclusive.png',
            bytes
          });
          const block = createBlock({
            type: 'image',
            sourceId: image.id,
            revision: 1,
            alt: 'Conflict only'
          });
          const target = yield* documents.create({
            title: 'Target',
            createKey: randomUUID(),
            inputs: [],
            citations: [],
            document: { blocks: [paragraph('Base')], meta }
          });
          const winner = yield* documents.save({
            documentId: target.id,
            expectedVersionId: target.version!.id,
            key: 'winner',
            document: { blocks: [paragraph('Current')], meta }
          });
          const loser = yield* documents.save({
            documentId: target.id,
            expectedVersionId: target.version!.id,
            key: 'loser',
            document: { blocks: [paragraph('Alternative'), block], meta }
          });

          assert.equal(winner.outcome, 'saved');
          assert.equal(loser.outcome, 'conflict');
          assert.equal(
            (yield* documents.version({ id: loser.submittedVersionId })).status,
            'draft'
          );

          return { image, block, target, winner, loser };
        }).pipe(Effect.provide(f.services()))
      );

      f.reopen();
      const associations = f.context.db.orm
        .select()
        .from(s.document_assets)
        .where(eq(s.document_assets.source_id, setup.image.id))
        .all();

      assert.equal(associations.length, 1);
      assert.equal(associations[0]!.block_id, setup.block.id);
      assert.equal(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
      assert.deepEqual(
        f.context.db.orm
          .select()
          .from(s.study_document_versions)
          .where(eq(s.study_document_versions.content_snapshot_id, associations[0]!.document_id))
          .all()
          .map((row) => row.id),
        [setup.loser.submittedVersionId]
      );
      assert.equal(f.context.db.orm.select().from(s.study_document_proposals).all().length, 0);

      const before = makeMaterialOutput({ db: f.context.db, clock: f.context.clock });
      const retained = before();

      for (const mutation of [
        sql`DELETE FROM document_assets WHERE document_id=${associations[0]!.document_id}`,
        sql`UPDATE document_assets SET revision=2 WHERE document_id=${associations[0]!.document_id}`,
        sql`UPDATE source_snapshots SET bytes=x'00' WHERE source_id=${setup.image.id} AND revision=1`,
        sql`UPDATE source_snapshots SET mime='text/plain' WHERE source_id=${setup.image.id} AND revision=1`,
        sql`DELETE FROM source_snapshots WHERE source_id=${setup.image.id} AND revision=1`
      ]) {
        assert.throws(() => f.context.db.orm.run(mutation));
        assert.deepEqual(before(), retained);
      }

      await Effect.runPromise(
        Effect.gen(function* () {
          const documents = yield* Documents;
          const version = yield* documents.version({ id: setup.loser.submittedVersionId });

          assert.deepEqual(version.document.blocks[1], setup.block);
          assert.equal(
            (yield* documents.document({ id: setup.target.id })).headVersionId,
            setup.winner.submittedVersionId
          );
          assert.deepEqual(
            (yield* (yield* Sources).sourceSnapshot({ id: setup.image.id, revision: 1 })).bytes,
            bytes
          );
          assert.throws(() =>
            f.context.db.orm.run(sql`DELETE FROM study_document_versions WHERE id=${version.id}`)
          );
        }).pipe(Effect.provide(f.services()))
      );
      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      f.close();
    }
  }
);

testStable(
  'authored restoration keeps its exact source revision after replacement without following the mutable source head',
  async () => {
    const f = fixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const documents = yield* Documents;
          const sources = yield* Sources;
          const source = yield* sources.createSource({
            projectId: null,
            name: 'original.txt',
            bytes: new TextEncoder().encode('Original imported bytes')
          });
          const exported = yield* sources.exportRevision({ sourceId: source.id, revision: 1n });
          const input = {
            kind: 'source' as const,
            sourceId: source.id,
            revision: 1n,
            snapshotId: null
          };
          const stable = createBlock({ type: 'math', expression: 'a²' });
          const derivative = yield* documents.create({
            title: 'Authored',
            createKey: randomUUID(),
            inputs: [input],
            citations: [],
            document: { blocks: [stable, paragraph('Authored reading')], meta }
          });
          const foreign = yield* documents.create({
            title: 'Other Document',
            createKey: randomUUID(),
            inputs: [],
            citations: [],
            document: { blocks: [paragraph('Foreign editing identity')], meta }
          });
          const save = {
            documentId: derivative.id,
            expectedVersionId: derivative.version!.id,
            key: 'save',
            document: { blocks: [stable, paragraph('Revised reading')], meta }
          };
          const saved = yield* documents.save(save);
          const output = makeMaterialOutput({ db: f.context.db, clock: f.context.clock });
          const before = output();
          // Reordered object keys are the same intent; block and inline order remain significant.
          const replay = yield* documents.save({
            document: {
              meta,
              blocks: save.document.blocks.map((block) => ({
                anchor: block.anchor,
                content: block.content,
                text: block.text,
                kind: block.kind,
                id: block.id
              }))
            },
            key: save.key,
            expectedVersionId: save.expectedVersionId,
            documentId: save.documentId
          });

          assert.equal(replay.replayed, true);
          assert.equal(replay.submittedVersionId, saved.submittedVersionId);
          assert.deepEqual(output(), before);
          assert.deepEqual((yield* documents.version({ id: saved.submittedVersionId })).inputs, [
            input
          ]);

          for (const value of [
            {
              ...save,
              document: { ...save.document, blocks: [...save.document.blocks].reverse() }
            },
            { ...save, expectedVersionId: saved.submittedVersionId },
            { ...save, key: 'wrong-owner', expectedVersionId: foreign.version!.id },
            {
              ...save,
              key: 'foreign-ids',
              document: {
                blocks: foreign.version!.document.blocks,
                meta
              }
            }
          ])
            assert.equal((yield* Effect.flip(documents.save(value))).kind, 'invalid_input');

          assert.deepEqual(output(), before);
          yield* sources.replaceSource({
            id: source.id,
            expectedRevision: 1,
            name: 'replacement.txt',
            bytes: new TextEncoder().encode('New imported bytes')
          });
          const undoValue = {
            documentId: derivative.id,
            expectedVersionId: saved.submittedVersionId,
            restoreVersionId: derivative.version!.id,
            key: 'undo-changed-input'
          };
          const undo = yield* documents.restore(undoValue);

          assert.equal(undo.outcome, 'saved');
          assert.equal(undo.currentVersionId, saved.submittedVersionId);
          assert.equal(
            (yield* documents.document({ id: derivative.id })).headVersionId,
            undo.submittedVersionId
          );
          assert.equal(
            (yield* documents.version({ id: undo.submittedVersionId })).status,
            'published'
          );
          assert.equal(
            (yield* documents.restore(undoValue)).submittedVersionId,
            undo.submittedVersionId
          );
          assert.equal(
            (yield* Effect.flip(
              documents.restore({ ...undoValue, restoreVersionId: saved.submittedVersionId })
            )).kind,
            'invalid_input'
          );
          const oldRevision = yield* sources.exportRevision({ sourceId: source.id, revision: 1n });
          assert.deepEqual(oldRevision.bytes, exported.bytes);
          assert.deepEqual((yield* documents.version({ id: undo.submittedVersionId })).inputs, [
            input
          ]);
        }).pipe(Effect.provide(f.services()))
      );
      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      f.close();
    }
  }
);
