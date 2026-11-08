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

import type { ProjectId } from '@study/contracts/ids';
import { MaterialsRpc, requestMaterialGenerationInputSchema } from '@study/contracts/materials/rpc';
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
import { Pages } from '#server/features/pages/index';
import { Projects } from '#server/features/projects/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { decodeEvent } from '#server/platform/workflows/events';
import { materialRpcHandlers } from '#testing/material-rpc';

const document = () => ({
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
});

function createEvidence(input: { projectId: ProjectId; title: string }) {
  return Effect.flatMap(Pages, (docs) =>
    docs.create({
      ...input,
      createKey: randomUUID(),
      document: document(),
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

testStable('quiz settings persist as request intent and reject changed settings', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const services = Layer.mergeAll(Projects.layer, Materials.layer, Pages.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const materials = yield* Materials;
        const project = yield* projects.createProject({ name: 'Configured quizzes' });
        const doc = yield* createEvidence({ projectId: project.id, title: 'Evidence' });
        const input = { kind: 'page' as const, versionId: doc.version.id };
        const quizConfig = {
          questionCount: 2,
          choiceCount: 3,
          questionKind: 'choice' as const,
          difficulty: 'challenging' as const
        };
        const request = {
          projectId: project.id,
          title: 'Quiz',
          autoTitle: true,
          kind: 'quiz' as const,
          inputs: [input],
          quizConfig
        };

        yield* materials.requestMaterialGenerationOnce({ requestId: 'configured-quiz', request });
        expect(
          (yield* materials.materialGeneration({ requestId: 'configured-quiz' })).quizConfig
        ).toStrictEqual(quizConfig);
        assert.strictEqual(
          (yield* materials.materialGeneration({ requestId: 'configured-quiz' })).autoTitle,
          true
        );
        assert.strictEqual(
          (yield* Effect.flip(
            materials.requestMaterialGenerationOnce({
              requestId: 'configured-quiz',
              request: { ...request, autoTitle: false }
            })
          )).kind,
          'invalid_input'
        );
        yield* materials.requestMaterialGenerationOnce({ requestId: 'configured-quiz', request });

        for (const change of [
          { questionCount: 3 },
          { choiceCount: 4 },
          { questionKind: 'open' as const },
          { difficulty: 'easy' as const }
        ])
          assert.strictEqual(
            (yield* Effect.flip(
              materials.requestMaterialGenerationOnce({
                requestId: 'configured-quiz',
                request: { ...request, quizConfig: { ...quizConfig, ...change } }
              })
            )).kind,
            'invalid_input'
          );
      }).pipe(Effect.provide(services))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable(
  'generation requests persist immutable published document inputs and an outbox event',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const services = Layer.mergeAll(Projects.layer, Materials.layer, Pages.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const materials = yield* Materials;
          const project = yield* projects.createProject({ name: 'Generation' });
          const doc = yield* createEvidence({ projectId: project.id, title: 'Document' });
          const request = yield* materials.requestMaterialGeneration({
            projectId: project.id,
            title: ' Cards ',
            kind: 'flashcards',
            inputs: [{ kind: 'page' as const, versionId: doc.version.id }]
          });

          assert.ok(request.title === 'Cards');
          expect(request.inputs).toStrictEqual([
            { kind: 'page' as const, versionId: doc.version.id }
          ]);
          assert.strictEqual(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .filter((event) => event.type === 'MaterialGenerationRequested').length,
            1
          );
        }).pipe(Effect.provide(services))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable('generation validation, rollback, RPC, and persistent snapshots', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  const makeServices = () =>
    Layer.mergeAll(Projects.layer, Materials.layer, Pages.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
  let requestId = '';
  let pageId = 0n;
  let versionId = 0n;
  let otherRequestId = '';

  try {
    const services = makeServices();
    const handlers = materialRpcHandlers.pipe(Layer.provide(services));

    function* verifyGenerationSnapshots() {
      const projects = yield* Projects;
      const materials = yield* Materials;
      const client = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
      const project = yield* projects.createProject({ name: 'One' });
      const other = yield* projects.createProject({ name: 'Two' });
      const doc = yield* createEvidence({ projectId: project.id, title: 'Doc' });
      const foreign = yield* createEvidence({ projectId: other.id, title: 'Foreign' });
      const draftOwner = yield* createEvidence({ projectId: project.id, title: 'Draft' });
      const docs = yield* Pages;

      yield* docs.save({
        pageId: draftOwner.id,
        expectedVersionId: draftOwner.version.id,
        key: randomUUID(),
        document: document()
      });
      const alternative = yield* docs.save({
        pageId: draftOwner.id,
        expectedVersionId: draftOwner.version.id,
        key: randomUUID(),
        document: document()
      });
      const draft = yield* docs.version({ id: alternative.submittedVersionId });
      const archived = yield* createEvidence({ projectId: project.id, title: 'Archived' });

      yield* docs.archive({ id: archived.id, archived: true });
      const diagram = yield* materials.create({
        projectId: project.id,
        title: 'Diagram',
        content: { kind: 'diagram', format: 'mermaid', payload: 'graph TD' }
      });
      const base = { projectId: project.id, title: 'Generated', kind: 'quiz' as const };

      for (const id of [foreign.version.id, draft.id, archived.version.id]) {
        assert.ok(
          (yield* Effect.flip(
            materials.requestMaterialGeneration({
              ...base,
              inputs: [{ kind: 'page' as const, versionId: id }]
            })
          )).kind === 'invalid_input'
        );
      }

      const parse = Schema.decodeUnknownSync(requestMaterialGenerationInputSchema);

      assert.throws(() =>
        parse({ ...base, inputs: [{ kind: 'material', versionId: diagram.version.id }] })
      );

      assert.throws(() =>
        parse({
          ...base,
          inputs: [
            { kind: 'page' as const, versionId: doc.version.id },
            { kind: 'page' as const, versionId: doc.version.id }
          ]
        })
      );
      assert.throws(() => parse({ ...base, inputs: [] }));
      assert.throws(() =>
        parse({
          ...base,
          inputs: Array.from({ length: 21 }, (_, i) => ({
            kind: 'page',
            versionId: BigInt(i + 1)
          }))
        })
      );
      assert.strictEqual(
        context.db.orm.all(sql`SELECT * FROM material_generation_requests`).length,
        0
      );
      context.db.exec(
        "CREATE TRIGGER reject_generation_event BEFORE INSERT ON workflow_events WHEN new.type='MaterialGenerationRequested' BEGIN SELECT RAISE(ABORT, 'rejected'); END"
      );
      yield* Effect.flip(
        materials.requestMaterialGeneration({
          ...base,
          inputs: [{ kind: 'page' as const, versionId: doc.version.id }]
        })
      );
      assert.strictEqual(
        context.db.orm.all(sql`SELECT * FROM material_generation_requests`).length,
        0
      );
      assert.strictEqual(context.db.orm.all(sql`SELECT * FROM material_evidence_inputs`).length, 0);
      context.db.exec('DROP TRIGGER reject_generation_event');
      const request = yield* client('materials.requestMaterialGeneration', {
        ...base,
        inputs: [{ kind: 'page' as const, versionId: doc.version.id }],
        instruction: 'Focus'
      });
      const snapshot = yield* materials.materialGeneration({ requestId: request.id });

      requestId = request.id;
      versionId = doc.version.id;
      pageId = doc.version.snapshotId;
      assert.ok(snapshot.instruction === 'Focus');
      const event = context.db.orm
        .select()
        .from(workflowEvents)
        .all()
        .find((row) => row.eventId === request.id)!;

      expect(decodeEvent(event.payload)).toStrictEqual({
        type: 'MaterialGenerationRequested',
        eventId: request.id,
        causationId: null,
        correlationId: request.id,
        inputVersion: 1,
        depth: 0,
        requestId: request.id,
        projectId: project.id,
        kind: 'quiz'
      });
      yield* docs.save({
        pageId: doc.id,
        expectedVersionId: doc.version.id,
        key: randomUUID(),
        document: document()
      });
      const otherRequest = yield* materials.requestMaterialGeneration({
        projectId: other.id,
        title: 'Other',
        kind: 'diagram',
        inputs: [{ kind: 'page' as const, versionId: foreign.version.id }]
      });

      otherRequestId = otherRequest.id;
      assert.throws(() =>
        context.db.orm.run(sql`DELETE FROM page_versions WHERE id=${doc.version.id}`)
      );
    }

    await Effect.runPromise(
      Effect.gen(verifyGenerationSnapshots).pipe(
        Effect.provide(services),
        Effect.provide(handlers),
        Effect.scoped
      )
    );
    context.close();
    context = new ServerContext(location.open());
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const snapshot = yield* materials.materialGeneration({ requestId });

        expect(snapshot.inputs).toStrictEqual([{ kind: 'page', versionId }]);
        const docs = yield* Pages;
        const exact = snapshot.inputs[0];

        assert.ok(exact?.kind === 'page');
        assert.strictEqual((yield* docs.version({ id: exact.versionId })).snapshotId, pageId);
        context.db.orm.run(sql`DELETE FROM projects WHERE id=${snapshot.projectId}`);
        assert.strictEqual(
          (yield* materials.materialGeneration({ requestId: otherRequestId })).id,
          otherRequestId
        );
        assert.strictEqual(
          context.db.orm.all(sql`SELECT * FROM material_generation_requests`).length,
          2
        );
        assert.strictEqual(
          context.db.orm.all(sql`SELECT * FROM material_evidence_inputs`).length,
          2
        );
      }).pipe(Effect.provide(makeServices()))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable(
  'caller-owned generation keys replay the same request and reject changed intent',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const services = Layer.mergeAll(Projects.layer, Materials.layer, Pages.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const materials = yield* Materials;
          const project = yield* projects.createProject({ name: 'Replay' });
          const doc = yield* createEvidence({ projectId: project.id, title: 'Document' });
          const request = {
            projectId: project.id,
            title: 'Question',
            kind: 'quiz' as const,
            inputs: [{ kind: 'page' as const, versionId: doc.version.id }]
          };
          const first = yield* materials.requestMaterialGenerationOnce({
            requestId: 'slot-1',
            request
          });
          const replay = yield* materials.requestMaterialGenerationOnce({
            requestId: 'slot-1',
            request
          });

          expect(replay).toStrictEqual(first);
          assert.strictEqual(
            context.db.orm.all(sql`SELECT * FROM material_generation_requests`).length,
            1
          );
          assert.strictEqual(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .filter((event) => event.type === 'MaterialGenerationRequested').length,
            1
          );
          assert.ok(
            (yield* Effect.flip(
              materials.requestMaterialGenerationOnce({
                requestId: 'slot-1',
                request: { ...request, title: 'Changed' }
              })
            )).kind === 'invalid_input'
          );
        }).pipe(Effect.provide(services))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'generation scopes retain tombstones and fence requests by project and intent',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const services = Layer.mergeAll(Projects.layer, Materials.layer, Pages.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const materials = yield* Materials;
          const project = yield* projects.createProject({ name: 'Scope' });
          const other = yield* projects.createProject({ name: 'Other' });
          const doc = yield* createEvidence({ projectId: project.id, title: 'Document' });
          const scope = { scopeId: 'epoch', projectId: project.id };
          const request = {
            projectId: project.id,
            title: 'Question',
            kind: 'quiz' as const,
            inputs: [{ kind: 'page' as const, versionId: doc.version.id }],
            scopeId: scope.scopeId,
            questionSpec: { count: 1 as const, kind: 'open' as const }
          };

          yield* materials.openGenerationScope(scope);
          yield* materials.openGenerationScope(scope);
          yield* materials.requestMaterialGenerationOnce({ requestId: 'slot', request });
          assert.ok(
            (yield* materials.materialGeneration({ requestId: 'slot' })).questionSpec?.kind ===
              'open'
          );
          assert.ok(
            (yield* Effect.flip(
              materials.requestMaterialGenerationOnce({
                requestId: 'slot',
                request: { ...request, questionSpec: { count: 1, kind: 'choice' } }
              })
            )).kind === 'invalid_input'
          );
          assert.ok(
            (yield* Effect.flip(materials.openGenerationScope({ ...scope, projectId: other.id })))
              .kind === 'invalid_input'
          );
          yield* materials.closeGenerationScope(scope);
          yield* materials.openGenerationScope(scope);
          assert.ok(
            (yield* Effect.flip(materials.materialGeneration({ requestId: 'slot' }))).kind ===
              'invalid_input'
          );
          assert.ok(
            (yield* Effect.flip(
              materials.requestMaterialGenerationOnce({ requestId: 'new', request })
            )).kind === 'invalid_input'
          );
          yield* materials.closeGenerationScope({ ...scope, scopeId: 'early' });
          yield* materials.openGenerationScope({ ...scope, scopeId: 'early' });
          assert.ok(
            (yield* Effect.flip(
              materials.requestMaterialGenerationOnce({
                requestId: 'early-slot',
                request: { ...request, scopeId: 'early' }
              })
            )).kind === 'invalid_input'
          );
        }).pipe(Effect.provide(services))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'explicit generation retries are idempotent and require active captured intent',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const services = Layer.mergeAll(Projects.layer, Materials.layer, Pages.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const materials = yield* Materials;
          const project = yield* projects.createProject({ name: 'Retry' });
          const doc = yield* createEvidence({ projectId: project.id, title: 'Document' });

          yield* materials.openGenerationScope({ scopeId: 'scope', projectId: project.id });
          yield* materials.requestMaterialGenerationOnce({
            requestId: 'request',
            request: {
              projectId: project.id,
              title: 'Question',
              kind: 'quiz',
              inputs: [{ kind: 'page' as const, versionId: doc.version.id }],
              scopeId: 'scope'
            }
          });
          yield* materials.retryMaterialGenerationOnce({ requestId: 'request', retryId: 'retry' });
          yield* materials.retryMaterialGenerationOnce({ requestId: 'request', retryId: 'retry' });
          const events = context.db.orm
            .select()
            .from(workflowEvents)
            .all()
            .map((row) => decodeEvent(row.payload));

          assert.strictEqual(
            events.filter((event) => event.type === 'MaterialGenerationRequested').length,
            2
          );
          assert.ok(
            (yield* materials.materialGeneration({ requestId: 'request', eventId: 'retry' })).id ===
              'request'
          );
          assert.ok(
            (yield* Effect.flip(
              materials.materialGeneration({ requestId: 'request', eventId: 'forged' })
            )).kind === 'invalid_input'
          );
          yield* materials.requestMaterialGenerationOnce({
            requestId: 'other-request',
            request: {
              projectId: project.id,
              title: 'Other',
              kind: 'quiz',
              inputs: [{ kind: 'page' as const, versionId: doc.version.id }]
            }
          });
          assert.ok(
            (yield* Effect.flip(
              materials.retryMaterialGenerationOnce({
                requestId: 'other-request',
                retryId: 'retry'
              })
            )).kind === 'invalid_input'
          );
          assert.ok(
            (yield* Effect.flip(
              materials.retryMaterialGenerationOnce({
                requestId: 'request',
                retryId: 'other-request'
              })
            )).kind === 'invalid_input'
          );
          yield* materials.closeGenerationScope({ scopeId: 'scope', projectId: project.id });
          assert.ok(
            (yield* Effect.flip(
              materials.retryMaterialGenerationOnce({ requestId: 'request', retryId: 'retry-2' })
            )).kind === 'invalid_input'
          );
        }).pipe(Effect.provide(services))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'active practice generations recover across reads and exclude cancelled and other subjects',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const services = Layer.mergeAll(Projects.layer, Materials.layer, Pages.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;
          const materials = yield* Materials;
          const project = yield* projects.createProject({ name: 'Practice' });
          const other = yield* projects.createProject({ name: 'Other' });
          const doc = yield* createEvidence({ projectId: project.id, title: 'Evidence' });
          const otherDoc = yield* createEvidence({ projectId: other.id, title: 'Other evidence' });
          const request = yield* materials.requestMaterialGeneration({
            projectId: project.id,
            title: 'Quiz',
            kind: 'quiz',
            inputs: [{ kind: 'page', versionId: doc.version.id }]
          });
          const otherRequest = yield* materials.requestMaterialGeneration({
            projectId: other.id,
            title: 'Cards',
            kind: 'flashcards',
            inputs: [{ kind: 'page', versionId: otherDoc.version.id }]
          });

          expect(
            (yield* materials.activeMaterialGenerations({ projectId: project.id })).map(
              (item) => item.id
            )
          ).toEqual([request.id]);
          expect(
            (yield* materials.activeMaterialGenerations({})).map((item) => item.id).sort()
          ).toEqual([request.id, otherRequest.id].sort());
          yield* materials.cancelMaterialGeneration({ requestId: request.id });
          expect(yield* materials.activeMaterialGenerations({ projectId: project.id })).toEqual([]);
          expect((yield* materials.activeMaterialGenerations({})).map((item) => item.id)).toEqual([
            otherRequest.id
          ]);
        }).pipe(Effect.provide(services))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
