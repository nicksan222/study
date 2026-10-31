import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProjectId } from '@study/contracts/ids';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { Sources } from '#server/features/sources/service/index';
import {
  sourceIngestionWorkflow,
  sourceIngestionHandler
} from '#server/features/sources/workflows/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';

test('native ingestion publishes an anchored text document through Sources', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const auth = new AuthManager({ issuer: 'http://127.0.0.1', saveRefresh: async () => {} });
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: 'http://127.0.0.1' });
  const services = Layer.mergeAll(
    Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
    Layer.succeed(Database, { store: context }),
    Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
    agentsLayer({
      model: () => Effect.succeed(model),
      language: 'en',
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
            name: 'test.txt',
            bytes: new TextEncoder().encode('Hello'),
            projectId: null
          });
          const state = yield* sources.sourceProcessing(source.id);

          assert.ok(state.requestId);
          const event = {
            type: 'SourceProcessingRequested' as const,
            sourceId: source.id,
            requestId: state.requestId,
            inputVersion: 1,
            eventId: 'event-1',
            causationId: null,
            correlationId: state.requestId,
            depth: 0
          };
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
          const id = yield* engine.execute(sourceIngestionWorkflow, {
            executionId: 'text',
            payload: { event }
          });

          assert.equal((yield* sources.sourceProcessing(source.id)).documentId, id);
          const rows = context.db.orm.all<{ text: string }>('SELECT text FROM blocks');

          assert.deepEqual(
            rows.map((row) => row.text),
            ['Hello']
          );
        }).pipe(Effect.provide(services))
      )
    );
  } finally {
    await auth.dispose();
    context.close();
    location.cleanup();
  }
});

test('superseded requests cannot publish and a cancelled pending execution stays unpublished', async () => {
  const { dispatchPending } = await import('#server/platform/workflows/triggers');
  const { recoverWorkflowEngine } = await import('#server/platform/workflows/engine');
  const { sourceIngestionRegistration } = await import('#server/features/sources/workflows/index');
  const { workflowStore } = await import('#server/platform/workflows/store');
  const { workflow_executions } = await import('@study/db/schema');
  const { SourceStore } = await import('#server/features/sources/store/index');
  const { transaction } = await import('#server/platform/definitions/define-store');
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const auth = new AuthManager({ issuer: 'http://127.0.0.1', saveRefresh: async () => {} });
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: 'http://127.0.0.1' });
  const services = Layer.mergeAll(
    Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
    Layer.succeed(Database, { store: context }),
    Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
    agentsLayer({
      model: () => Effect.succeed(model),
      language: 'en',
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

          yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
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
            engine.execute(sourceIngestionWorkflow, { executionId: 'stale', payload: { event } })
          );

          assert.equal(failure.kind, 'invalid_input');
          assert.equal((yield* sources.sourceProcessing(source.id)).documentId, null);
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
              executionId: 'stale-revision',
              payload: { event: revisionEvent }
            })
          );

          assert.equal(revisionFailure.kind, 'invalid_input');
          assert.equal((yield* sources.sourceProcessing(revisionSource.id)).documentId, null);
          assert.equal(
            dispatchPending(context, sourceIngestionRegistration.triggers, Date.now()),
            3
          );
          const pending = context.db.orm
            .select()
            .from(workflow_executions)
            .all()
            .filter((row) => row.execution_id !== 'stale' && row.execution_id !== 'stale-revision');

          for (const row of pending) workflowStore(context).interrupt(row.execution_id, 'safe');

          yield* recoverWorkflowEngine(context, engine, [sourceIngestionWorkflow]);

          for (const row of pending) {
            while (workflowStore(context).execution(row.execution_id)?.status !== 'cancelled')
              yield* Effect.sleep('10 millis');
          }

          assert.equal((yield* sources.sourceProcessing(source.id)).documentId, null);
        }).pipe(Effect.provide(services))
      )
    );
  } finally {
    await auth.dispose();
    context.close();
    location.cleanup();
  }
});

for (const input of ['attachment', 'link'] as const)
  test(`${input} PDF transcription is checkpointed and replayed after reopening SQLite`, async () => {
    const { createServer } = await import('node:http');
    const { readFile } = await import('node:fs/promises');
    const { sql } = await import('@study/db');
    let calls = 0;
    let fetches = 0;
    const fixture = await readFile(new URL('../decoders/fixtures/two-pages.pdf', import.meta.url));
    let requestBody: Record<string, unknown> = {};
    const peer = createServer(async (request, response) => {
      if (request.method === 'GET' && request.url === '/two.pdf') {
        fetches++;
        response.writeHead(200, { 'content-type': 'application/pdf' });
        response.end(fixture);

        return;
      }

      const chunks: Buffer[] = [];

      for await (const chunk of request) chunks.push(chunk as Buffer);

      calls++;
      requestBody = JSON.parse(Buffer.concat(chunks).toString());
      response.writeHead(200, { 'content-type': 'text/event-stream' });

      for (const event of [
        { type: 'response.created', response: { id: 'resp', created_at: 1, model: 'test' } },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', id: 'item' }
        },
        {
          type: 'response.output_text.delta',
          item_id: 'item',
          delta: JSON.stringify({
            pages: [
              { page: 1, blocks: [{ kind: 'heading', text: 'One' }] },
              { page: 2, blocks: [{ kind: 'paragraph', text: 'Two' }] }
            ]
          })
        },
        { type: 'response.completed', response: {} }
      ])
        response.write(`data: ${JSON.stringify(event)}\n\n`);

      response.end('data: [DONE]\n\n');
    });

    await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
    const address = peer.address();

    if (!address || typeof address === 'string') throw new Error('missing peer address');

    const base = `http://127.0.0.1:${address.port}`;
    const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'token', expiresIn: 3600 }
    );
    const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const services = () =>
      Layer.mergeAll(
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
        Layer.succeed(Database, { store: context }),
        Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
        agentsLayer({
          model: () => Effect.succeed(model),
          language: 'en',
          searchSources: () => Effect.succeed([])
        }),
        workflowEngineLayer(context)
      );

    try {
      // Fail publication after the decode checkpoint, then restore the crash window on disk.
      context.db.orm.run(
        sql`CREATE TRIGGER fail_document BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT, 'publication unavailable'); END`
      );
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
                executionId: 'superseded-pdf',
                payload: {
                  event: { ...event, requestId: 'superseded-request', eventId: 'superseded-pdf' }
                }
              })
            );

            assert.equal(stale.kind, 'invalid_input');
            assert.equal(calls, 0);
            const exit = yield* Effect.exit(
              engine.execute(sourceIngestionWorkflow, { executionId: 'pdf', payload: { event } })
            );

            assert.equal(exit._tag, 'Failure');

            return { event };
          }).pipe(Effect.provide(services()))
        )
      );

      assert.equal(calls, 1);
      assert.equal(fetches, input === 'link' ? 1 : 0);
      assert.match(String(requestBody.instructions), /Transcribe all pages in order/);
      assert.equal(
        context.db.orm.all(
          sql`SELECT * FROM workflow_activities WHERE execution_id = 'pdf' AND name = 'decode-source'`
        ).length,
        1
      );
      context.db.orm.run(sql`DROP TRIGGER fail_document`);
      context.db.orm.run(
        sql`DELETE FROM workflow_activities WHERE execution_id = 'pdf' AND name = 'publish-source'`
      );
      context.db.orm.run(
        sql`UPDATE workflow_executions SET status = 'suspended', result = NULL, owner_token = NULL WHERE execution_id = 'pdf'`
      );
      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
            yield* engine.execute(sourceIngestionWorkflow, { executionId: 'pdf', payload });
          }).pipe(Effect.provide(services()))
        )
      );
      assert.equal(calls, 1);
      assert.equal(fetches, input === 'link' ? 1 : 0);
      assert.deepEqual(
        context.db.orm
          .all<{ text: string }>(sql`SELECT text FROM blocks ORDER BY ordinal`)
          .map((row) => row.text),
        ['One', 'Two']
      );
    } finally {
      await auth.dispose();
      context.close();
      location.cleanup();
      peer.closeAllConnections();
      await new Promise<void>((resolve) => peer.close(() => resolve()));
    }
  });

test('ingestion publishes visible HTML, delimited text and Office documents', async () => {
  const { readFile } = await import('node:fs/promises');
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const auth = new AuthManager({ issuer: 'http://127.0.0.1', saveRefresh: async () => {} });
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: 'http://127.0.0.1' });
  const services = Layer.mergeAll(
    Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
    Layer.succeed(Database, { store: context }),
    Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
    agentsLayer({
      model: () => Effect.succeed(model),
      language: 'en',
      searchSources: () => Effect.succeed([])
    }),
    workflowEngineLayer(context)
  );
  const fixture = (name: string) =>
    readFile(new URL(`../decoders/fixtures/${name}`, import.meta.url));
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
              executionId: `format-${index}`,
              payload: { event }
            });

            assert.equal((yield* sources.sourceProcessing(source.id)).documentId, id);
            const rows = context.db.orm.all<{ text: string }>(
              'SELECT text FROM blocks ORDER BY rowid'
            );

            assert.deepEqual(
              rows.slice(-sample.expected.length).map((row) => row.text),
              sample.expected,
              sample.name
            );
          }

          const { SourceStore } = yield* Effect.promise(
            () => import('#server/features/sources/store/index')
          );
          const { transaction } = yield* Effect.promise(
            () => import('#server/platform/definitions/define-store')
          );
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
            executionId: 'web',
            payload: { event: webEvent }
          });
          const anchor = context.db.orm.all<{ anchor: string }>(
            'SELECT anchor FROM blocks ORDER BY rowid DESC LIMIT 1'
          )[0].anchor;

          assert.deepEqual(JSON.parse(anchor), {
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
                executionId: `unsupported-${index}`,
                payload: { event }
              })
            );

            assert.equal(failure.kind, 'unsupported', name);
          }
        }).pipe(Effect.provide(services))
      )
    );
  } finally {
    await auth.dispose();
    context.close();
    location.cleanup();
  }
});

test('link ingestion follows redirects and anchors HTML to the final URI', async () => {
  const { createServer } = await import('node:http');
  let calls = 0;
  const peer = createServer((request, response) => {
    calls++;

    if (request.url === '/start') response.writeHead(302, { location: '/final' }).end();
    else
      response
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<main><h1 id="title">Hello</h1></main>');
  });

  await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
  const address = peer.address();

  if (!address || typeof address === 'string') throw new Error('missing address');

  const base = `http://127.0.0.1:${address.port}`;
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
  const services = Layer.mergeAll(
    Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
    Layer.succeed(Database, { store: context }),
    Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
    agentsLayer({
      model: () => Effect.succeed(model),
      language: 'en',
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
            executionId: 'link',
            payload: { event }
          });
          const rows = context.db.orm.all<{ text: string; anchor: string }>(
            'SELECT text, anchor FROM blocks'
          );

          assert.equal(rows[0].text, 'Hello');
          assert.equal(JSON.parse(rows[0].anchor).url, `${base}/final`);
          assert.equal((yield* sources.source(source.id)).uri, `${base}/start`);
          assert.equal(calls, 2);
        }).pipe(Effect.provide(services))
      )
    );
  } finally {
    await auth.dispose();
    context.close();
    location.cleanup();
    peer.closeAllConnections();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
  }
});

test('link fetch checkpoint survives SQLite reopen without another request', async () => {
  const { createServer } = await import('node:http');
  const { sql } = await import('@study/db');
  let calls = 0;
  const peer = createServer((_request, response) => {
    calls++;
    response.writeHead(200, { 'content-type': 'text/plain' }).end('captured');
  });

  await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
  const address = peer.address();

  if (!address || typeof address === 'string') throw new Error('missing address');

  const base = `http://127.0.0.1:${address.port}`;
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
  const services = () =>
    Layer.mergeAll(
      Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
      Layer.succeed(Database, { store: context }),
      Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
      agentsLayer({
        model: () => Effect.succeed(model),
        language: 'en',
        searchSources: () => Effect.succeed([])
      }),
      workflowEngineLayer(context)
    );

  try {
    context.db.orm.run(
      sql`CREATE TRIGGER fail_link_document BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT, 'publication unavailable'); END`
    );
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
              executionId: 'stale-link',
              payload: { event: { ...event, requestId: 'stale' } }
            })
          );

          assert.equal(stale.kind, 'invalid_input');
          assert.equal(calls, 0);
          assert.equal(
            (yield* Effect.exit(
              engine.execute(sourceIngestionWorkflow, {
                executionId: 'replay-link',
                payload: { event }
              })
            ))._tag,
            'Failure'
          );

          return { event };
        }).pipe(Effect.provide(services()))
      )
    );

    assert.equal(calls, 1);
    assert.equal(
      context.db.orm.all(
        sql`SELECT * FROM workflow_activities WHERE execution_id = 'replay-link' AND name = 'fetch-source'`
      ).length,
      1
    );
    context.db.orm.run(sql`DROP TRIGGER fail_link_document`);
    context.db.orm.run(
      sql`DELETE FROM workflow_activities WHERE execution_id = 'replay-link' AND name IN ('decode-source', 'publish-source')`
    );
    context.db.orm.run(
      sql`UPDATE workflow_executions SET status = 'suspended', result = NULL, owner_token = NULL WHERE execution_id = 'replay-link'`
    );
    context.close();
    context = new ServerContext(location.open());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
          yield* engine.execute(sourceIngestionWorkflow, { executionId: 'replay-link', payload });
        }).pipe(Effect.provide(services()))
      )
    );
    assert.equal(calls, 1);
    assert.equal(
      context.db.orm.all<{ text: string }>(sql`SELECT text FROM blocks`)[0].text,
      'captured'
    );
  } finally {
    await auth.dispose();
    context.close();
    location.cleanup();
    peer.closeAllConnections();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
  }
});

test('interrupting link ingestion closes the active HTTP request', async () => {
  const { createServer } = await import('node:http');
  let started!: () => void;
  let closed!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const closedPromise = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const peer = createServer((request) => {
    request.on('close', closed);
    started();
  });

  await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
  const address = peer.address();

  if (!address || typeof address === 'string') throw new Error('missing address');

  const base = `http://127.0.0.1:${address.port}`;
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
  const services = Layer.mergeAll(
    Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
    Layer.succeed(Database, { store: context }),
    Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context }))),
    agentsLayer({
      model: () => Effect.succeed(model),
      language: 'en',
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
            executionId: 'interrupt-link',
            payload: { event },
            discard: true
          });
          yield* Effect.promise(() => startedPromise);
          yield* engine.interruptUnsafe(sourceIngestionWorkflow, 'interrupt-link');
          yield* Effect.promise(() => closedPromise);
          assert.equal((yield* sources.sourceProcessing(source.id)).documentId, null);
        }).pipe(Effect.provide(services))
      )
    );
  } finally {
    await auth.dispose();
    context.close();
    location.cleanup();
    peer.closeAllConnections();
    peer.closeAllConnections();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
  }
});

test('correction workflow publishes a new anchored document without changing history', async () => {
  const { sourceCorrectionWorkflow, sourceCorrectionHandler } = await import('./index.ts');
  const { sql } = await import('@study/db');
  const { SourceStore } = await import('#server/features/sources/store/index');
  const { transaction } = await import('#server/platform/definitions/define-store');
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
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
              {
                kind: 'paragraph' as const,
                text: 'before',
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
            executionId: 'correct',
            payload: { event }
          });

          assert.notEqual(id, old.documentId);
          const current = yield* sources.sourceDocument(source.id);

          assert.equal(current.document.blocks[0].text, 'after');
          assert.deepEqual(current.document.blocks[0].anchor, document.blocks[0].anchor);
          assert.equal(current.document.meta.corrected, true);
          const indexed = context.db.orm.all<{ causation_id: string; correlation_id: string }>(
            sql`SELECT causation_id, correlation_id FROM workflow_events WHERE type = 'SourceIndexed'`
          );

          assert.equal(indexed.length, 1);
          assert.equal(indexed[0].causation_id, event.eventId);
          assert.equal(indexed[0].correlation_id, event.correlationId);
          context.db.orm.run(
            sql`DELETE FROM workflow_activities WHERE execution_id = 'correct' AND name = 'publish-source'`
          );
          context.db.orm.run(
            sql`UPDATE workflow_executions SET status = 'suspended', result = NULL, owner_token = NULL WHERE execution_id = 'correct'`
          );
          assert.equal(
            yield* engine.execute(sourceCorrectionWorkflow, {
              executionId: 'correct',
              payload: { event }
            }),
            id
          );
          assert.equal(context.db.orm.all(sql`SELECT * FROM documents`).length, 2);
          assert.equal(
            context.db.orm.all(sql`SELECT * FROM workflow_events WHERE type = 'SourceIndexed'`)
              .length,
            1
          );
          assert.equal(
            context.db.orm.all<{ text: string }>('SELECT text FROM blocks ORDER BY document_id')[0]
              .text,
            'before'
          );

          return { event, id, sourceId: source.id };
        }).pipe(Effect.provide(services()))
      )
    );

    // Publication committed but its activity checkpoint was lost before process exit.
    context.db.orm.run(
      sql`DELETE FROM workflow_activities WHERE execution_id = 'correct' AND name = 'publish-source'`
    );
    context.db.orm.run(
      sql`UPDATE workflow_executions SET status = 'suspended', result = NULL, owner_token = NULL WHERE execution_id = 'correct'`
    );
    context.close();
    context = new ServerContext(location.open());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;
          const sources = yield* Sources;

          yield* engine.register(sourceCorrectionWorkflow, sourceCorrectionHandler);
          assert.equal(
            yield* engine.execute(sourceCorrectionWorkflow, {
              executionId: 'correct',
              payload: { event: captured.event }
            }),
            captured.id
          );
          assert.equal(
            (yield* sources.sourceDocument(captured.sourceId)).document.blocks[0].text,
            'after'
          );
          assert.equal(context.db.orm.all(sql`SELECT * FROM documents`).length, 2);
          assert.equal(
            context.db.orm.all(sql`SELECT * FROM workflow_events WHERE type = 'SourceIndexed'`)
              .length,
            1
          );
        }).pipe(Effect.provide(services()))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
