/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies library identities survive collection and note organization changes.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises real native RPC and service membership mutations.                            │
 * │ - Checks captured generation scope and durable SQLite retention.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses migrated temporary databases and public feature services without provider access.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { projectIdSchema, materialIdSchema, noteIdSchema } from '@study/contracts/ids';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import type { MaterialContentInput } from '@study/contracts/materials/schemas';
import { NotesRpc } from '@study/contracts/notes/rpc';
import { plainBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import { workflowEvents } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Materials } from '#server/features/materials/index';
import { NotesRpcLive } from '#server/features/notes/rpc/index';
import { Notes } from '#server/features/notes/service/index';
import { Pages } from '#server/features/pages/index';
import { Projects } from '#server/features/projects/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { materialRpcHandlers } from '#testing/material-rpc';

const content = {
  kind: 'flashcards',
  cards: [{ front: 'flowchart TD\nA-->B', back: 'Answer' }]
} satisfies MaterialContentInput;

const authored = () => ({
  blocks: [plainBlock('paragraph', 'Independent library', { type: 'authored' })],
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

function createAuthored(projectId: typeof projectIdSchema.Type, title: string) {
  return Effect.flatMap(Pages, (docs) =>
    docs.create({
      createKey: randomUUID(),
      projectId,
      title,
      document: authored(),
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

testStable(
  'native RPC creates an uncollected material shared by quick notes and preserves it after note deletion',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const handlers = () =>
      Layer.mergeAll(materialRpcHandlers, NotesRpcLive).pipe(
        Layer.provide(Layer.mergeAll(Materials.layer, Notes.layer, Settings.layer)),
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const materials = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
            const notes = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
            const material = yield* materials('materials.create', { title: 'Library', content });
            const first = yield* notes('notes.createNote', { title: 'First' });
            const second = yield* notes('notes.createNote', { title: 'Second' });

            for (const note of [first, second])
              yield* materials('materials.attach', {
                noteId: note.id,
                materialId: material.id
              });

            yield* materials('materials.detach', { noteId: first.id, materialId: material.id });
            assert.strictEqual(
              (yield* materials('materials.materials', {
                noteId: second.id,
                limit: 10,
                archived: false
              })).items[0]?.id,
              material.id
            );
            assert.strictEqual(
              (yield* materials('materials.materials', {
                noteId: first.id,
                limit: 10,
                archived: false
              })).items.length,
              0
            );
            yield* notes('notes.deleteNote', { id: second.id });

            return material;
          }).pipe(Effect.provide(handlers()))
        )
      );

      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const materials = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
            const reopened = yield* materials('materials.material', { id: saved.id });

            assert.strictEqual(reopened.version.id, saved.version.id);
            expect(reopened.version.content).toStrictEqual(saved.version.content);
            assert.strictEqual(
              (yield* materials('materials.materials', { limit: 10, archived: false })).items[0]
                ?.id,
              saved.id
            );
          }).pipe(Effect.provide(handlers()))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'flat collections organize shared materials and notes without owning source bytes or lineage',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const services = () =>
      Layer.mergeAll(Projects.layer, Materials.layer, Pages.layer, Sources.layer, Notes.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects,
            materials = yield* Materials,
            sources = yield* Sources,
            notes = yield* Notes;
          const a = yield* projects.createProject({ name: 'A' }),
            b = yield* projects.createProject({ name: 'B' });
          const note = yield* notes.createNote({ title: 'Quick' });
          const source = yield* sources.createSource({
            name: 'original.txt',
            projectId: a.id,
            bytes: new TextEncoder().encode('Original bytes')
          });
          const original = yield* materials.create({
            projectId: a.id,
            title: 'Independent learning diagram',
            content
          });
          const evidence = yield* createAuthored(a.id, 'Exact authored input');
          const material = yield* materials.create({
            title: 'Shared',
            content,
            inputs: [{ kind: 'page', versionId: evidence.version.id }]
          });

          for (const project of [a, b]) {
            yield* projects.addMaterial({ projectId: project.id, materialId: material.id });
            yield* projects.addNote({ projectId: project.id, noteId: note.id });
          }

          yield* projects.addMaterial({ projectId: a.id, materialId: original.id });
          yield* projects.addMaterial({ projectId: a.id, materialId: material.id });
          assert.strictEqual(
            (yield* materials.materials({ projectId: a.id, archived: false, limit: 10 })).items
              .length,
            2
          );
          yield* projects.removeMaterial({ projectId: a.id, materialId: material.id });
          expect(
            (yield* materials.materials({ projectId: a.id, archived: false, limit: 10 })).items.map(
              (m) => m.id
            )
          ).toStrictEqual([original.id]);
          expect(
            (yield* materials.materials({ projectId: b.id, archived: false, limit: 10 })).items.map(
              (m) => m.id
            )
          ).toStrictEqual([material.id]);
          const outboxBefore = context.db.orm.select().from(workflowEvents).all().length;
          const missingProject = Schema.decodeUnknownSync(projectIdSchema)(999n);
          const missingMaterial = Schema.decodeUnknownSync(materialIdSchema)(999n);
          const missingNote = Schema.decodeUnknownSync(noteIdSchema)(999n);

          for (const mutation of [
            projects.addMaterial({ projectId: missingProject, materialId: material.id }),
            projects.addMaterial({ projectId: a.id, materialId: missingMaterial }),
            projects.addNote({ projectId: a.id, noteId: missingNote }),
            materials.create({
              title: 'Rolled back',
              projectId: a.id,
              noteId: missingNote,
              content
            })
          ])
            assert.ok((yield* Effect.flip(mutation)).kind === 'not_found');

          assert.strictEqual(
            context.db.orm.select().from(workflowEvents).all().length,
            outboxBefore
          );
          assert.strictEqual(
            (yield* materials.materials({ archived: false, limit: 10 })).items.length,
            2
          );
          yield* projects.deleteProject({ id: a.id });

          return { material, original, evidence, source, note, b };
        }).pipe(Effect.provide(services()))
      );

      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials,
            notes = yield* Notes,
            sources = yield* Sources;
          const material = yield* materials.material({ id: saved.material.id });

          assert.strictEqual(material.version.id, saved.material.version.id);
          expect(material.version.inputs).toStrictEqual([
            { kind: 'page', versionId: saved.evidence.version.id }
          ]);
          expect(material.projectIds).toStrictEqual([saved.b.id]);
          expect((yield* notes.note(saved.note.id)).projectIds).toStrictEqual([saved.b.id]);
          assert.strictEqual((yield* sources.source(saved.source.id)).id, saved.source.id);
          assert.ok(
            new TextDecoder().decode(
              (yield* sources.exportRevision({ sourceId: saved.source.id, revision: 1n })).bytes
            ) === 'Original bytes'
          );
          expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
        }).pipe(Effect.provide(services()))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'generation scope stays exact across shared membership removal, reopen and last collection deletion',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const services = () =>
      Layer.mergeAll(Projects.layer, Materials.layer, Pages.layer, Notes.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;

          const materials = yield* Materials;
          const docs = yield* Pages;
          const notes = yield* Notes;
          const a = yield* projects.createProject({ name: 'Requested' });
          const b = yield* projects.createProject({ name: 'Other membership' });
          const input = yield* createAuthored(a.id, 'Captured');
          const unrelated = yield* createAuthored(a.id, 'Unselected');
          const note = yield* notes.createNote({ title: 'Selection is not scope' });

          yield* docs.attachProject({ projectId: b.id, pageId: input.id });
          yield* projects.addNote({ projectId: a.id, noteId: note.id });

          for (const material of [input, unrelated])
            yield* docs.attach({ noteId: note.id, pageId: material.id });

          const request = yield* materials.requestMaterialGeneration({
            projectId: a.id,
            title: 'Exact',
            kind: 'flashcards',
            inputs: [{ kind: 'page', versionId: input.version.id }]
          });

          yield* docs.save({
            pageId: input.id,
            expectedVersionId: input.version.id,
            key: 'advance-head',
            document: authored()
          });
          yield* docs.detachProject({ projectId: a.id, pageId: input.id });
          const events = context.db.orm.select().from(workflowEvents).all();
          const requests = context.db.orm.all(sql`SELECT * FROM material_generation_requests`);

          assert.ok(
            (yield* Effect.flip(materials.materialGeneration({ requestId: request.id }))).kind ===
              'invalid_input'
          );
          assert.ok(
            (yield* Effect.flip(
              materials.requestMaterialGeneration({
                projectId: a.id,
                title: 'No fallback',
                kind: 'flashcards',
                inputs: [{ kind: 'page', versionId: input.version.id }]
              })
            )).kind === 'invalid_input'
          );
          expect(context.db.orm.select().from(workflowEvents).all()).toStrictEqual(events);
          expect(context.db.orm.all(sql`SELECT * FROM material_generation_requests`)).toStrictEqual(
            requests
          );

          return { a, b, input, unrelated, note, request };
        }).pipe(Effect.provide(services()))
      );

      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;

          const materials = yield* Materials;
          const docs = yield* Pages;
          const notes = yield* Notes;

          assert.ok(
            (yield* Effect.flip(materials.materialGeneration({ requestId: saved.request.id })))
              .kind === 'invalid_input'
          );
          yield* docs.attachProject({ projectId: saved.a.id, pageId: saved.input.id });
          expect(
            (yield* materials.materialGeneration({ requestId: saved.request.id })).inputs
          ).toStrictEqual([{ kind: 'page', versionId: saved.input.version.id }]);
          yield* projects.removeNote({ projectId: saved.a.id, noteId: saved.note.id });
          expect((yield* notes.note(saved.note.id)).projectIds).toStrictEqual([]);
          assert.strictEqual(
            (yield* docs.pages({ noteId: saved.note.id, archived: false, limit: 10 })).items.length,
            2
          );
          yield* projects.deleteProject({ id: saved.a.id });
          yield* projects.deleteProject({ id: saved.b.id });
          assert.ok(
            (yield* Effect.flip(materials.materialGeneration({ requestId: saved.request.id })))
              .kind === 'not_found'
          );
        }).pipe(Effect.provide(services()))
      );
      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* Materials;
          const docs = yield* Pages;
          const notes = yield* Notes;

          for (const original of [saved.input, saved.unrelated]) {
            expect((yield* docs.page({ id: original.id })).projectIds).toStrictEqual([]);
            expect((yield* docs.version({ id: original.version.id })).document).toStrictEqual(
              original.version.document
            );
          }

          expect((yield* notes.note(saved.note.id)).projectIds).toStrictEqual([]);
          assert.strictEqual(
            (yield* docs.pages({ noteId: saved.note.id, archived: false, limit: 10 })).items.length,
            2
          );
          expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
        }).pipe(Effect.provide(services()))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
