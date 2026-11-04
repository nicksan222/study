/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies library identities survive collection and session organization changes.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises real native RPC and service membership mutations.                            │
 * │ - Checks captured generation scope and durable SQLite retention.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses migrated temporary databases and public feature services without provider access.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import { projectIdSchema, materialIdSchema, sessionIdSchema } from '@study/contracts/ids';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import type { MaterialContentInput } from '@study/contracts/materials/schemas';
import { plainBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import { workflowEvents } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';

import { ConversationsRpcLive } from '#server/features/conversations/rpc/index';
import { Conversations } from '#server/features/conversations/service/index';
import { Documents } from '#server/features/documents/index';
import { Materials } from '#server/features/materials/index';
import { Projects } from '#server/features/projects/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { materialRpcHandlers } from '#testing/material-rpc';

const content = {
  kind: 'diagram',
  format: 'mermaid',
  payload: 'flowchart TD\nA-->B'
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
  return Effect.flatMap(Documents, (docs) =>
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
  'native RPC creates an uncollected material shared by quick sessions and preserves it after session deletion',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const handlers = () =>
      Layer.mergeAll(materialRpcHandlers, ConversationsRpcLive).pipe(
        Layer.provide(Layer.mergeAll(Materials.layer, Conversations.layer, Settings.layer)),
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const materials = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
            const conversations = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
            const material = yield* materials('materials.create', { title: 'Library', content });
            const first = yield* conversations('conversations.createSession', { title: 'First' });
            const second = yield* conversations('conversations.createSession', { title: 'Second' });

            for (const session of [first, second])
              yield* materials('materials.attach', {
                sessionId: session.id,
                materialId: material.id
              });

            yield* materials('materials.detach', { sessionId: first.id, materialId: material.id });
            assert.equal(
              (yield* materials('materials.materials', {
                sessionId: second.id,
                limit: 10,
                archived: false
              })).items[0]?.id,
              material.id
            );
            assert.equal(
              (yield* materials('materials.materials', {
                sessionId: first.id,
                limit: 10,
                archived: false
              })).items.length,
              0
            );
            yield* conversations('conversations.deleteSession', { id: second.id });

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

            assert.equal(reopened.version.id, saved.version.id);
            assert.deepEqual(reopened.version.content, content);
            assert.equal(
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
  'flat collections organize shared materials and sessions without owning source bytes or lineage',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const services = () =>
      Layer.mergeAll(
        Projects.layer,
        Materials.layer,
        Documents.layer,
        Sources.layer,
        Conversations.layer
      ).pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects,
            materials = yield* Materials,
            sources = yield* Sources,
            conversations = yield* Conversations;
          const a = yield* projects.createProject({ name: 'A' }),
            b = yield* projects.createProject({ name: 'B' });
          const session = yield* conversations.createSession({ title: 'Quick' });
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
            inputs: [{ kind: 'document', versionId: evidence.version.id }]
          });

          for (const project of [a, b]) {
            yield* projects.addMaterial({ projectId: project.id, materialId: material.id });
            yield* projects.addSession({ projectId: project.id, sessionId: session.id });
          }

          yield* projects.addMaterial({ projectId: a.id, materialId: original.id });
          yield* projects.addMaterial({ projectId: a.id, materialId: material.id });
          assert.equal(
            (yield* materials.materials({ projectId: a.id, archived: false, limit: 10 })).items
              .length,
            2
          );
          yield* projects.removeMaterial({ projectId: a.id, materialId: material.id });
          assert.deepEqual(
            (yield* materials.materials({ projectId: a.id, archived: false, limit: 10 })).items.map(
              (m) => m.id
            ),
            [original.id]
          );
          assert.deepEqual(
            (yield* materials.materials({ projectId: b.id, archived: false, limit: 10 })).items.map(
              (m) => m.id
            ),
            [material.id]
          );
          const outboxBefore = context.db.orm.select().from(workflowEvents).all().length;
          const missingProject = Schema.decodeUnknownSync(projectIdSchema)(999n);
          const missingMaterial = Schema.decodeUnknownSync(materialIdSchema)(999n);
          const missingSession = Schema.decodeUnknownSync(sessionIdSchema)(999n);

          for (const mutation of [
            projects.addMaterial({ projectId: missingProject, materialId: material.id }),
            projects.addMaterial({ projectId: a.id, materialId: missingMaterial }),
            projects.addSession({ projectId: a.id, sessionId: missingSession }),
            materials.create({
              title: 'Rolled back',
              projectId: a.id,
              sessionId: missingSession,
              content
            })
          ])
            assert.equal((yield* Effect.flip(mutation)).kind, 'not_found');

          assert.equal(context.db.orm.select().from(workflowEvents).all().length, outboxBefore);
          assert.equal(
            (yield* materials.materials({ archived: false, limit: 10 })).items.length,
            2
          );
          yield* projects.deleteProject({ id: a.id });

          return { material, original, evidence, source, session, b };
        }).pipe(Effect.provide(services()))
      );

      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials,
            conversations = yield* Conversations,
            sources = yield* Sources;
          const material = yield* materials.material({ id: saved.material.id });

          assert.equal(material.version.id, saved.material.version.id);
          assert.deepEqual(material.version.inputs, [
            { kind: 'document', versionId: saved.evidence.version.id }
          ]);
          assert.deepEqual(material.projectIds, [saved.b.id]);
          assert.deepEqual((yield* conversations.session(saved.session.id)).projectIds, [
            saved.b.id
          ]);
          assert.equal((yield* sources.source(saved.source.id)).id, saved.source.id);
          assert.equal(
            new TextDecoder().decode(
              (yield* sources.exportRevision({ sourceId: saved.source.id, revision: 1n })).bytes
            ),
            'Original bytes'
          );
          assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
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
      Layer.mergeAll(Projects.layer, Materials.layer, Documents.layer, Conversations.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;

          const materials = yield* Materials;
          const docs = yield* Documents;
          const conversations = yield* Conversations;
          const a = yield* projects.createProject({ name: 'Requested' });
          const b = yield* projects.createProject({ name: 'Other membership' });
          const input = yield* createAuthored(a.id, 'Captured');
          const unrelated = yield* createAuthored(a.id, 'Unselected');
          const session = yield* conversations.createSession({ title: 'Selection is not scope' });

          yield* docs.attachProject({ projectId: b.id, documentId: input.id });
          yield* projects.addSession({ projectId: a.id, sessionId: session.id });

          for (const material of [input, unrelated])
            yield* docs.attach({ sessionId: session.id, documentId: material.id });

          const request = yield* materials.requestMaterialGeneration({
            projectId: a.id,
            title: 'Exact',
            kind: 'diagram',
            inputs: [{ kind: 'document', versionId: input.version.id }]
          });

          yield* docs.save({
            documentId: input.id,
            expectedVersionId: input.version.id,
            key: 'advance-head',
            document: authored()
          });
          yield* docs.detachProject({ projectId: a.id, documentId: input.id });
          const events = context.db.orm.select().from(workflowEvents).all();
          const requests = context.db.orm.all(sql`SELECT * FROM material_generation_requests`);

          assert.equal(
            (yield* Effect.flip(materials.materialGeneration({ requestId: request.id }))).kind,
            'invalid_input'
          );
          assert.equal(
            (yield* Effect.flip(
              materials.requestMaterialGeneration({
                projectId: a.id,
                title: 'No fallback',
                kind: 'diagram',
                inputs: [{ kind: 'document', versionId: input.version.id }]
              })
            )).kind,
            'invalid_input'
          );
          assert.deepEqual(context.db.orm.select().from(workflowEvents).all(), events);
          assert.deepEqual(
            context.db.orm.all(sql`SELECT * FROM material_generation_requests`),
            requests
          );

          return { a, b, input, unrelated, session, request };
        }).pipe(Effect.provide(services()))
      );

      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;

          const materials = yield* Materials;
          const docs = yield* Documents;
          const conversations = yield* Conversations;

          assert.equal(
            (yield* Effect.flip(materials.materialGeneration({ requestId: saved.request.id })))
              .kind,
            'invalid_input'
          );
          yield* docs.attachProject({ projectId: saved.a.id, documentId: saved.input.id });
          assert.deepEqual(
            (yield* materials.materialGeneration({ requestId: saved.request.id })).inputs,
            [{ kind: 'document', versionId: saved.input.version.id }]
          );
          yield* projects.removeSession({ projectId: saved.a.id, sessionId: saved.session.id });
          assert.deepEqual((yield* conversations.session(saved.session.id)).projectIds, []);
          assert.equal(
            (yield* docs.documents({ sessionId: saved.session.id, archived: false, limit: 10 }))
              .items.length,
            2
          );
          yield* projects.deleteProject({ id: saved.a.id });
          yield* projects.deleteProject({ id: saved.b.id });
          assert.equal(
            (yield* Effect.flip(materials.materialGeneration({ requestId: saved.request.id })))
              .kind,
            'not_found'
          );
        }).pipe(Effect.provide(services()))
      );
      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* Materials;
          const docs = yield* Documents;
          const conversations = yield* Conversations;

          for (const original of [saved.input, saved.unrelated]) {
            assert.deepEqual((yield* docs.document({ id: original.id })).projectIds, []);
            assert.deepEqual(
              (yield* docs.version({ id: original.version.id })).document,
              original.version.document
            );
          }

          assert.deepEqual((yield* conversations.session(saved.session.id)).projectIds, []);
          assert.equal(
            (yield* docs.documents({ sessionId: saved.session.id, archived: false, limit: 10 }))
              .items.length,
            2
          );
          assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
        }).pipe(Effect.provide(services()))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
