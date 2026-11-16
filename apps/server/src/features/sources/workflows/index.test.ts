import type { ProjectId } from '@study/contracts';
import { NotesRpc } from '@study/contracts';
import { defaultAgentRules } from '@study/contracts';
import { plainBlock } from '@study/contracts';
import type { Db } from '@study/db';
import { sql } from '@study/db';
import * as tables from '@study/db';
import {
  agentsLayer,
  createChatGptModel,
  AuthManager,
  ServerContext,
  Database,
  normalizeError,
  WorkflowConfiguration,
  workflowEngineLayer,
  decodeEvent
} from '@study/server';
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { DurableDeferred, WorkflowEngine } from 'effect/workflow';

import { Notes } from '#server/features/notes/index';
import { NotesRpcLive } from '#server/features/notes/rpc/index';
import { Projects } from '#server/features/projects/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/service/index';
import {
  sourceIngestionWorkflow,
  sourceIngestionHandler
} from '#server/features/sources/workflows/index';
import { testLiveQueries } from '#testing/live-queries';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises durable source ingestion and correction workflows, including decoder and │
 * │ agent outcomes with SQLite state.                                                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises native ingestion publishes an anchored text document through Sources.        │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { textResponseEvents } from '#testing/responses';

function admitted(database: { readonly orm: Db['orm'] }, tag: string, id: string) {
  database.orm
    .insert(tables.workflow_executions)
    .values({
      execution_id: id,
      workflow_tag: tag,
      version: 1,
      payload: '{}',
      status: 'running',
      created_at: 1n,
      updated_at: 1n
    })
    .onConflictDoNothing()
    .run();

  return id;
}

test.server.stable(
  'native ingestion lets quick notes capture a historic exact source extraction without projections',
  async ({ databases, createAiMock, assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const location = await databases();
    let context = new ServerContext(await location.open());
    using mock = createAiMock();
    const domain = () =>
      Layer.mergeAll(Sources.layer, Notes.layer, Settings.layer, Projects.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const services = () =>
      Layer.mergeAll(
        NotesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(Layer.provideMerge(domain())),
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
        agentsLayer({
          model: (tier, call) =>
            mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError)),
          language: 'en',
          rules: Effect.succeed(defaultAgentRules),
          searchSources: () => Effect.succeed([])
        }),
        workflowEngineLayer(context)
      );

    try {
      const captured = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const settings = yield* Settings;

            yield* settings.saveWorkspacePreferences({
              ...(yield* settings.workspacePreferences()),
              textConversionStrategy: 'unavailable'
            });
            const client = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
            const projects = yield* Projects;
            const collection = yield* projects.createProject({ name: 'Temporary organization' });
            const source = yield* sources.createSource({
              name: 'test.txt',
              bytes: new TextEncoder().encode('Hello historic extraction'),
              projectId: collection.id
            });
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);

            function* ingest(
              { assert: assertions }: Pick<test.server.Context, 'assert'>,
              revision: number
            ) {
              const assert: test.Assert = assertions;

              const state = yield* sources.sourceProcessing(source.id);

              assert.ok(state.requestId);
              const event = {
                type: 'SourceProcessingRequested' as const,
                sourceId: source.id,
                requestId: state.requestId,
                inputVersion: revision,
                eventId: 'ingest-' + revision,
                causationId: null,
                correlationId: state.requestId,
                depth: 0
              };
              const documentId = yield* engine.execute(sourceIngestionWorkflow, {
                executionId: admitted(context.db, sourceIngestionWorkflow._tag, 'text-' + revision),
                payload: { event }
              });
              const indexed = context.db.orm
                .select()
                .from(tables.workflowEvents)
                .all()
                .map((row) => decodeEvent(row.payload))
                .find((item) => item.type === 'SourceIndexed' && item.documentId === documentId);

              assert.ok(indexed?.type === 'SourceIndexed');

              if (revision === 1) {
                assert.strictEqual(indexed.projectId, collection.id);
                yield* projects.deleteProject({ id: collection.id });
              }

              assert.strictEqual(
                (yield* sources.currentExtraction({ id: source.id }))?.snapshotId,
                documentId
              );
              assert.strictEqual(context.db.orm.select().from(tables.materials).all().length, 0);
              assert.strictEqual(context.db.orm.select().from(tables.pages).all().length, 0);

              return { documentId };
            }

            const first = yield* ingest({ assert }, 1);

            assert.strictEqual(
              (yield* sources.sourceProcessing(source.id)).documentId,
              first.documentId
            );
            const note = yield* client('notes.createNote', {
              title: 'Historic import'
            });

            // Original bytes are not authority for a future extraction.
            assert.ok(
              (yield* Effect.flip(
                client('notes.updateNoteSelection', {
                  noteId: note.id,
                  expectedRevision: 0n,
                  targets: [
                    {
                      input: {
                        kind: 'source',
                        sourceId: source.id,
                        revision: 2n,
                        snapshotId: first.documentId
                      },
                      scope: { kind: 'document' }
                    }
                  ]
                })
              )).kind === 'not_found'
            );
            yield* client('notes.postMessage', {
              noteId: note.id,
              text: '',
              sourceIds: [source.id],
              requestReply: false
            });
            const captured = yield* client('notes.captureNoteContext', {
              noteId: note.id,
              intentKey: 'historic-import',
              instruction: 'Explain',
              preferences: {}
            });

            yield* sources.replaceSource({
              id: source.id,
              expectedRevision: 1,
              name: 'test.txt',
              bytes: new TextEncoder().encode('Replacement must stay outside historic context')
            });
            const latest = yield* ingest({ assert }, 2);

            assert.notStrictEqual(latest.documentId, first.documentId);
            // Historical selection changes cannot replace the already captured source body.
            yield* client('notes.updateNoteSelection', {
              noteId: note.id,
              expectedRevision: 0n,
              targets: [
                {
                  input: {
                    kind: 'source',
                    sourceId: source.id,
                    revision: 1n,
                    snapshotId: first.documentId
                  },
                  scope: { kind: 'document' }
                }
              ]
            });
            const snapshot = yield* client('notes.inspectNoteContext', {
              requestId: captured.requestId
            });

            expect(snapshot.messages.map((message) => message.text)).toStrictEqual(['']);
            assert.strictEqual(snapshot.inputs[0]!.snapshotId, first.documentId);
            assert.ok(snapshot.inputs[0]!.excerpts[0]!.text === 'Hello historic extraction');
            expect(snapshot.inputs[0]!.document).toStrictEqual(
              (yield* sources.extraction({
                sourceId: source.id,
                revision: 1n,
                snapshotId: first.documentId
              })).document
            );

            return snapshot;
          }).pipe(Effect.provide(services()))
        )
      );

      context.close();
      context = new ServerContext(await location.open());
      const reopened = await Effect.runPromise(
        Effect.flatMap(Notes, (notes) => notes.noteContext({ requestId: captured.requestId })).pipe(
          Effect.provide(domain())
        )
      );

      expect(reopened).toStrictEqual(captured);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'superseded requests cannot publish and a cancelled pending execution stays unpublished',
  async ({ databases, createAiMock, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const { dispatchPending } = await import('@study/server');
    const { reconcileCancellation } = await import('@study/server');
    const { sourceIngestionRegistration } =
      await import('#server/features/sources/workflows/index');
    const { workflowStore } = await import('@study/server');
    const { workflow_executions } = await import('@study/db');
    const { SourceStore } = await import('#server/features/sources/store/index');
    const { transaction } = await import('@study/server');
    const location = await databases();
    const context = new ServerContext(await location.open());
    using mock = createAiMock();
    const services = Layer.mergeAll(
      Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
      Layer.succeed(Database, { store: context }),
      Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
      agentsLayer({
        model: (tier, call) => mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError)),
        language: 'en',
        rules: Effect.succeed(defaultAgentRules),
        searchSources: () => Effect.succeed([])
      }),
      workflowEngineLayer(context)
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const source = yield* sources.createSource({
              name: 'a.txt',
              bytes: new TextEncoder().encode('old'),
              projectId: null
            });
            const old = yield* sources.sourceProcessing(source.id);

            assert.ok(old.requestId);
            yield* sources.requestSourceProcessing({ id: source.id, expectedRevision: 1 });
            const engine = yield* WorkflowEngine.WorkflowEngine;

            const release = DurableDeferred.make('before-ingestion');

            yield* engine.register(sourceIngestionWorkflow, (payload) =>
              payload.event.eventId === 'old' || payload.event.eventId === 'old-revision'
                ? sourceIngestionHandler(payload)
                : DurableDeferred.await(release).pipe(
                    Effect.andThen(sourceIngestionHandler(payload))
                  )
            );
            const event = {
              type: 'SourceProcessingRequested' as const,
              sourceId: source.id,
              requestId: old.requestId,
              inputVersion: 1,
              eventId: 'old',
              causationId: null,
              correlationId: old.requestId,
              depth: 0
            };
            const failure = yield* Effect.flip(
              engine.execute(sourceIngestionWorkflow, {
                executionId: admitted(context.db, sourceIngestionWorkflow._tag, 'stale'),
                payload: { event }
              })
            );

            assert.ok(failure.kind === 'invalid_input');
            assert.ok((yield* sources.sourceProcessing(source.id)).documentId === null);
            const revisionSource = yield* sources.createSource({
              name: 'revision.txt',
              bytes: new TextEncoder().encode('first'),
              projectId: null
            });
            const revisionState = yield* sources.sourceProcessing(revisionSource.id);

            assert.ok(revisionState.requestId);
            yield* transaction((tx) =>
              tx.store(SourceStore).replaceSourceInput({
                id: revisionSource.id,
                expectedRevision: 1,
                bytes: new TextEncoder().encode('second'),
                requestId: 'new-revision'
              })
            ).pipe(Effect.provideService(Database, { store: context }));
            const revisionEvent = {
              ...event,
              sourceId: revisionSource.id,
              requestId: revisionState.requestId,
              correlationId: revisionState.requestId,
              eventId: 'old-revision'
            };
            const revisionFailure = yield* Effect.flip(
              engine.execute(sourceIngestionWorkflow, {
                executionId: admitted(context.db, sourceIngestionWorkflow._tag, 'stale-revision'),
                payload: { event: revisionEvent }
              })
            );

            assert.ok(revisionFailure.kind === 'invalid_input');
            assert.ok((yield* sources.sourceProcessing(revisionSource.id)).documentId === null);
            assert.strictEqual(
              yield* dispatchPending(context, sourceIngestionRegistration.triggers, Date.now()),
              3
            );
            const pending = context.db.orm
              .select()
              .from(workflow_executions)
              .all()
              .filter(
                (row) => row.execution_id !== 'stale' && row.execution_id !== 'stale-revision'
              );

            for (const row of pending)
              workflowStore(context).requestCancellation(row.execution_id, 'safe');

            for (const row of pending) {
              yield* reconcileCancellation(
                context,
                sourceIngestionWorkflow,
                row.execution_id,
                'safe',
                true
              );
              assert.strictEqual(
                workflowStore(context).execution(row.execution_id)?.status,
                'cancelled'
              );
            }

            assert.ok((yield* sources.sourceProcessing(source.id)).documentId === null);
          }).pipe(Effect.provide(services))
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

for (const input of ['attachment', 'link'] as const)
  test.server.stable(
    `${input} PDF transcription is checkpointed and replayed after reopening SQLite`,
    async ({ databases, assert: assertions, expect }) => {
      const assert: test.Assert = assertions;

      let calls = 0;
      let fetches = 0;
      const fixture = await Bun.file(
        new URL('../decoders/fixtures/two-pages.pdf', import.meta.url)
      ).bytes();
      let requestBody: Record<string, unknown> = {};
      const peer = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: async (request) => {
          if (request.method === 'GET' && new URL(request.url).pathname === '/two.pdf') {
            fetches++;

            return new Response(fixture, { headers: { 'content-type': 'application/pdf' } });
          }

          const body = await request.text();

          calls++;
          requestBody = JSON.parse(body);
          let events = '';

          for (const event of textResponseEvents(
            JSON.stringify({
              pages: [
                { page: 1, blocks: [{ kind: 'heading', text: 'One' }] },
                { page: 2, blocks: [{ kind: 'paragraph', text: 'Two' }] }
              ]
            })
          ))
            events += `data: ${JSON.stringify(event)}\n\n`;

          return new Response(events + 'data: [DONE]\n\n', {
            headers: { 'content-type': 'text/event-stream' }
          });
        }
      });

      assert.ok(peer.port, 'missing peer address');
      const base = peer.url.origin;
      const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

      await auth.replace(
        { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
        { accessToken: 'token', expiresIn: 3600 }
      );
      const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
      const location = await databases();
      let context = new ServerContext(await location.open());
      const services = () =>
        Layer.mergeAll(
          Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
          Layer.succeed(Database, { store: context }),
          Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
          agentsLayer({
            model: () => Effect.succeed(model),
            language: 'en',
            rules: Effect.succeed(defaultAgentRules),
            searchSources: () => Effect.succeed([])
          }),
          workflowEngineLayer(context)
        );

      try {
        // Reopening joins the durable successful execution without repeating provider work.
        const payload = await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const sources = yield* Sources;
              const source = yield* input === 'attachment'
                ? sources.createSource({ name: 'two.pdf', bytes: fixture, projectId: null })
                : sources.addLink({ url: `${base}/two.pdf`, projectId: null });
              const state = yield* sources.sourceProcessing(source.id);

              assert.ok(state.requestId);
              const event = {
                type: 'SourceProcessingRequested' as const,
                sourceId: source.id,
                requestId: state.requestId,
                inputVersion: 1,
                eventId: 'pdf-event',
                causationId: null,
                correlationId: state.requestId,
                depth: 0
              };
              const engine = yield* WorkflowEngine.WorkflowEngine;

              yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
              const stale = yield* Effect.flip(
                engine.execute(sourceIngestionWorkflow, {
                  executionId: admitted(context.db, sourceIngestionWorkflow._tag, 'superseded-pdf'),
                  payload: {
                    event: { ...event, requestId: 'superseded-request', eventId: 'superseded-pdf' }
                  }
                })
              );

              assert.ok(stale.kind === 'invalid_input');
              assert.strictEqual(calls, 0);
              const exit = yield* Effect.exit(
                engine.execute(sourceIngestionWorkflow, {
                  executionId: admitted(context.db, sourceIngestionWorkflow._tag, 'pdf'),
                  payload: { event }
                })
              );

              assert.ok(exit._tag === 'Success');

              return { event };
            }).pipe(Effect.provide(services()))
          )
        );

        assert.strictEqual(calls, 1);
        assert.strictEqual(fetches, input === 'link' ? 1 : 0);
        expect(String(requestBody.instructions)).toMatch(/Transcribe all pages in order/);
        context.close();
        context = new ServerContext(await location.open());
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const engine = yield* WorkflowEngine.WorkflowEngine;

              yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
              yield* engine.execute(sourceIngestionWorkflow, {
                executionId: admitted(context.db, sourceIngestionWorkflow._tag, 'pdf'),
                payload
              });
            }).pipe(Effect.provide(services()))
          )
        );
        assert.strictEqual(calls, 1);
        assert.strictEqual(fetches, input === 'link' ? 1 : 0);
        expect(
          context.db.orm
            .all<{ text: string }>(sql`SELECT text FROM blocks ORDER BY ordinal`)
            .map((row) => row.text)
        ).toStrictEqual(['One', 'Two']);
      } finally {
        await auth.dispose();
        context.close();
        await location.cleanup();
        await peer.stop(true);
      }
    }
  );

test.server.stable(
  'ingestion publishes visible HTML, delimited text and Office documents',
  async ({ databases, createAiMock, assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const location = await databases();
    const context = new ServerContext(await location.open());
    using mock = createAiMock();
    const services = Layer.mergeAll(
      Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
      Layer.succeed(Database, { store: context }),
      Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
      agentsLayer({
        model: (tier, call) => mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError)),
        language: 'en',
        rules: Effect.succeed(defaultAgentRules),
        searchSources: () => Effect.succeed([])
      }),
      workflowEngineLayer(context)
    );
    const fixture = (name: string) =>
      Bun.file(new URL(`../decoders/fixtures/${name}`, import.meta.url)).bytes();
    const samples = [
      {
        name: 'page.html',
        bytes: new TextEncoder().encode(
          '<nav>Menu</nav><main><h1>Title</h1><p>Body</p><script>secret</script></main>'
        ),
        expected: ['Title', 'Body']
      },
      {
        name: 'data.csv',
        bytes: new TextEncoder().encode('name,value\nA,1'),
        expected: ['name,value\nA,1']
      },
      {
        name: 'data.tsv',
        bytes: new TextEncoder().encode('name\tvalue\nA\t1'),
        expected: ['name\tvalue\nA\t1']
      },
      {
        name: 'sample.docx',
        bytes: await fixture('sample.docx'),
        expected: ['Heading', 'First paragraph']
      },
      {
        name: 'sample.pptx',
        bytes: await fixture('sample.pptx'),
        expected: ['Slide 2', 'Speaker notes', 'Slide 1']
      }
    ];

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);

            for (const [index, sample] of samples.entries()) {
              const source = yield* sources.createSource({
                name: sample.name,
                bytes: sample.bytes,
                projectId: null
              });
              const state = yield* sources.sourceProcessing(source.id);

              assert.ok(state.requestId);
              const event = {
                type: 'SourceProcessingRequested' as const,
                sourceId: source.id,
                requestId: state.requestId,
                inputVersion: 1,
                eventId: `format-${index}`,
                causationId: null,
                correlationId: state.requestId,
                depth: 0
              };
              const id = yield* engine.execute(sourceIngestionWorkflow, {
                executionId: admitted(context.db, sourceIngestionWorkflow._tag, `format-${index}`),
                payload: { event }
              });

              assert.strictEqual((yield* sources.sourceProcessing(source.id)).documentId, id);
              const rows = context.db.orm.all<{ text: string }>(
                'SELECT text FROM blocks ORDER BY rowid'
              );

              expect(
                rows.slice(-sample.expected.length).map((row) => row.text),
                sample.name
              ).toStrictEqual(sample.expected);
            }

            const { SourceStore } = yield* Effect.promise(
              () => import('#server/features/sources/store/index')
            );
            const { transaction } = yield* Effect.promise(() => import('@study/server'));
            const web = yield* transaction((tx) =>
              tx.store(SourceStore).createSource({
                name: 'Web',
                kind: 'web',
                mime: 'text/html',
                origin: 'web',
                uri: 'https://example.test/original',
                bytes: new TextEncoder().encode('<main><h1 id="chapter">Visible</h1></main>'),
                projectId: null,
                requestId: 'web-request'
              })
            ).pipe(Effect.provideService(Database, { store: context }));
            const webEvent = {
              type: 'SourceProcessingRequested' as const,
              sourceId: web.id,
              requestId: 'web-request',
              inputVersion: 1,
              eventId: 'web-event',
              causationId: null,
              correlationId: 'web-request',
              depth: 0
            };

            yield* engine.execute(sourceIngestionWorkflow, {
              executionId: admitted(context.db, sourceIngestionWorkflow._tag, 'web'),
              payload: { event: webEvent }
            });
            const anchor = context.db.orm.all<{ anchor: string }>(
              'SELECT anchor FROM blocks ORDER BY rowid DESC LIMIT 1'
            )[0].anchor;

            expect(JSON.parse(anchor)).toStrictEqual({
              type: 'url',
              url: 'https://example.test/original',
              fragment: 'chapter'
            });

            for (const [index, name] of [
              'legacy.doc',
              'sheet.xlsx',
              'slides.ppt',
              'sound.wav',
              'image.bmp'
            ].entries()) {
              const bytes = name.endsWith('.bmp')
                ? new Uint8Array([0x42, 0x4d, 0, 0])
                : new TextEncoder().encode('data');
              const source = yield* sources.createSource({ name, bytes, projectId: null });
              const state = yield* sources.sourceProcessing(source.id);

              assert.ok(state.requestId);
              const event = {
                type: 'SourceProcessingRequested' as const,
                sourceId: source.id,
                requestId: state.requestId,
                inputVersion: 1,
                eventId: `unsupported-${index}`,
                causationId: null,
                correlationId: state.requestId,
                depth: 0
              };
              const failure = yield* Effect.flip(
                engine.execute(sourceIngestionWorkflow, {
                  executionId: admitted(
                    context.db,
                    sourceIngestionWorkflow._tag,
                    `unsupported-${index}`
                  ),
                  payload: { event }
                })
              );

              assert.ok(failure.kind === 'unsupported', name);
            }
          }).pipe(Effect.provide(services))
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'link ingestion follows redirects and anchors HTML to the final URI',
  async ({ databases, assert: assertions, createAiMock }) => {
    const assert: test.Assert = assertions;

    let calls = 0;
    const peer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        calls++;

        if (new URL(request.url).pathname === '/start')
          return new Response(null, { status: 302, headers: { location: '/final' } });

        return new Response('<main><h1 id="title">Hello</h1></main>', {
          headers: { 'content-type': 'text/html' }
        });
      }
    });

    assert.ok(peer.port, 'missing address');
    const base = peer.url.origin;
    const location = await databases();
    const context = new ServerContext(await location.open());
    using mock = createAiMock();
    const services = Layer.mergeAll(
      Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
      Layer.succeed(Database, { store: context }),
      Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
      agentsLayer({
        model: (tier, call) => mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError)),
        language: 'en',
        rules: Effect.succeed(defaultAgentRules),
        searchSources: () => Effect.succeed([])
      }),
      workflowEngineLayer(context)
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const source = yield* sources.addLink({ url: `${base}/start`, projectId: null });
            const state = yield* sources.sourceProcessing(source.id);

            assert.ok(state.requestId);
            const event = {
              type: 'SourceProcessingRequested' as const,
              sourceId: source.id,
              requestId: state.requestId,
              inputVersion: 1,
              eventId: 'link',
              causationId: null,
              correlationId: state.requestId,
              depth: 0
            };
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
            yield* engine.execute(sourceIngestionWorkflow, {
              executionId: admitted(context.db, sourceIngestionWorkflow._tag, 'link'),
              payload: { event }
            });
            const rows = context.db.orm.all<{ text: string; anchor: string }>(
              'SELECT text, anchor FROM blocks'
            );

            assert.ok(rows[0].text === 'Hello');
            assert.strictEqual(JSON.parse(rows[0].anchor).url, `${base}/final`);
            assert.strictEqual((yield* sources.source(source.id)).uri, `${base}/start`);
            assert.strictEqual(calls, 2);
          }).pipe(Effect.provide(services))
        )
      );
    } finally {
      context.close();
      await location.cleanup();
      await peer.stop(true);
    }
  }
);

test.server.stable(
  'link fetch checkpoint survives SQLite reopen without another request',
  async ({ databases, assert: assertions, createAiMock }) => {
    const assert: test.Assert = assertions;

    let calls = 0;
    const peer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        calls++;

        return new Response('captured', { headers: { 'content-type': 'text/plain' } });
      }
    });

    assert.ok(peer.port, 'missing address');
    const base = peer.url.origin;
    const location = await databases();
    let context = new ServerContext(await location.open());
    using mock = createAiMock();
    const services = () =>
      Layer.mergeAll(
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
        Layer.succeed(Database, { store: context }),
        Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
        agentsLayer({
          model: (tier, call) =>
            mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError)),
          language: 'en',
          rules: Effect.succeed(defaultAgentRules),
          searchSources: () => Effect.succeed([])
        }),
        workflowEngineLayer(context)
      );

    try {
      const payload = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const source = yield* sources.addLink({ url: base, projectId: null });
            const state = yield* sources.sourceProcessing(source.id);

            assert.ok(state.requestId);
            const event = {
              type: 'SourceProcessingRequested' as const,
              sourceId: source.id,
              requestId: state.requestId,
              inputVersion: 1,
              eventId: 'replay-link',
              causationId: null,
              correlationId: state.requestId,
              depth: 0
            };
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
            const stale = yield* Effect.flip(
              engine.execute(sourceIngestionWorkflow, {
                executionId: admitted(context.db, sourceIngestionWorkflow._tag, 'stale-link'),
                payload: { event: { ...event, requestId: 'stale' } }
              })
            );

            assert.ok(stale.kind === 'invalid_input');
            assert.strictEqual(calls, 0);
            assert.ok(
              (yield* Effect.exit(
                engine.execute(sourceIngestionWorkflow, {
                  executionId: admitted(context.db, sourceIngestionWorkflow._tag, 'replay-link'),
                  payload: { event }
                })
              ))._tag === 'Success'
            );

            return { event };
          }).pipe(Effect.provide(services()))
        )
      );

      assert.strictEqual(calls, 1);
      context.close();
      context = new ServerContext(await location.open());
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
            yield* engine.execute(sourceIngestionWorkflow, {
              executionId: admitted(context.db, sourceIngestionWorkflow._tag, 'replay-link'),
              payload
            });
          }).pipe(Effect.provide(services()))
        )
      );
      assert.strictEqual(calls, 1);
      assert.ok(
        context.db.orm.all<{ text: string }>(sql`SELECT text FROM blocks`)[0].text === 'captured'
      );
    } finally {
      context.close();
      await location.cleanup();
      await peer.stop(true);
    }
  }
);

test.server.stable(
  'interrupting link ingestion closes the active HTTP request',
  async ({ databases, assert: assertions, createAiMock }) => {
    const assert: test.Assert = assertions;

    let started!: () => void;
    let closed!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const closedPromise = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const peer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        request.signal.addEventListener('abort', closed, { once: true });
        started();

        return new Promise<Response>((resolve) =>
          request.signal.addEventListener('abort', () => resolve(new Response(null)), {
            once: true
          })
        );
      }
    });

    assert.ok(peer.port, 'missing address');
    const base = peer.url.origin;
    const location = await databases();
    const context = new ServerContext(await location.open());
    using mock = createAiMock();
    const services = Layer.mergeAll(
      Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
      Layer.succeed(Database, { store: context }),
      Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
      agentsLayer({
        model: (tier, call) => mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError)),
        language: 'en',
        rules: Effect.succeed(defaultAgentRules),
        searchSources: () => Effect.succeed([])
      }),
      workflowEngineLayer(context)
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const source = yield* sources.addLink({ url: base, projectId: null });
            const state = yield* sources.sourceProcessing(source.id);

            assert.ok(state.requestId);
            const event = {
              type: 'SourceProcessingRequested' as const,
              sourceId: source.id,
              requestId: state.requestId,
              inputVersion: 1,
              eventId: 'interrupt-link',
              causationId: null,
              correlationId: state.requestId,
              depth: 0
            };
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
            yield* engine.execute(sourceIngestionWorkflow, {
              executionId: admitted(context.db, sourceIngestionWorkflow._tag, 'interrupt-link'),
              payload: { event },
              discard: true
            });
            yield* Effect.promise(() => startedPromise);
            yield* engine.interruptUnsafe(sourceIngestionWorkflow, 'interrupt-link');
            yield* Effect.promise(() => closedPromise);
            assert.ok((yield* sources.sourceProcessing(source.id)).documentId === null);
          }).pipe(Effect.provide(services))
        )
      );
    } finally {
      context.close();
      await location.cleanup();
      await peer.stop(true);
    }
  }
);

test.server.stable(
  'correction workflow publishes a new anchored document without changing history',
  async ({ databases, assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const { sourceCorrectionWorkflow, sourceCorrectionHandler } = await import('./index.ts');
    const { sql } = await import('@study/db');
    const { SourceStore } = await import('#server/features/sources/store/index');
    const { transaction } = await import('@study/server');
    const location = await databases();
    let context = new ServerContext(await location.open());
    const services = () =>
      Layer.mergeAll(
        Layer.succeed(Database, { store: context }),
        Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
        workflowEngineLayer(context)
      );

    try {
      context.db.orm.run(
        sql`INSERT INTO projects (id, name, created_at, updated_at) VALUES (1, 'One', 1, 1)`
      );
      const captured = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const source = yield* sources.createSource({
              name: 'a.txt',
              bytes: new Uint8Array([1]),
              projectId: 1n as ProjectId
            });
            const state = yield* sources.sourceProcessing(source.id);
            const document = {
              blocks: [
                plainBlock('paragraph' as const, 'before', { type: 'page' as const, page: 1 })
              ],
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
            };
            const old = yield* transaction((tx) =>
              tx.store(SourceStore).publishSourceDocument({
                id: source.id,
                expectedRevision: 1,
                requestId: state.requestId!,
                document
              })
            ).pipe(Effect.provideService(Database, { store: context }));
            const next = yield* sources.correctBlock({
              id: source.id,
              documentId: old.documentId,
              ordinal: 0,
              before: 'before',
              after: 'after'
            });
            const event = {
              type: 'SourceCorrectionRequested' as const,
              eventId: 'correction',
              causationId: null,
              correlationId: next.requestId!,
              inputVersion: 1,
              depth: 0,
              sourceId: source.id,
              requestId: next.requestId!,
              documentId: old.documentId,
              ordinal: 0,
              before: 'before',
              after: 'after'
            };
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(sourceCorrectionWorkflow, sourceCorrectionHandler);
            const id = yield* engine.execute(sourceCorrectionWorkflow, {
              executionId: admitted(context.db, sourceCorrectionWorkflow._tag, 'correct'),
              payload: { event }
            });

            assert.notStrictEqual(id, old.documentId);
            const current = yield* sources.sourceDocument(source.id);

            assert.ok(current.document.blocks[0].text === 'after');
            assert.strictEqual(current.document.blocks[0].id, document.blocks[0].id);
            const historical = yield* sources.document({
              id: old.documentId,
              sourceId: source.id,
              projectId: 1n as ProjectId
            });

            expect(historical.document).toStrictEqual(document);
            expect(current.document.blocks[0].anchor).toStrictEqual(document.blocks[0].anchor);
            assert.ok(current.document.meta.corrected === true);
            const indexed = context.db.orm.all<{ causation_id: string; correlation_id: string }>(
              sql`SELECT causation_id, correlation_id FROM workflow_events WHERE type = 'SourceIndexed'`
            );

            assert.strictEqual(indexed.length, 1);
            assert.strictEqual(indexed[0].causation_id, event.eventId);
            assert.strictEqual(indexed[0].correlation_id, event.correlationId);
            assert.strictEqual(
              yield* engine.execute(sourceCorrectionWorkflow, {
                executionId: admitted(context.db, sourceCorrectionWorkflow._tag, 'correct'),
                payload: { event }
              }),
              id
            );
            assert.strictEqual(context.db.orm.all(sql`SELECT * FROM content_snapshots`).length, 2);
            assert.strictEqual(
              context.db.orm.all(sql`SELECT * FROM workflow_events WHERE type = 'SourceIndexed'`)
                .length,
              1
            );
            assert.ok(
              context.db.orm.all<{ text: string }>(
                'SELECT text FROM blocks ORDER BY document_id'
              )[0].text === 'before'
            );

            return { event, id, sourceId: source.id };
          }).pipe(Effect.provide(services()))
        )
      );

      // Reopen after committed publication and join the same official execution.
      context.close();
      context = new ServerContext(await location.open());
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;
            const sources = yield* Sources;

            yield* engine.register(sourceCorrectionWorkflow, sourceCorrectionHandler);
            assert.strictEqual(
              yield* engine.execute(sourceCorrectionWorkflow, {
                executionId: admitted(context.db, sourceCorrectionWorkflow._tag, 'correct'),
                payload: { event: captured.event }
              }),
              captured.id
            );
            assert.ok(
              (yield* sources.sourceDocument(captured.sourceId)).document.blocks[0].text === 'after'
            );
            assert.strictEqual(context.db.orm.all(sql`SELECT * FROM content_snapshots`).length, 2);
            assert.strictEqual(
              context.db.orm.all(sql`SELECT * FROM workflow_events WHERE type = 'SourceIndexed'`)
                .length,
              1
            );
          }).pipe(Effect.provide(services()))
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
