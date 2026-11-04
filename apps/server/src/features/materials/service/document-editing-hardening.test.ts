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

import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Effect, Layer } from 'effect';

import { Materials } from '#server/features/materials/index';
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
      Layer.mergeAll(Materials.layer, Sources.layer).pipe(
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
          const materials = yield* Materials;
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
          const target = yield* materials.createManualDocument({
            title: 'Target',
            document: { blocks: [paragraph('Base')], meta }
          });
          const winner = yield* materials.saveDocument({
            materialId: target.id,
            expectedVersionId: target.version.id,
            saveKey: 'winner',
            document: { blocks: [paragraph('Current')], meta }
          });
          const loser = yield* materials.saveDocument({
            materialId: target.id,
            expectedVersionId: target.version.id,
            saveKey: 'loser',
            document: { blocks: [paragraph('Alternative'), block], meta }
          });

          assert.equal(winner.outcome, 'saved');
          assert.equal(loser.outcome, 'conflict');
          assert.equal(
            (yield* materials.materialVersion({ id: loser.submittedVersionId })).status,
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
      assert.equal(
        f.context.db.orm
          .select()
          .from(s.material_source_snapshots)
          .where(eq(s.material_source_snapshots.source_id, setup.image.id))
          .all().length,
        0
      );
      assert.equal(
        f.context.db.orm
          .select()
          .from(s.material_imports)
          .where(eq(s.material_imports.source_id, setup.image.id))
          .all().length,
        0
      );
      assert.deepEqual(
        f.context.db.orm
          .select()
          .from(s.material_document_versions)
          .where(eq(s.material_document_versions.document_id, associations[0]!.document_id))
          .all()
          .map((row) => row.version_id),
        [setup.loser.submittedVersionId]
      );
      assert.equal(f.context.db.orm.select().from(s.document_proposals).all().length, 0);

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
          const materials = yield* Materials;
          const version = yield* materials.materialVersion({ id: setup.loser.submittedVersionId });

          if (version.content.kind !== 'document') throw new Error('Missing retained Document');

          assert.deepEqual(version.content.blocks[1], setup.block);
          assert.equal(
            (yield* materials.material({ id: setup.target.id })).version.id,
            setup.winner.submittedVersionId
          );
          assert.deepEqual(
            (yield* (yield* Sources).sourceSnapshot({ id: setup.image.id, revision: 1 })).bytes,
            bytes
          );
          assert.equal(
            (yield* Effect.flip(materials.deleteDraft({ id: version.id }))).kind,
            'invalid_input'
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
  'authored derivatives keep imports immutable and undo rejects changed relevant inputs without rewinding',
  async () => {
    const f = fixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials;
          const sources = yield* Sources;
          const source = yield* sources.createSource({
            projectId: null,
            name: 'original.txt',
            bytes: new TextEncoder().encode('Original imported bytes')
          });
          const original = yield* materials.material({
            id: (yield* materials.materials({ archived: false, limit: 10 })).items[0]!.id
          });
          const exported = yield* materials.materialVersionExport({ id: original.version.id });
          const stable = createBlock({ type: 'math', expression: 'a²' });
          const derivative = yield* materials.createManualDocument({
            title: 'Authored',
            inputVersionId: original.version.id,
            document: { blocks: [stable, paragraph('Authored reading')], meta }
          });
          const foreign = yield* materials.createManualDocument({
            title: 'Other Document',
            document: { blocks: [paragraph('Foreign editing identity')], meta }
          });
          const save = {
            materialId: derivative.id,
            expectedVersionId: derivative.version.id,
            saveKey: 'save',
            document: { blocks: [stable, paragraph('Revised reading')], meta }
          };
          const saved = yield* materials.saveDocument(save);
          const output = makeMaterialOutput({ db: f.context.db, clock: f.context.clock });
          const before = output();
          // Reordered object keys are the same intent; block and inline order remain significant.
          const replay = yield* materials.saveDocument({
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
            saveKey: save.saveKey,
            expectedVersionId: save.expectedVersionId,
            materialId: save.materialId
          });

          assert.equal(replay.replayed, true);
          assert.equal(replay.submittedVersionId, saved.submittedVersionId);
          assert.deepEqual(output(), before);
          assert.deepEqual(
            (yield* materials.materialVersion({ id: saved.submittedVersionId })).inputs,
            [original.version.id]
          );

          for (const value of [
            {
              ...save,
              document: { ...save.document, blocks: [...save.document.blocks].reverse() }
            },
            { ...save, expectedVersionId: saved.submittedVersionId },
            { ...save, saveKey: 'wrong-owner', expectedVersionId: original.version.id },
            {
              ...save,
              saveKey: 'foreign-ids',
              document: {
                blocks:
                  foreign.version.content.kind === 'document' ? foreign.version.content.blocks : [],
                meta
              }
            },
            {
              ...save,
              saveKey: 'import-edit',
              materialId: original.id,
              expectedVersionId: original.version.id
            }
          ])
            assert.equal((yield* Effect.flip(materials.saveDocument(value))).kind, 'invalid_input');

          assert.deepEqual(output(), before);
          yield* sources.replaceSource({
            id: source.id,
            expectedRevision: 1,
            name: 'replacement.txt',
            bytes: new TextEncoder().encode('New imported bytes')
          });
          const undoValue = {
            materialId: derivative.id,
            expectedVersionId: saved.submittedVersionId,
            restoreVersionId: derivative.version.id,
            undoKey: 'undo-changed-input'
          };
          const undo = yield* materials.undoDocument(undoValue);

          assert.equal(undo.outcome, 'conflict');
          assert.equal(undo.currentVersionId, saved.submittedVersionId);
          assert.equal(
            (yield* materials.material({ id: derivative.id })).version.id,
            saved.submittedVersionId
          );
          assert.equal(
            (yield* materials.materialVersion({ id: undo.submittedVersionId })).status,
            'draft'
          );
          assert.equal(
            (yield* materials.undoDocument(undoValue)).submittedVersionId,
            undo.submittedVersionId
          );
          assert.equal(
            (yield* Effect.flip(
              materials.undoDocument({ ...undoValue, restoreVersionId: saved.submittedVersionId })
            )).kind,
            'invalid_input'
          );
          assert.deepEqual(
            yield* materials.materialVersionExport({ id: original.version.id }),
            exported
          );
          assert.deepEqual(
            (yield* materials.materialVersion({ id: original.version.id })).content,
            original.version.content
          );
        }).pipe(Effect.provide(f.services()))
      );
      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      f.close();
    }
  }
);
