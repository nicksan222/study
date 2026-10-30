import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';
import type { Context } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

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

import { conversationTitleHandler, conversationTitleWorkflow } from './title.ts';

test('title workflow checkpoints and fences stale and renamed sessions', async () => {
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

  if (!address || typeof address === 'string') throw new Error('missing address');

  const base = `http://127.0.0.1:${address.port}`;
  const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

  await auth.replace(
    { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
    { accessToken: 'token', expiresIn: 3600 }
  );
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
  const domain = () =>
    Layer.merge(Conversations.layer, Settings.layer).pipe(
      Layer.provide(Layer.succeed(Database, { store: context }))
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
      Context.Service.Identifier<typeof Conversations> | Context.Service.Identifier<typeof Settings>
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

      if (event.type !== 'ConversationTitleRequested') throw new Error('wrong event');

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
    await assert.rejects(execute(stale, 'stale-title'));
    assert.equal(calls, 0);
    const old = await request(first.session.id);
    const current = await request(first.session.id);

    await assert.rejects(execute(old, 'old-title'));
    assert.equal(calls, 0);
    context.db.orm.run(
      sql`CREATE TRIGGER fail_title BEFORE UPDATE OF title ON sessions BEGIN SELECT RAISE(ABORT, 'unavailable'); END`
    );
    await assert.rejects(execute(current, 'replay-title'));
    assert.equal(calls, 1);
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
    assert.equal(calls, 1);
    assert.equal(
      (await run(Effect.flatMap(Conversations, (c) => c.session(first.session.id)))).title,
      'Cell Biology'
    );
    context.db.orm.run(
      sql`DELETE FROM workflow_activities WHERE execution_id='replay-title' AND name='publish-title'`
    );
    context.db.orm.run(
      sql`UPDATE workflow_executions SET status='suspended',result=NULL,owner_token=NULL WHERE execution_id='replay-title'`
    );
    await execute(current, 'replay-title');
    assert.equal(calls, 1, 'a committed title must replay without a new model call');
    assert.match(bodies[0]!, /Plants/);
    const renamed = await make();
    const renamedRequest = await request(renamed.session.id);

    await run(
      Effect.flatMap(Conversations, (c) =>
        c.renameSession({ id: renamed.session.id, title: 'Personal' })
      )
    );
    await assert.rejects(execute(renamedRequest, 'renamed-title'));
    assert.equal(calls, 1);
    const race = await make();
    const racing = await request(race.session.id);

    during = async () => {
      await run(
        Effect.flatMap(Conversations, (c) =>
          c.renameSession({ id: race.session.id, title: 'Mine' })
        )
      );
    };
    await assert.rejects(execute(racing, 'race-title'));
    assert.equal(
      (await run(Effect.flatMap(Conversations, (c) => c.session(race.session.id)))).title,
      'Mine'
    );
    const invalid = await make();

    output = 'x'.repeat(201);
    await assert.rejects(execute(await request(invalid.session.id), 'invalid-title'));
    assert.equal(
      (await run(Effect.flatMap(Conversations, (c) => c.session(invalid.session.id)))).titleSource,
      'provisional'
    );
    output = 'Valid retry';
    await execute(await request(invalid.session.id), 'retry-title');
    assert.equal(
      (await run(Effect.flatMap(Conversations, (c) => c.session(invalid.session.id)))).title,
      'Valid retry'
    );
  } finally {
    await auth.dispose();
    context.close();
    location.cleanup();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
  }
});
