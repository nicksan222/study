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

import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Pages } from '#server/features/pages/index';
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

async function fixture() {
  const location = await createTestDatabase();
  let context = new ServerContext(await location.open());

  return {
    get context() {
      return context;
    },
    services: () =>
      Layer.mergeAll(Pages.layer, Sources.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      ),
    async reopen() {
      context.close();
      context = new ServerContext(await location.open());
    },
    async close() {
      context.close();
      await location.cleanup();
    }
  };
}

testStable(
  'an image exclusive to a losing autosave retains its association and exact snapshot after reopen',
  async () => {
    const f = await fixture();
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const pages = yield* Pages;
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
          const target = yield* pages.create({
            title: 'Target',
            createKey: crypto.randomUUID(),
            inputs: [],
            citations: [],
            document: { blocks: [paragraph('Base')], meta }
          });
          const winner = yield* pages.save({
            pageId: target.id,
            expectedVersionId: target.version!.id,
            key: 'winner',
            document: { blocks: [paragraph('Current')], meta }
          });
          const loser = yield* pages.save({
            pageId: target.id,
            expectedVersionId: target.version!.id,
            key: 'loser',
            document: { blocks: [paragraph('Alternative'), block], meta }
          });

          assert.ok(winner.outcome === 'saved');
          assert.ok(loser.outcome === 'conflict');
          assert.ok((yield* pages.version({ id: loser.submittedVersionId })).status === 'draft');

          return { image, block, target, winner, loser };
        }).pipe(Effect.provide(f.services()))
      );

      await f.reopen();
      const associations = f.context.db.orm
        .select()
        .from(s.document_assets)
        .where(eq(s.document_assets.source_id, setup.image.id))
        .all();

      assert.strictEqual(associations.length, 1);
      assert.strictEqual(associations[0]!.block_id, setup.block.id);
      assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
      expect(
        f.context.db.orm
          .select()
          .from(s.page_versions)
          .where(eq(s.page_versions.content_snapshot_id, associations[0]!.document_id))
          .all()
          .map((row) => row.id)
      ).toStrictEqual([setup.loser.submittedVersionId]);
      assert.strictEqual(f.context.db.orm.select().from(s.page_proposals).all().length, 0);

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
        expect(before()).toStrictEqual(retained);
      }

      await Effect.runPromise(
        Effect.gen(function* () {
          const pages = yield* Pages;
          const version = yield* pages.version({ id: setup.loser.submittedVersionId });

          expect(version.document.blocks[1]).toStrictEqual(setup.block);
          assert.strictEqual(
            (yield* pages.page({ id: setup.target.id })).headVersionId,
            setup.winner.submittedVersionId
          );
          expect(
            (yield* (yield* Sources).sourceSnapshot({ id: setup.image.id, revision: 1 })).bytes
          ).toStrictEqual(bytes);
          assert.throws(() =>
            f.context.db.orm.run(sql`DELETE FROM page_versions WHERE id=${version.id}`)
          );
        }).pipe(Effect.provide(f.services()))
      );
      expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'authored restoration keeps its exact source revision after replacement without following the mutable source head',
  async () => {
    const f = await fixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const pages = yield* Pages;
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
          const derivative = yield* pages.create({
            title: 'Authored',
            createKey: crypto.randomUUID(),
            inputs: [input],
            citations: [],
            document: { blocks: [stable, paragraph('Authored reading')], meta }
          });
          const foreign = yield* pages.create({
            title: 'Other Page',
            createKey: crypto.randomUUID(),
            inputs: [],
            citations: [],
            document: { blocks: [paragraph('Foreign editing identity')], meta }
          });
          const save = {
            pageId: derivative.id,
            expectedVersionId: derivative.version!.id,
            key: 'save',
            document: { blocks: [stable, paragraph('Revised reading')], meta }
          };
          const saved = yield* pages.save(save);
          const output = makeMaterialOutput({ db: f.context.db, clock: f.context.clock });
          const before = output();
          // Reordered object keys are the same intent; block and inline order remain significant.
          const replay = yield* pages.save({
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
            pageId: save.pageId
          });

          assert.ok(replay.replayed === true);
          assert.strictEqual(replay.submittedVersionId, saved.submittedVersionId);
          expect(output()).toStrictEqual(before);
          expect((yield* pages.version({ id: saved.submittedVersionId })).inputs).toStrictEqual([
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
            assert.ok((yield* Effect.flip(pages.save(value))).kind === 'invalid_input');

          expect(output()).toStrictEqual(before);
          yield* sources.replaceSource({
            id: source.id,
            expectedRevision: 1,
            name: 'replacement.txt',
            bytes: new TextEncoder().encode('New imported bytes')
          });
          const undoValue = {
            pageId: derivative.id,
            expectedVersionId: saved.submittedVersionId,
            restoreVersionId: derivative.version!.id,
            key: 'undo-changed-input'
          };
          const undo = yield* pages.restore(undoValue);

          assert.ok(undo.outcome === 'saved');
          assert.strictEqual(undo.currentVersionId, saved.submittedVersionId);
          assert.strictEqual(
            (yield* pages.page({ id: derivative.id })).headVersionId,
            undo.submittedVersionId
          );
          assert.ok((yield* pages.version({ id: undo.submittedVersionId })).status === 'published');
          assert.strictEqual(
            (yield* pages.restore(undoValue)).submittedVersionId,
            undo.submittedVersionId
          );
          assert.ok(
            (yield* Effect.flip(
              pages.restore({ ...undoValue, restoreVersionId: saved.submittedVersionId })
            )).kind === 'invalid_input'
          );
          const oldRevision = yield* sources.exportRevision({ sourceId: source.id, revision: 1n });

          expect(oldRevision.bytes).toStrictEqual(exported.bytes);
          expect((yield* pages.version({ id: undo.submittedVersionId })).inputs).toStrictEqual([
            input
          ]);
        }).pipe(Effect.provide(f.services()))
      );
      expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);
