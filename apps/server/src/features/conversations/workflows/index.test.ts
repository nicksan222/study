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
import { Sources } from '#server/features/sources/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';

import { conversationReplyHandler, conversationReplyWorkflow } from './index.ts';

test('reply checkpoints plain output and fences stale context and fabricated citations', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  let calls = 0;
  let output = 'A plain answer';
  let cancel: (() => Promise<void>) | undefined;
  let toolCall = false;
  const bodies: string[] = [];
  let duringCall: (() => Promise<void>) | undefined;
  let duringModelResolution: (() => Promise<void>) | undefined;
  let duringLanguageResolution: (() => Promise<void>) | undefined;
  let duringToolCall: (() => Promise<void>) | undefined;
  const peer = createServer(async (request, response) => {
    let body = '';

    for await (const chunk of request) body += chunk;

    bodies.push(body);
    calls++;

    if (toolCall) {
      toolCall = false;
      const action = duringToolCall;

      duringToolCall = undefined;
      await action?.();
      const call = {
        type: 'function_call',
        id: 'item1',
        call_id: 'call1',
        name: 'sources',
        arguments: '{"query":"alpha"}'
      };

      response.writeHead(200, { 'content-type': 'text/event-stream' });

      for (const event of [
        { type: 'response.output_item.added', output_index: 0, item: call },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: { ...call, status: 'completed' }
        },
        { type: 'response.completed', response: {} }
      ])
        response.write(`data: ${JSON.stringify(event)}\n\n`);

      response.end();

      return;
    }

    if (duringCall) {
      const action = duringCall;

      duringCall = undefined;
      await action();
    }

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

  assert.ok(address, 'missing address');
  assert.ok(typeof address !== 'string', 'expected TCP address');

  const base = `http://127.0.0.1:${address.port}`;
  const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

  await auth.replace(
    { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
    { accessToken: 'token', expiresIn: 3600 }
  );
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
  const domain = () =>
    Layer.merge(Conversations.layer, Sources.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
  const services = () =>
    Layer.mergeAll(
      domain(),
      Layer.succeed(Database, { store: context }),
      Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
      agentsLayer({
        model: () =>
          Effect.promise(async () => {
            const action = duringModelResolution;

            duringModelResolution = undefined;
            await action?.();

            return model;
          }),
        language: Effect.promise(async () => {
          const action = duringLanguageResolution;

          duringLanguageResolution = undefined;
          await action?.();

          return 'en';
        }),
        searchSources: () => Effect.succeed([])
      }),
      workflowEngineLayer(context)
    );
  const run = <A, E>(
    effect: Effect.Effect<A, E, Database | Context.Service.Identifier<typeof Conversations>>
  ) => Effect.runPromise(effect.pipe(Effect.provide(domain())));

  try {
    const project = context.db.orm
      .insert(s.projects)
      .values({ name: 'P', created_at: 1n, updated_at: 1n })
      .returning()
      .get();
    const session = await run(
      Effect.flatMap(Conversations, (c) => c.createSession({ project: project.id, title: 'Chat' }))
    );
    const post = () =>
      run(
        Effect.flatMap(Conversations, (c) =>
          c.postMessage({ sessionId: session.id, text: 'Question' })
        )
      );
    const request = async () => {
      await run(Effect.flatMap(Conversations, (c) => c.requestReply({ sessionId: session.id })));
      const event = decodeEvent(
        context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
      );

      assertEventType(event, 'ConversationGenerationRequested', 'wrong event');

      return event;
    };
    const execute = (event: Awaited<ReturnType<typeof request>>, id: string) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            cancel = () => Effect.runPromise(engine.interruptUnsafe(conversationReplyWorkflow, id));
            yield* engine.register(conversationReplyWorkflow, conversationReplyHandler);

            return yield* engine.execute(conversationReplyWorkflow, {
              executionId: id,
              payload: { event }
            });
          }).pipe(Effect.provide(services()))
        )
      );
    const first = await post();
    const stale = await request();

    await run(
      Effect.flatMap(Conversations, (c) => c.editMessage({ messageId: first.id, text: 'Changed' }))
    );
    await assert.rejects(execute(stale, 'stale'));
    assert.equal(calls, 0);
    const resolverRace = await request();

    duringModelResolution = async () => {
      await run(
        Effect.flatMap(Conversations, (c) =>
          c.editMessage({ messageId: first.id, text: 'Changed while resolving model' })
        )
      );
    };
    await assert.rejects(execute(resolverRace, 'model-resolution-race'));
    assert.equal(calls, 0, 'stale context must not reach the provider after model resolution');
    const languageRace = await request();

    duringLanguageResolution = async () => {
      await run(
        Effect.flatMap(Conversations, (c) =>
          c.editMessage({ messageId: first.id, text: 'Changed while resolving language' })
        )
      );
    };
    await assert.rejects(execute(languageRace, 'language-resolution-race'));
    assert.equal(calls, 0, 'stale context must not reach the provider after language resolution');
    const current = await request();

    await assert.rejects(execute({ ...current, messageId: first.id }, 'wrong-target'));
    await run(
      Effect.flatMap(Conversations, (c) => c.replySnapshot({ requestId: current.requestId }))
    );

    context.db.orm.run(
      sql`CREATE TRIGGER fail_reply BEFORE UPDATE OF status ON message_versions WHEN NEW.status = 'complete' BEGIN SELECT RAISE(ABORT, 'unavailable'); END`
    );
    await assert.rejects(execute(current, 'replay'));
    assert.equal(calls, 1);
    context.db.orm.run(sql`DROP TRIGGER fail_reply`);
    context.db.orm.run(
      sql`DELETE FROM workflow_activities WHERE execution_id = 'replay' AND name = 'publish-reply'`
    );
    context.db.orm.run(
      sql`UPDATE workflow_executions SET status = 'suspended', result = NULL, owner_token = NULL WHERE execution_id = 'replay'`
    );
    context.close();
    context = new ServerContext(location.open());
    await execute(current, 'replay');
    assert.equal(calls, 1);
    assert.equal(
      context.db.orm
        .select()
        .from(s.message_versions)
        .all()
        .find((v) => v.id === current.versionId)?.text,
      'A plain answer'
    );
    const reanswer = await run(
      Effect.flatMap(Conversations, (c) => c.reanswer({ messageId: current.messageId }))
    );
    const reanswerEvent = decodeEvent(
      context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
    );

    assertEventType(reanswerEvent, 'ConversationGenerationRequested', 'wrong event');

    output = 'Another answer';
    await execute(reanswerEvent, 'reanswer');
    const answered = await run(Effect.flatMap(Conversations, (c) => c.message(current.messageId)));

    assert.equal(reanswer.messageId, current.messageId);
    assert.equal(answered.versions.length, 2);
    assert.equal(answered.versions.at(-1)?.text, 'Another answer');
    const rewrite = await run(
      Effect.flatMap(Conversations, (c) =>
        c.rewriteMessage({
          messageId: current.messageId,
          origin: 'instruction',
          instruction: 'Use bullet points'
        })
      )
    );
    const rewriteEvent = decodeEvent(
      context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
    );

    assertEventType(rewriteEvent, 'ConversationGenerationRequested', 'wrong event');

    output = 'Rewritten answer';
    context.db.orm.run(
      sql`CREATE TRIGGER fail_rewrite BEFORE UPDATE OF status ON message_versions WHEN NEW.status = 'complete' BEGIN SELECT RAISE(ABORT, 'unavailable'); END`
    );
    const beforeRewrite = calls;

    await assert.rejects(execute(rewriteEvent, 'rewrite'));
    assert.equal(calls, beforeRewrite + 1);
    context.db.orm.run(sql`DROP TRIGGER fail_rewrite`);
    context.db.orm.run(
      sql`DELETE FROM workflow_activities WHERE execution_id = 'rewrite' AND name = 'publish-reply'`
    );
    context.db.orm.run(
      sql`UPDATE workflow_executions SET status = 'suspended', result = NULL, owner_token = NULL WHERE execution_id = 'rewrite'`
    );
    context.close();
    context = new ServerContext(location.open());
    await execute(rewriteEvent, 'rewrite');
    assert.equal(calls, beforeRewrite + 1);
    const rewritten = await run(Effect.flatMap(Conversations, (c) => c.message(current.messageId)));

    assert.equal(rewrite.messageId, current.messageId);
    assert.equal(rewritten.versions.at(-1)?.origin, 'instruction');
    assert.equal(rewritten.versions.at(-1)?.instruction, 'Use bullet points');
    assert.match(bodies.at(-1)!, /Use bullet points/);
    const userRewrite = await run(
      Effect.flatMap(Conversations, (c) =>
        c.rewriteMessage({ messageId: first.id, origin: 'summarize' })
      )
    );
    const userEvent = decodeEvent(
      context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
    );

    assertEventType(userEvent, 'ConversationGenerationRequested', 'wrong event');

    output = 'Short question';
    await execute(userEvent, 'rewrite-user');
    const userResult = await run(Effect.flatMap(Conversations, (c) => c.message(first.id)));

    assert.equal(userResult.versions.at(-1)?.origin, 'summarize');
    assert.equal(userResult.activeVersionId, userRewrite.versionId);
    const oldRequest = await run(
      Effect.flatMap(Conversations, (c) =>
        c.rewriteMessage({ messageId: current.messageId, origin: 'improve' })
      )
    );
    const oldEvent = decodeEvent(
      context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
    );

    assertEventType(oldEvent, 'ConversationGenerationRequested', 'wrong event');

    const newer = await run(
      Effect.flatMap(Conversations, (c) =>
        c.rewriteMessage({
          messageId: current.messageId,
          origin: 'improve',
          instruction: 'Be clear'
        })
      )
    );

    assert.notEqual(oldRequest.versionId, newer.versionId);
    const callsBeforeOld = calls;

    await assert.rejects(execute(oldEvent, 'superseded'));
    assert.equal(calls, callsBeforeOld);
    const newerEvent = decodeEvent(
      context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
    );

    assertEventType(newerEvent, 'ConversationGenerationRequested', 'wrong event');

    await run(
      Effect.flatMap(Conversations, (c) =>
        c.editMessage({ messageId: current.messageId, text: 'Manual edit' })
      )
    );
    await assert.rejects(execute(newerEvent, 'manual-edit'));
    assert.equal(calls, callsBeforeOld);
    output = 'A plain answer';
    const question = await post();
    const racing = await request();

    duringCall = async () => {
      await run(
        Effect.flatMap(Conversations, (c) =>
          c.editMessage({ messageId: question.id, text: 'Edited during call' })
        )
      );
    };
    await assert.rejects(execute(racing, 'race'));
    output = 'Fake [1]';
    const fake = await request();

    await assert.rejects(execute(fake, 'fake'));
    assert.match(bodies.at(-1)!, /Manual edit/);
    assert.match(bodies.at(-1)!, /"role":"assistant"/);
    assert.match(bodies.at(-1)!, /"role":"user"/);
    assert.equal(
      context.db.orm
        .select()
        .from(s.message_versions)
        .all()
        .find((v) => v.id === fake.versionId)?.status,
      undefined
    );
    const retryAfterInvalidOutput = await request();

    assert.notEqual(retryAfterInvalidOutput.requestId, fake.requestId);
    const groundedSession = await run(
      Effect.flatMap(Conversations, (c) =>
        c.createSession({ project: project.id, title: 'Grounded' })
      )
    );
    const source = context.db.orm
      .insert(s.sources)
      .values({
        project_id: project.id,
        origin: 'attachment',
        kind: 'text',
        mime: 'text/plain',
        name: 'notes',
        size_bytes: 1n,
        sha256: Buffer.alloc(32),
        created_at: 1n
      })
      .returning()
      .get();
    const meta = JSON.stringify({
      extractor: null,
      extractorVersion: 1,
      provider: null,
      durationMs: null,
      pageCount: null,
      refiners: [],
      waitingFor: [],
      corrected: false
    });
    const old = context.db.orm
      .insert(s.documents)
      .values({ source_id: source.id, extractor_version: 1n, meta, created_at: 1n })
      .returning()
      .get();

    context.db.orm
      .insert(s.blocks)
      .values({
        document_id: old.id,
        ordinal: 0n,
        kind: 'paragraph',
        text: 'alpha old evidence',
        anchor: JSON.stringify({ type: 'page', page: 1 })
      })
      .run();
    context.db.orm
      .insert(s.source_processing)
      .values({
        source_id: source.id,
        revision: 1n,
        request_id: 'old',
        published_request_id: 'old',
        document_id: old.id
      })
      .run();
    await run(
      Effect.flatMap(Conversations, (c) =>
        c.postMessage({ sessionId: groundedSession.id, text: 'Find alpha', sourceIds: [source.id] })
      )
    );
    await run(
      Effect.flatMap(Conversations, (c) => c.requestReply({ sessionId: groundedSession.id }))
    );
    const grounded = decodeEvent(
      context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
    );

    assertEventType(grounded, 'ConversationGenerationRequested', 'wrong event');

    const replacement = context.db.orm
      .insert(s.documents)
      .values({ source_id: source.id, extractor_version: 1n, meta, created_at: 2n })
      .returning()
      .get();

    context.db.orm
      .insert(s.blocks)
      .values({
        document_id: replacement.id,
        ordinal: 0n,
        kind: 'paragraph',
        text: 'alpha new evidence',
        anchor: JSON.stringify({ type: 'page', page: 2 })
      })
      .run();
    context.db.orm.run(
      sql`UPDATE source_processing SET document_id = ${replacement.id} WHERE source_id = ${source.id}`
    );
    toolCall = true;
    output = 'Grounded [1]';
    await execute(grounded, 'grounded');
    assert.match(bodies.at(-1)!, /alpha old evidence/);
    assert.doesNotMatch(bodies.at(-1)!, /alpha new evidence/);

    const toolRaceMessage = await run(
      Effect.flatMap(Conversations, (c) =>
        c.postMessage({ sessionId: groundedSession.id, text: 'One more alpha question' })
      )
    );

    await run(
      Effect.flatMap(Conversations, (c) => c.requestReply({ sessionId: groundedSession.id }))
    );
    const toolRace = decodeEvent(
      context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
    );

    assertEventType(toolRace, 'ConversationGenerationRequested', 'wrong event');

    const callsBeforeToolRace = calls;

    toolCall = true;
    duringToolCall = async () => {
      await run(
        Effect.flatMap(Conversations, (c) =>
          c.editMessage({ messageId: toolRaceMessage.id, text: 'Changed between model tool steps' })
        )
      );
    };
    await assert.rejects(execute(toolRace, 'tool-step-race'));
    assert.equal(
      calls,
      callsBeforeToolRace + 1,
      'a stale tool round trip must not start another provider call'
    );

    await run(
      Effect.flatMap(Conversations, (c) =>
        c.postMessage({ sessionId: groundedSession.id, text: 'Cancel this' })
      )
    );
    await run(
      Effect.flatMap(Conversations, (c) => c.requestReply({ sessionId: groundedSession.id }))
    );
    const cancelled = decodeEvent(
      context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
    );

    assertEventType(cancelled, 'ConversationGenerationRequested', 'wrong event');

    output = 'Cancelled answer';
    duringCall = async () => {
      await cancel!();
    };
    await assert.rejects(execute(cancelled, 'cancelled'));
    assert.notEqual(
      context.db.orm
        .select()
        .from(s.message_versions)
        .all()
        .find((v) => v.id === cancelled.versionId)?.status,
      'complete'
    );
    assert.equal(
      context.db.orm
        .select()
        .from(s.citations)
        .all()
        .find((c) => c.version_id === grounded.versionId)?.quote,
      'alpha old evidence'
    );
    await assertLongHistoryPreservesEarlyMessages();

    async function assertLongHistoryPreservesEarlyMessages() {
      const longSession = await run(
        Effect.flatMap(Conversations, (c) =>
          c.createSession({ project: project.id, title: 'Long' })
        )
      );
      const early = await run(
        Effect.flatMap(Conversations, (c) =>
          c.postMessage({ sessionId: longSession.id, text: 'Early message' })
        )
      );

      for (let i = 0; i < 55; i++) {
        await run(
          Effect.flatMap(Conversations, (c) =>
            c.postMessage({ sessionId: longSession.id, text: `Later ${i}` })
          )
        );
      }

      const earlyRewrite = await run(
        Effect.flatMap(Conversations, (c) =>
          c.rewriteMessage({ messageId: early.id, origin: 'improve' })
        )
      );
      const earlySnapshot = await run(
        Effect.flatMap(Conversations, (c) => c.replySnapshot({ requestId: earlyRewrite.requestId }))
      );

      assert.equal(earlySnapshot.messages.at(-1)?.text, 'Early message');
    }
  } finally {
    await auth.dispose();
    context.close();
    location.cleanup();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
  }
});

function assertEventType<T extends ReturnType<typeof decodeEvent>['type']>(
  event: ReturnType<typeof decodeEvent> | undefined,
  type: T,
  message: string
): asserts event is Extract<ReturnType<typeof decodeEvent>, { type: T }> {
  assert.ok(event && event.type === type, message);
}
