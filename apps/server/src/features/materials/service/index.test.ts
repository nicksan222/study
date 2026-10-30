import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MaterialsRpc, requestMaterialGenerationInputSchema } from '@study/contracts/materials/rpc';
import { sql } from '@study/db';
import { sessions, workflowEvents } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Option, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { decodeEvent } from '#server/platform/workflows/events';

const content = {
  kind: 'document' as const,
  blocks: [
    {
      kind: 'paragraph' as const,
      text: 'Canonical material',
      anchor: { type: 'page' as const, page: 1 }
    }
  ],
  meta: {
    extractor: null,
    extractorVersion: 1,
    provider: null,
    durationMs: null,
    pageCount: null,
    refiners: [],
    waitingFor: [],
    corrected: false
  }
};

test('materials versions, links, citations and session membership preserve SQLite invariants', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const services = Layer.mergeAll(Projects.layer, Sources.layer, Materials.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects,
          materials = yield* Materials;
        const project = yield* projects.createProject({ name: 'Physics' });
        const sources = yield* Sources;
        const source = yield* sources.createSource({
          projectId: project.id,
          name: 'notes.txt',
          bytes: new TextEncoder().encode('Canonical source')
        });
        const file = yield* materials.create({
          projectId: project.id,
          title: 'Source attachment',
          content: { kind: 'file', sourceId: source.id },
          publish: false
        });

        assert.equal(file.version.content.kind, 'file');

        if (file.version.content.kind === 'file') {
          assert.equal(file.version.content.source.id, source.id);
          assert.equal(file.version.content.source.projectId, project.id);
          assert.equal(file.version.content.source.name, 'notes.txt');
        }

        const another = yield* projects.createProject({ name: 'Other' });
        const first = yield* materials.create({
          projectId: project.id,
          title: 'Source',
          content,
          publish: false
        });

        assert.equal(first.version.status, 'draft');
        assert.equal(
          (yield* Effect.flip(materials.deleteDraft({ id: first.version.id }))).kind,
          'invalid_input'
        );
        const published = yield* materials.publishVersion({ id: first.version.id });

        assert.equal(published.status, 'published');
        assert.equal(
          (yield* Effect.flip(materials.replaceDraft({ id: published.id, content }))).kind,
          'invalid_input'
        );
        const next = yield* materials.createVersion({
          materialId: first.id,
          content,
          inputs: [published.id],
          parents: [published.id],
          publish: false
        });

        yield* materials.setCitations({
          id: next.id,
          citations: [
            {
              marker: 1n,
              inputVersionId: published.id,
              anchor: { type: 'page', page: 1 },
              quote: 'Canonical'
            },
            {
              marker: 2n,
              inputVersionId: published.id,
              anchor: { type: 'page', page: 1 },
              quote: 'material'
            }
          ]
        });
        const citations = yield* materials.citations({ id: next.id, limit: 1 });

        assert.equal(citations.nextCursor, 1n);
        assert.equal(
          (yield* materials.citations({ id: next.id, limit: 1, cursor: 1n })).items[0]?.marker,
          2n
        );
        assert.equal(
          (yield* materials.inputs({ id: next.id, limit: 10 })).items[0]?.id,
          published.id
        );
        assert.equal(
          (yield* materials.dependents({ id: published.id, limit: 10 })).items[0]?.id,
          next.id
        );
        yield* materials.publishVersion({ id: next.id });
        const foreign = yield* materials.create({
          projectId: another.id,
          title: 'Foreign',
          content
        });

        assert.equal(
          (yield* Effect.flip(
            materials.createVersion({
              materialId: first.id,
              content,
              inputs: [foreign.version.id]
            })
          )).kind,
          'invalid_input'
        );
        const session = context.db.orm
          .insert(sessions)
          .values({
            project_id: project.id,
            title: 'Session',
            title_source: 'user',
            created_at: 1n,
            updated_at: 1n
          })
          .returning()
          .get();

        yield* materials.attach({ sessionId: session.id, materialId: first.id });
        assert.deepEqual(
          (yield* materials.reorder({ sessionId: session.id, materialIds: [first.id] }))
            .materialIds,
          [first.id]
        );
        assert.equal(
          (yield* Effect.flip(materials.reorder({ sessionId: session.id, materialIds: [] }))).kind,
          'invalid_input'
        );
        yield* materials.detach({ sessionId: session.id, materialId: first.id });
        yield* materials.archive({ id: first.id });
        assert.equal(
          (yield* Effect.flip(materials.rename({ id: first.id, title: 'Rejected' }))).kind,
          'invalid_input'
        );
        yield* materials.unarchive({ id: first.id });
        assert.equal(
          (yield* materials.rename({ id: first.id, title: '  Renamed  ' })).title,
          'Renamed'
        );
        const page = yield* materials.materials({
          projectId: project.id,
          archived: false,
          limit: 1
        });

        assert.equal(page.items.length, 1);
        assert.ok(Option.isSome(yield* materials.findMaterial({ id: first.id })));
        assert.equal(
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
});

test('native materials RPC uses the service and maps canonical failures', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const services = Layer.mergeAll(Projects.layer, Sources.layer, Materials.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );
  const handlers = MaterialsRpcLive.pipe(Layer.provide(services));

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

        assert.equal((yield* client('materials.material', { id: material.id })).title, 'Native');
        const failure = yield* Effect.flip(
          client('materials.replaceDraft', { id: material.version.id, content })
        );

        assert.equal(failure.kind, 'invalid_input');
        const exportFailure = yield* Effect.flip(
          client('materials.materialVersionExport', { id: material.version.id })
        );

        assert.equal(exportFailure.kind, 'not_found');
      }).pipe(Effect.provide(services), Effect.provide(handlers), Effect.scoped)
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('published image retains its source revision through replacement and draft cleanup', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const services = Layer.mergeAll(Projects.layer, Sources.layer, Materials.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  const handlers = MaterialsRpcLive.pipe(Layer.provide(services));

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
        const projects = yield* Projects;
        const sources = yield* Sources;
        const materials = yield* Materials;
        const project = yield* projects.createProject({ name: 'Images' });
        const other = yield* projects.createProject({ name: 'Other' });
        const source = yield* sources.createSource({
          projectId: project.id,
          name: 'image.png',
          bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
        });
        const image = yield* materials.create({
          projectId: project.id,
          title: 'Image',
          content: { kind: 'image', sourceId: source.id, width: null, height: null }
        });
        const draft = yield* materials.createVersion({
          materialId: image.id,
          content: { kind: 'image', sourceId: source.id, width: null, height: null },
          publish: false
        });

        yield* materials.deleteDraft({ id: draft.id });
        assert.equal(context.db.orm.all(sql`SELECT * FROM material_source_snapshots`).length, 1);
        const count = context.db.orm.all(sql`SELECT * FROM workflow_events`).length;

        context.db.exec(
          "CREATE TRIGGER reject_replace_event BEFORE INSERT ON workflow_events WHEN new.type='SourceProcessingRequested' BEGIN SELECT RAISE(ABORT, 'rejected'); END"
        );
        yield* Effect.flip(
          sources.replaceSource({
            id: source.id,
            expectedRevision: 1,
            name: 'new.png',
            bytes: new Uint8Array([1, 2, 3])
          })
        );
        assert.equal(context.db.orm.all(sql`SELECT * FROM workflow_events`).length, count);
        assert.equal((yield* sources.sourceProcessing(source.id)).revision, 1);
        context.db.exec('DROP TRIGGER reject_replace_event');
        yield* sources.replaceSource({
          id: source.id,
          expectedRevision: 1,
          name: 'new.png',
          bytes: new Uint8Array([1, 2, 3])
        });
        const exported = yield* client('materials.materialVersionExport', { id: image.version.id });

        assert.deepEqual(exported.source, source);
        assert.deepEqual(exported.bytes, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]));
        assert.deepEqual(
          (yield* materials.material({ id: image.id })).version.content,
          image.version.content
        );
        assert.throws(() =>
          context.db.orm.run(
            sql`UPDATE source_snapshots SET bytes=x'00' WHERE source_id=${source.id} AND revision=1`
          )
        );
        assert.throws(() =>
          context.db.orm.run(
            sql`DELETE FROM source_snapshots WHERE source_id=${source.id} AND revision=1`
          )
        );
        assert.throws(() =>
          context.db.orm.run(
            sql`UPDATE material_source_snapshots SET metadata='{}' WHERE version_id=${image.version.id}`
          )
        );
        assert.throws(() =>
          context.db.orm.run(sql`UPDATE sources SET project_id=${other.id} WHERE id=${source.id}`)
        );
        context.db.orm.run(sql`DELETE FROM projects WHERE id=${project.id}`);
      }).pipe(Effect.provide(services), Effect.provide(handlers), Effect.scoped)
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('generation requests persist immutable published document inputs and an outbox event', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const services = Layer.mergeAll(Projects.layer, Materials.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const materials = yield* Materials;
        const project = yield* projects.createProject({ name: 'Generation' });
        const doc = yield* materials.create({ projectId: project.id, title: 'Document', content });
        const request = yield* materials.requestMaterialGeneration({
          projectId: project.id,
          title: ' Cards ',
          kind: 'flashcards',
          inputVersionIds: [doc.version.id]
        });

        assert.equal(request.title, 'Cards');
        assert.deepEqual(request.inputVersionIds, [doc.version.id]);
        assert.equal(
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
});

test('generation validation, rollback, RPC, and persistent snapshots', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  const makeServices = () =>
    Layer.mergeAll(Projects.layer, Materials.layer).pipe(
      Layer.provide(Layer.succeed(Database, { store: context }))
    );
  let requestId = '';
  let documentId = 0n;
  let versionId = 0n;
  let otherRequestId = '';

  try {
    const services = makeServices();
    const handlers = MaterialsRpcLive.pipe(Layer.provide(services));

    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const materials = yield* Materials;
        const client = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
        const project = yield* projects.createProject({ name: 'One' });
        const other = yield* projects.createProject({ name: 'Two' });
        const doc = yield* materials.create({ projectId: project.id, title: 'Doc', content });
        const foreign = yield* materials.create({ projectId: other.id, title: 'Foreign', content });
        const draft = yield* materials.create({
          projectId: project.id,
          title: 'Draft',
          content,
          publish: false
        });
        const archived = yield* materials.create({
          projectId: project.id,
          title: 'Archived',
          content
        });

        yield* materials.archive({ id: archived.id });
        const diagram = yield* materials.create({
          projectId: project.id,
          title: 'Diagram',
          content: { kind: 'diagram', format: 'mermaid', payload: 'graph TD' }
        });
        const base = { projectId: project.id, title: 'Generated', kind: 'quiz' as const };

        for (const id of [
          foreign.version.id,
          draft.version.id,
          archived.version.id,
          diagram.version.id
        ]) {
          assert.equal(
            (yield* Effect.flip(
              materials.requestMaterialGeneration({ ...base, inputVersionIds: [id] })
            )).kind,
            'invalid_input'
          );
        }

        const parse = Schema.decodeUnknownSync(requestMaterialGenerationInputSchema);

        assert.throws(() => parse({ ...base, inputVersionIds: [doc.version.id, doc.version.id] }));
        assert.throws(() => parse({ ...base, inputVersionIds: [] }));
        assert.throws(() =>
          parse({ ...base, inputVersionIds: Array.from({ length: 21 }, (_, i) => BigInt(i + 1)) })
        );
        assert.equal(context.db.orm.all(sql`SELECT * FROM material_generation_requests`).length, 0);
        context.db.exec(
          "CREATE TRIGGER reject_generation_event BEFORE INSERT ON workflow_events WHEN new.type='MaterialGenerationRequested' BEGIN SELECT RAISE(ABORT, 'rejected'); END"
        );
        yield* Effect.flip(
          materials.requestMaterialGeneration({ ...base, inputVersionIds: [doc.version.id] })
        );
        assert.equal(context.db.orm.all(sql`SELECT * FROM material_generation_requests`).length, 0);
        assert.equal(context.db.orm.all(sql`SELECT * FROM material_generation_inputs`).length, 0);
        context.db.exec('DROP TRIGGER reject_generation_event');
        const request = yield* client('materials.requestMaterialGeneration', {
          ...base,
          inputVersionIds: [doc.version.id],
          instruction: 'Focus'
        });
        const snapshot = yield* materials.materialGeneration({ requestId: request.id });

        requestId = request.id;
        versionId = doc.version.id;
        documentId = snapshot.documentIds[0]!;
        assert.equal(snapshot.instruction, 'Focus');
        const event = context.db.orm
          .select()
          .from(workflowEvents)
          .all()
          .find((row) => row.eventId === request.id)!;

        assert.deepEqual(decodeEvent(event.payload), {
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
        yield* materials.createVersion({ materialId: doc.id, content });
        const otherRequest = yield* materials.requestMaterialGeneration({
          projectId: other.id,
          title: 'Other',
          kind: 'diagram',
          inputVersionIds: [foreign.version.id]
        });

        otherRequestId = otherRequest.id;
        assert.throws(() =>
          context.db.orm.run(sql`DELETE FROM material_versions WHERE id=${doc.version.id}`)
        );
      }).pipe(Effect.provide(services), Effect.provide(handlers), Effect.scoped)
    );
    context.close();
    context = new ServerContext(location.open());
    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const snapshot = yield* materials.materialGeneration({ requestId });

        assert.deepEqual(snapshot.inputVersionIds, [versionId]);
        assert.deepEqual(snapshot.documentIds, [documentId]);
        context.db.orm.run(sql`DELETE FROM projects WHERE id=${snapshot.projectId}`);
        assert.equal(
          (yield* materials.materialGeneration({ requestId: otherRequestId })).id,
          otherRequestId
        );
        assert.equal(context.db.orm.all(sql`SELECT * FROM material_generation_requests`).length, 1);
        assert.equal(context.db.orm.all(sql`SELECT * FROM material_generation_inputs`).length, 1);
      }).pipe(Effect.provide(makeServices()))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('caller-owned generation keys replay the same request and reject changed intent', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const services = Layer.mergeAll(Projects.layer, Materials.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const materials = yield* Materials;
        const project = yield* projects.createProject({ name: 'Replay' });
        const doc = yield* materials.create({ projectId: project.id, title: 'Document', content });
        const request = {
          projectId: project.id,
          title: 'Question',
          kind: 'quiz' as const,
          inputVersionIds: [doc.version.id]
        };
        const first = yield* materials.requestMaterialGenerationOnce({
          requestId: 'slot-1',
          request
        });
        const replay = yield* materials.requestMaterialGenerationOnce({
          requestId: 'slot-1',
          request
        });

        assert.deepEqual(replay, first);
        assert.equal(context.db.orm.all(sql`SELECT * FROM material_generation_requests`).length, 1);
        assert.equal(
          context.db.orm
            .select()
            .from(workflowEvents)
            .all()
            .filter((event) => event.type === 'MaterialGenerationRequested').length,
          1
        );
        assert.equal(
          (yield* Effect.flip(
            materials.requestMaterialGenerationOnce({
              requestId: 'slot-1',
              request: { ...request, title: 'Changed' }
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

test('generation scopes retain tombstones and fence requests by project and intent', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const services = Layer.mergeAll(Projects.layer, Materials.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const materials = yield* Materials;
        const project = yield* projects.createProject({ name: 'Scope' });
        const other = yield* projects.createProject({ name: 'Other' });
        const doc = yield* materials.create({ projectId: project.id, title: 'Document', content });
        const scope = { scopeId: 'epoch', projectId: project.id };
        const request = {
          projectId: project.id,
          title: 'Question',
          kind: 'quiz' as const,
          inputVersionIds: [doc.version.id],
          scopeId: scope.scopeId,
          questionSpec: { count: 1 as const, kind: 'open' as const }
        };

        yield* materials.openGenerationScope(scope);
        yield* materials.openGenerationScope(scope);
        yield* materials.requestMaterialGenerationOnce({ requestId: 'slot', request });
        assert.equal(
          (yield* materials.materialGeneration({ requestId: 'slot' })).questionSpec?.kind,
          'open'
        );
        assert.equal(
          (yield* Effect.flip(
            materials.requestMaterialGenerationOnce({
              requestId: 'slot',
              request: { ...request, questionSpec: { count: 1, kind: 'choice' } }
            })
          )).kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(materials.openGenerationScope({ ...scope, projectId: other.id })))
            .kind,
          'invalid_input'
        );
        yield* materials.closeGenerationScope(scope);
        yield* materials.openGenerationScope(scope);
        assert.equal(
          (yield* Effect.flip(materials.materialGeneration({ requestId: 'slot' }))).kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(
            materials.requestMaterialGenerationOnce({ requestId: 'new', request })
          )).kind,
          'invalid_input'
        );
        yield* materials.closeGenerationScope({ ...scope, scopeId: 'early' });
        yield* materials.openGenerationScope({ ...scope, scopeId: 'early' });
        assert.equal(
          (yield* Effect.flip(
            materials.requestMaterialGenerationOnce({
              requestId: 'early-slot',
              request: { ...request, scopeId: 'early' }
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

test('explicit generation retries are idempotent and require active captured intent', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const services = Layer.mergeAll(Projects.layer, Materials.layer).pipe(
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const materials = yield* Materials;
        const project = yield* projects.createProject({ name: 'Retry' });
        const doc = yield* materials.create({ projectId: project.id, title: 'Document', content });

        yield* materials.openGenerationScope({ scopeId: 'scope', projectId: project.id });
        yield* materials.requestMaterialGenerationOnce({
          requestId: 'request',
          request: {
            projectId: project.id,
            title: 'Question',
            kind: 'quiz',
            inputVersionIds: [doc.version.id],
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

        assert.equal(
          events.filter((event) => event.type === 'MaterialGenerationRequested').length,
          2
        );
        assert.equal(
          (yield* materials.materialGeneration({ requestId: 'request', eventId: 'retry' })).id,
          'request'
        );
        assert.equal(
          (yield* Effect.flip(
            materials.materialGeneration({ requestId: 'request', eventId: 'forged' })
          )).kind,
          'invalid_input'
        );
        yield* materials.requestMaterialGenerationOnce({
          requestId: 'other-request',
          request: {
            projectId: project.id,
            title: 'Other',
            kind: 'quiz',
            inputVersionIds: [doc.version.id]
          }
        });
        assert.equal(
          (yield* Effect.flip(
            materials.retryMaterialGenerationOnce({ requestId: 'other-request', retryId: 'retry' })
          )).kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(
            materials.retryMaterialGenerationOnce({
              requestId: 'request',
              retryId: 'other-request'
            })
          )).kind,
          'invalid_input'
        );
        yield* materials.closeGenerationScope({ scopeId: 'scope', projectId: project.id });
        assert.equal(
          (yield* Effect.flip(
            materials.retryMaterialGenerationOnce({ requestId: 'request', retryId: 'retry-2' })
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
