/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies title workflow checkpointing and rejects stale context or sessions        │
 * │ renamed before publication.                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Tests the workflow against stale snapshots and concurrent user title changes.          │
 * │ - Asserts durable effects against persisted state and replay behavior.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite drives the native workflow engine with persisted test state; it does not       │
 * │ replace production activities.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createServer } from 'node:http';

import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import type { Context } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/service/index';
import { Settings } from '#server/features/settings/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';
import { withTestPublication } from '#testing/publication';

import { conversationTitleHandler, conversationTitleWorkflow } from './title.ts';

testStable('title workflow checkpoints and fences stale and renamed sessions', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  let calls = 0;
  let during: (() => Promise<void>) | undefined;
  let output = 'Cell Biology';
  const bodies: string[] = [];
  const peer = createServer(async (request, response) => {
    let body = '';

    for await (const chunk of request) body += chunk;

    bodies.push(body);

    calls++;
    const action = during;

    during = undefined;
    await action?.();
    response.writeHead(200, { 'content-type': 'text/event-stream' });

    for (const event of [
      { type: 'response.created', response: { id: 'resp', created_at: 1, model: 'test' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'item' }
      },
      { type: 'response.output_text.delta', item_id: 'item', delta: output },
      { type: 'response.completed', response: {} }
    ])
      response.write(`data: ${JSON.stringify(event)}\n\n`);

    response.end('data: [DONE]\n\n');
  });

  await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
  const address = peer.address();

  assert.ok(!(!address || typeof address === 'string'), 'missing address');

  const base = `http://127.0.0.1:${address.port}`;
  const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

  await auth.replace(
    { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
    { accessToken: 'token', expiresIn: 3600 }
  );
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
  const domain = () =>
    Layer.merge(Conversations.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
  const services = () =>
    Layer.mergeAll(
      domain(),
      Layer.succeed(Database, { store: context }),
      Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
      agentsLayer({
        model: () => Effect.succeed(model),
        language: Effect.succeed('en'),
        searchSources: () => Effect.succeed([])
      }),
      workflowEngineLayer(context)
    );
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      | Database
      | Context.Service.Identifier<typeof Conversations>
      | Context.Service.Identifier<typeof Settings>
    >
  ) => Effect.runPromise(effect.pipe(Effect.provide(domain())));

  try {
    const project = context.db.orm
      .insert(s.projects)
      .values({ name: 'P', created_at: 1n, updated_at: 1n })
      .returning()
      .get();
    const make = async () => {
      const session = await run(
        Effect.flatMap(Conversations, (c) => c.createUntitledSession({ project: project.id }))
      );
      const message = await run(
        Effect.flatMap(Conversations, (c) =>
          c.postMessage({ sessionId: session.id, text: 'Study cells' })
        )
      );

      return { session, message };
    };
    const request = async (sessionId: Awaited<ReturnType<typeof make>>['session']['id']) => {
      await run(Effect.flatMap(Conversations, (c) => c.requestTitle({ sessionId })));
      const event = decodeEvent(
        context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
      );

      assert.ok(!(event.type !== 'ConversationTitleRequested'), 'wrong event');

      return event;
    };
    const execute = (event: Awaited<ReturnType<typeof request>>, id: string) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(conversationTitleWorkflow, conversationTitleHandler);

            return yield* engine.execute(conversationTitleWorkflow, {
              executionId: id,
              payload: { event }
            });
          }).pipe(Effect.provide(services()))
        )
      );
    const first = await make();
    const stale = await request(first.session.id);

    await run(
      Effect.flatMap(Conversations, (c) =>
        c.editMessage({ messageId: first.message.id, text: 'Plants' })
      )
    );
    await expect(execute(stale, 'stale-title')).rejects.toSatisfy(() => true);
    assert.strictEqual(calls, 0);
    const old = await request(first.session.id);
    const current = await request(first.session.id);

    await expect(execute(old, 'old-title')).rejects.toSatisfy(() => true);
    assert.strictEqual(calls, 0);
    context.db.orm.run(
      sql`CREATE TRIGGER fail_title BEFORE UPDATE OF title ON sessions BEGIN SELECT RAISE(ABORT, 'unavailable'); END`
    );
    await expect(execute(current, 'replay-title')).rejects.toSatisfy(() => true);
    assert.strictEqual(calls, 1);
    context.db.orm.run(sql`DROP TRIGGER fail_title`);
    context.db.orm.run(
      sql`DELETE FROM workflow_activities WHERE execution_id = 'replay-title' AND name = 'publish-title'`
    );
    context.db.orm.run(
      sql`UPDATE workflow_executions SET status = 'suspended', result = NULL, owner_token = NULL WHERE execution_id = 'replay-title'`
    );
    context.close();
    context = new ServerContext(location.open());
    await execute(current, 'replay-title');
    assert.strictEqual(calls, 1);
    assert.ok(
      (await run(Effect.flatMap(Conversations, (c) => c.session(first.session.id)))).title ===
        'Cell Biology'
    );
    context.db.orm.run(
      sql`DELETE FROM workflow_activities WHERE execution_id='replay-title' AND name='publish-title'`
    );
    context.db.orm.run(
      sql`UPDATE workflow_executions SET status='suspended',result=NULL,owner_token=NULL WHERE execution_id='replay-title'`
    );
    await execute(current, 'replay-title');
    assert.strictEqual(calls, 1, 'a committed title must replay without a new model call');
    expect(bodies[0]!).toMatch(/Plants/);
    const renamed = await make();
    const renamedRequest = await request(renamed.session.id);

    await run(
      Effect.flatMap(Conversations, (c) =>
        c.renameSession({ id: renamed.session.id, title: 'Personal' })
      )
    );
    await expect(execute(renamedRequest, 'renamed-title')).rejects.toSatisfy(() => true);
    assert.strictEqual(calls, 1);
    const race = await make();
    const racing = await request(race.session.id);

    during = async () => {
      await run(
        Effect.flatMap(Conversations, (c) =>
          c.renameSession({ id: race.session.id, title: 'Mine' })
        )
      );
    };
    await expect(execute(racing, 'race-title')).rejects.toSatisfy(() => true);
    assert.ok(
      (await run(Effect.flatMap(Conversations, (c) => c.session(race.session.id)))).title === 'Mine'
    );
    const invalid = await make();

    output = 'x'.repeat(201);
    await expect(execute(await request(invalid.session.id), 'invalid-title')).rejects.toSatisfy(
      () => true
    );
    assert.ok(
      (await run(Effect.flatMap(Conversations, (c) => c.session(invalid.session.id))))
        .titleSource === 'provisional'
    );
    output = 'Valid retry';
    await execute(await request(invalid.session.id), 'retry-title');
    assert.ok(
      (await run(Effect.flatMap(Conversations, (c) => c.session(invalid.session.id)))).title ===
        'Valid retry'
    );
  } finally {
    await auth.dispose();
    context.close();
    location.cleanup();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
  }
});

testStable(
  'explicit title requests replace existing titles and fence subsequent manual edits',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Conversations.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const session = yield* conversations.createSession({ title: 'My biology notes' });

          yield* conversations.postMessage({ sessionId: session.id, text: 'Cells and tissues' });
          const first = yield* conversations.requestTitle({ sessionId: session.id });

          yield* withTestPublication(
            context,
            conversations
              .publishTitle({ requestId: first.requestId, title: 'Cell biology' })
              .pipe(Effect.asVoid)
          );
          assert.strictEqual((yield* conversations.session(session.id)).title, 'Cell biology');
          const second = yield* conversations.requestTitle({ sessionId: session.id });

          yield* withTestPublication(
            context,
            conversations
              .publishTitle({ requestId: second.requestId, title: 'Tissues' })
              .pipe(Effect.asVoid)
          );
          assert.strictEqual((yield* conversations.session(session.id)).title, 'Tissues');
          yield* conversations.renameSession({ id: session.id, title: 'Personal' });
          const pending = yield* conversations.requestTitle({ sessionId: session.id });

          yield* conversations.renameSession({ id: session.id, title: 'Personal' });
          assert.strictEqual(
            (yield* Effect.flip(conversations.titleSnapshot({ requestId: pending.requestId })))
              .kind,
            'invalid_input'
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'automatic session titles are opt-in, durable, replay-safe and respect user titles',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Layer.merge(Conversations.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const settings = yield* Settings;
          const session = yield* conversations.createUntitledSession({});

          yield* conversations.postMessage({ sessionId: session.id, text: 'Cells and tissues' });
          const titles = () =>
            context.db.orm
              .select()
              .from(s.workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .filter((event) => event.type === 'ConversationTitleRequested');

          assert.strictEqual(titles().length, 0);
          yield* settings.saveWorkspacePreferences({
            ...defaultWorkspacePreferences,
            autoTitleSessions: true
          });
          const input = {
            sessionId: session.id,
            text: 'Mitosis overview',
            captureKey: 'automatic-title-note',
            requestReply: false
          };
          const note = yield* conversations.postMessage(input);

          assert.strictEqual(titles().length, 1);
          assert.strictEqual((yield* conversations.postMessage(input)).id, note.id);
          assert.strictEqual(titles().length, 1);
          yield* conversations.renameSession({ id: session.id, title: 'My biology notes' });
          yield* conversations.postMessage({ sessionId: session.id, text: 'More cells' });
          assert.strictEqual(titles().length, 1);
          yield* settings.saveWorkspacePreferences(defaultWorkspacePreferences);
          const manual = yield* conversations.createUntitledSession({});

          yield* conversations.postMessage({ sessionId: manual.id, text: 'Manual title' });
          yield* conversations.requestTitle({ sessionId: manual.id });
          assert.strictEqual(titles().length, 2);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'automatic titles and replies commit together while title snapshots skip pending assistants',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Layer.merge(Conversations.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const settings = yield* Settings;

          yield* settings.saveWorkspacePreferences({
            ...defaultWorkspacePreferences,
            autoTitleSessions: true
          });
          const session = yield* conversations.createUntitledSession({});
          const note = yield* conversations.postMessage({
            sessionId: session.id,
            text: 'Explain cell division',
            requestReply: true
          });
          const events = context.db.orm
            .select()
            .from(s.workflowEvents)
            .all()
            .map((row) => decodeEvent(row.payload));
          const title = events.find((event) => event.type === 'ConversationTitleRequested');
          const reply = events.find((event) => event.type === 'ConversationGenerationRequested');

          assert.ok(title && title.type === 'ConversationTitleRequested');
          assert.ok(reply && reply.type === 'ConversationGenerationRequested');
          expect(title.messages.map((message) => message.messageId)).toStrictEqual([note.id]);
          expect(
            (yield* conversations.titleSnapshot({ requestId: title.requestId })).messages
          ).toStrictEqual(title.messages);
          const thread = yield* conversations.thread({ sessionId: session.id, limit: 10 });

          assert.strictEqual(thread.items.length, 2);
          assert.ok(thread.items[1]?.versions[0]?.status === 'pending');
          const manual = yield* conversations.requestTitle({ sessionId: session.id });

          expect((yield* conversations.titleSnapshot(manual)).messages).toStrictEqual(
            title.messages
          );
          yield* conversations.editMessage({ messageId: note.id, text: 'New context' });
          assert.ok(
            (yield* Effect.flip(conversations.titleSnapshot(manual))).kind === 'invalid_input'
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'reply publication refreshes automatic titles durably and idempotently without replacing user titles',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Layer.merge(Conversations.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const settings = yield* Settings;

          yield* settings.saveWorkspacePreferences({
            ...defaultWorkspacePreferences,
            autoTitleSessions: true
          });
          const session = yield* conversations.createUntitledSession({});

          yield* conversations.postMessage({
            sessionId: session.id,
            text: 'How do cells divide?',
            requestReply: true
          });
          const events = () =>
            context.db.orm
              .select()
              .from(s.workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload));
          const titles = () =>
            events().filter((event) => event.type === 'ConversationTitleRequested');
          const reply = events().find((event) => event.type === 'ConversationGenerationRequested');
          const original = titles()[0];

          assert.ok(reply && reply.type === 'ConversationGenerationRequested');
          assert.ok(original);
          const publication = {
            requestId: reply.requestId,
            text: 'Cells divide through mitosis.',
            citations: []
          };

          yield* withTestPublication(
            context,
            conversations.publishReply(publication).pipe(Effect.asVoid)
          );
          assert.ok(
            (yield* Effect.flip(conversations.titleSnapshot({ requestId: original.requestId })))
              .kind === 'invalid_input'
          );
          assert.strictEqual(titles().length, 2);
          const refreshed = titles()[1]!;

          assert.strictEqual(
            (yield* conversations.titleSnapshot({ requestId: refreshed.requestId })).messages
              .length,
            2
          );
          yield* withTestPublication(
            context,
            conversations.publishReply(publication).pipe(Effect.asVoid)
          );
          assert.strictEqual(titles().length, 2);
          yield* withTestPublication(
            context,
            conversations
              .publishTitle({ requestId: refreshed.requestId, title: 'Cell division' })
              .pipe(Effect.asVoid)
          );
          assert.ok((yield* conversations.session(session.id)).title === 'Cell division');
          const manual = yield* conversations.createUntitledSession({});

          yield* conversations.postMessage({
            sessionId: manual.id,
            text: 'More biology',
            requestReply: true
          });
          const manualReply = events().findLast(
            (event) => event.type === 'ConversationGenerationRequested'
          );

          assert.ok(manualReply && manualReply.type === 'ConversationGenerationRequested');
          yield* conversations.renameSession({ id: manual.id, title: 'My title' });
          const before = titles().length;

          yield* withTestPublication(
            context,
            conversations
              .publishReply({
                requestId: manualReply.requestId,
                text: 'Biology answer',
                citations: []
              })
              .pipe(Effect.asVoid)
          );
          assert.strictEqual(titles().length, before);
          assert.ok((yield* conversations.session(manual.id)).title === 'My title');
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
