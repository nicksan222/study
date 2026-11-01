/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies atomic imported material registration and immutable source identity.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises native source RPC, real SQLite rollback, and imported source invariants.     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses public feature services and migrated temporary databases without provider access.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SourcesRpc } from '@study/contracts/sources/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Materials } from '#server/features/materials/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import { SourcesRpcLive } from '#server/features/sources/rpc/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

test('acquisition atomically registers independent uncollected imports before extraction', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const domain = Layer.mergeAll(Sources.layer, Materials.layer, Projects.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );
  const services = SourcesRpcLive.pipe(Layer.provideMerge(domain));

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sources = yield* Sources;
        const materials = yield* Materials;
        const bytes = new TextEncoder().encode('Original');
        const client = yield* RpcTest.makeClient(SourcesRpc, { flatten: true });
        const first = yield* client('sources.createSource', {
          projectId: null,
          name: 'notes.txt',
          bytes
        });
        const second = yield* sources.createSource({ projectId: null, name: 'notes.txt', bytes });
        const list = yield* materials.materials({ archived: false, limit: 10 });
        const collection = yield* (yield* Projects).createProject({ name: 'Pending imports' });

        yield* sources.setSourceProject({ id: first.id, projectId: collection.id });
        const assigned = yield* materials.materials({
          projectId: collection.id,
          archived: false,
          limit: 10
        });

        assert.equal(assigned.items.length, 1);
        assert.equal(assigned.items[0]?.importProcessing?.sourceId, first.id);

        assert.equal(list.items.length, 2);
        assert.notEqual(list.items[0]?.id, list.items[1]?.id);
        const material = yield* materials.material({ id: list.items[0]!.id });

        assert.equal(material.version.kind, 'file');
        assert.equal(material.version.creator, 'import');
        assert.ok('sourceId' in material.version.content);
        assert.ok([first.id, second.id].includes(material.version.content.sourceId));
        assert.deepEqual(
          (yield* materials.materialVersionExport({ id: material.version.id })).bytes,
          bytes
        );
        assert.equal(material.importProcessing?.status, 'pending');
        assert.equal(material.version.content.extracted, null);
        const otherSource = material.version.content.sourceId === first.id ? second.id : first.id;

        assert.equal(
          (yield* Effect.flip(
            materials.createVersion({
              materialId: material.id,
              content: { kind: 'file', sourceId: otherSource }
            })
          )).kind,
          'invalid_input'
        );
        assert.throws(() =>
          context.db.orm.run(sql`DELETE FROM material_imports WHERE material_id=${material.id}`)
        );

        assert.equal(
          (yield* Effect.flip(
            materials.create({ title: 'Duplicate', content: { kind: 'file', sourceId: first.id } })
          )).kind,
          'invalid_input'
        );
      }).pipe(Effect.scoped, Effect.provide(services))
    );
    context.db.orm.run(
      sql`CREATE TRIGGER reject_import BEFORE INSERT ON materials BEGIN SELECT RAISE(ABORT, 'registration unavailable'); END`
    );
    await assert.rejects(
      Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;

          yield* sources.createSource({
            projectId: null,
            name: 'rollback.txt',
            bytes: new TextEncoder().encode('Rollback')
          });
        }).pipe(Effect.provide(services))
      )
    );
    assert.equal(context.db.orm.all(sql`SELECT * FROM sources`).length, 2);
    assert.equal(context.db.orm.all(sql`SELECT * FROM source_snapshots`).length, 2);
  } finally {
    context.close();
    location.cleanup();
  }
});

for (const kind of ['image', 'link'] as const)
  test(`import replacement from ${kind} preserves identity and exact revision exports`, async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const domain = Layer.mergeAll(Sources.layer, Materials.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const materials = yield* Materials;
          const source =
            kind === 'image'
              ? yield* sources.createSource({
                  projectId: null,
                  name: 'image.png',
                  bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
                })
              : yield* sources.addLink({ projectId: null, url: 'https://example.com/original' });
          const original = yield* materials.material({
            id: (yield* materials.materials({ archived: false, limit: 10 })).items[0]!.id
          });
          const oldExport = yield* materials.materialVersionExport({ id: original.version.id });
          assert.equal(original.kind, kind);
          const replacementBytes = new TextEncoder().encode('Replacement text');
          yield* sources.replaceSource({
            id: source.id,
            expectedRevision: 1,
            name: 'replacement.txt',
            bytes: replacementBytes
          });
          const current = yield* materials.material({ id: original.id });
          assert.equal(current.id, original.id);
          assert.equal(current.kind, kind);
          assert.notEqual(current.version.id, original.version.id);
          assert.equal(
            (yield* materials.materials({ archived: false, limit: 10 })).items.length,
            1
          );
          const replacementExport = yield* materials.materialVersionExport({
            id: current.version.id
          });
          assert.equal(replacementExport.source.id, source.id);
          assert.equal(replacementExport.source.kind, 'text');
          assert.equal(replacementExport.source.mime, 'text/plain');
          assert.deepEqual(replacementExport.bytes, replacementBytes);
          assert.deepEqual(
            yield* materials.materialVersionExport({ id: original.version.id }),
            oldExport
          );
          assert.deepEqual(
            (yield* materials.materialVersion({ id: original.version.id })).content,
            original.version.content
          );
        }).pipe(Effect.provide(domain))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  });
