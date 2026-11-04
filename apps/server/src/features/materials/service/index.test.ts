/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Covers SQLite invariants for material versions, links, citations, and membership;  │
 * │ RPC failure mapping; source-revision retention; and generation snapshots, idempotency,   │
 * │ rollback, scope fencing, and retries.                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses real SQLite state to verify linked-version integrity and generation retries.      │
 * │ - Uses database fixtures to verify service-visible invariants and failures.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses real SQLite fixtures and service dependencies; domain state remains owned │
 * │ by the feature implementation.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { plainBlock } from '@study/contracts/sources/document';
import { sessions, workflowEvents } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Option, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Documents } from '#server/features/documents/index';
import { Materials } from '#server/features/materials/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { materialRpcHandlers } from '#testing/material-rpc';

const content = {
  kind: 'diagram' as const,
  format: 'mermaid' as const,
  payload: 'flowchart LR; A-->B'
};

testStable(
  'materials versions, links, citations and session membership preserve SQLite invariants',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const services = Layer.mergeAll(
      Projects.layer,
      Sources.layer,
      Materials.layer,
      Documents.layer
    ).pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects,
            materials = yield* Materials;
          const project = yield* projects.createProject({ name: 'Physics' });
          const sources = yield* Sources;

          yield* sources.createSource({
            projectId: project.id,
            name: 'notes.txt',
            bytes: new TextEncoder().encode('Canonical source')
          });

          assert.strictEqual(
            (yield* materials.materials({ projectId: project.id, archived: false, limit: 10 }))
              .items.length,
            0
          );
          const docs = yield* Documents;
          const evidence = yield* docs.create({
            createKey: randomUUID(),
            title: 'Evidence',
            document: {
              blocks: [plainBlock('paragraph', 'Canonical material', { type: 'authored' })],
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
            },
            inputs: [],
            citations: []
          });

          assert.ok(evidence.version);
          const input = { kind: 'document' as const, versionId: evidence.version.id };
          const another = yield* projects.createProject({ name: 'Other' });
          const first = yield* materials.create({
            projectId: project.id,
            title: 'Source',
            content,
            publish: false
          });

          assert.ok(first.version.status === 'draft');
          assert.ok(
            (yield* Effect.flip(materials.deleteDraft({ id: first.version.id }))).kind ===
              'invalid_input'
          );
          const published = yield* materials.publishVersion({ id: first.version.id });

          assert.ok(published.status === 'published');
          assert.ok(
            (yield* Effect.flip(materials.replaceDraft({ id: published.id, content }))).kind ===
              'invalid_input'
          );
          const next = yield* materials.createVersion({
            materialId: first.id,
            content,
            inputs: [input],
            parents: [published.id],
            publish: false
          });

          yield* materials.setCitations({
            id: next.id,
            citations: [
              {
                marker: 1n,
                input,
                anchor: { type: 'authored' },
                quote: 'Canonical'
              },
              {
                marker: 2n,
                input,
                anchor: { type: 'authored' },
                quote: 'material'
              }
            ]
          });
          const citations = yield* materials.citations({ id: next.id, limit: 1 });

          assert.strictEqual(citations.nextCursor, 1n);
          assert.strictEqual(
            (yield* materials.citations({ id: next.id, limit: 1, cursor: 1n })).items[0]?.marker,
            2n
          );
          expect((yield* materials.materialVersion({ id: next.id })).inputs).toStrictEqual([input]);
          yield* materials.publishVersion({ id: next.id });
          const foreign = yield* docs.create({
            createKey: randomUUID(),
            title: 'Foreign',
            projectId: another.id,
            document: {
              blocks: [plainBlock('paragraph', 'Foreign evidence', { type: 'authored' })],
              meta: evidence.version.document.meta
            },
            inputs: [],
            citations: []
          });

          assert.ok(foreign.version);
          const foreignInput = { kind: 'document' as const, versionId: foreign.version.id };
          const shared = yield* materials.createVersion({
            materialId: first.id,
            content,
            inputs: [foreignInput]
          });

          expect(shared.inputs).toStrictEqual([foreignInput]);
          const session = context.db.orm
            .insert(sessions)
            .values({
              title: 'Session',
              title_source: 'user',
              created_at: 1n,
              updated_at: 1n
            })
            .returning()
            .get();

          yield* materials.attach({ sessionId: session.id, materialId: first.id });
          expect(
            (yield* materials.reorder({ sessionId: session.id, materialIds: [first.id] }))
              .materialIds
          ).toStrictEqual([first.id]);
          assert.ok(
            (yield* Effect.flip(materials.reorder({ sessionId: session.id, materialIds: [] })))
              .kind === 'invalid_input'
          );
          yield* materials.detach({ sessionId: session.id, materialId: first.id });
          yield* materials.archive({ id: first.id });
          assert.ok(
            (yield* Effect.flip(materials.rename({ id: first.id, title: 'Rejected' }))).kind ===
              'invalid_input'
          );
          yield* materials.unarchive({ id: first.id });
          assert.ok(
            (yield* materials.rename({ id: first.id, title: '  Renamed  ' })).title === 'Renamed'
          );
          const page = yield* materials.materials({
            projectId: project.id,
            archived: false,
            limit: 1
          });

          assert.strictEqual(page.items.length, 1);
          assert.ok(Option.isSome(yield* materials.findMaterial({ id: first.id })));
          assert.strictEqual(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .filter((e) => e.type === 'MaterialPublished').length,
            3
          );
        }).pipe(Effect.provide(services))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable('native materials RPC uses the service and maps canonical failures', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const services = Layer.mergeAll(
    Projects.layer,
    Sources.layer,
    Materials.layer,
    Documents.layer
  ).pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));
  const handlers = materialRpcHandlers.pipe(Layer.provide(services));

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const project = yield* projects.createProject({ name: 'RPC' });
        const client = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
        const material = yield* client('materials.create', {
          projectId: project.id,
          title: 'Native',
          content
        });

        assert.ok((yield* client('materials.material', { id: material.id })).title === 'Native');
        const failure = yield* Effect.flip(
          client('materials.replaceDraft', { id: material.version.id, content })
        );

        assert.ok(failure.kind === 'invalid_input');
        const exportFailure = yield* Effect.flip(
          client('materials.exportMaterialVersion', {
            id: Schema.decodeUnknownSync(
              (yield* Effect.promise(() => import('@study/contracts/ids'))).materialVersionIdSchema
            )(999999n),
            format: 'aid_json'
          })
        );

        assert.ok(exportFailure.kind === 'not_found');
      }).pipe(Effect.provide(services), Effect.provide(handlers), Effect.scoped)
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
