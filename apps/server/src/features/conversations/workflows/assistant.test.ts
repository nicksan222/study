/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises persisted Assistant conversations through the native workflow and        │
 * │ streaming provider.                                                                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies tool-free replies, idempotent sends and persisted history.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses real SQLite and a local provider peer without accessing external accounts.          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createServer } from 'node:http';

import { ConversationMode } from '@study/contracts/conversations/schemas';
import { defaultAgentRules } from '@study/contracts/settings/types';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
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

testStable(
  'Assistant uses durable tool-free replies, retains history across reopen and stays out of notebooks',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const bodies: string[] = [];
    const agents: string[] = [];
    const peer = createServer(async (request, response) => {
      let body = '';

      for await (const chunk of request) body += chunk;

      bodies.push(body);
      response.writeHead(200, { 'content-type': 'text/event-stream' });

      for (const event of [
        { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm' } },
        {
          type: 'response.output_text.delta',
          item_id: 'm',
          delta: 'Hello **learner**. Index array[0], then consider [1].'
        },
        { type: 'response.completed', response: {} }
      ])
        response.write(`data: ${JSON.stringify(event)}\n\n`);

      response.end();
    });

    await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
    const address = peer.address();

    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'a', expiresIn: 3600 }
    );
    const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
    const domain = () =>
      Layer.mergeAll(Conversations.layer, Sources.layer, Documents.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const execute = async (text: string, key: string) => {
      const asked = await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const input = { text, intentKey: key };
          const asked = yield* c.assistantAsk(input);

          expect(yield* c.assistantAsk(input)).toStrictEqual(asked);

          return asked;
        }).pipe(Effect.provide(domain()))
      );
      const event = decodeEvent(
        context.db.orm
          .select()
          .from(s.workflowEvents)
          .all()
          .findLast(
            (event) => decodeEvent(event.payload).type === 'ConversationGenerationRequested'
          )!.payload
      );

      assert.ok(event.type === 'ConversationGenerationRequested');
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(conversationReplyWorkflow, conversationReplyHandler);

            return yield* engine.execute(conversationReplyWorkflow, {
              executionId: key,
              payload: { event }
            });
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                domain(),
                workflowEngineLayer(context),
                Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
                agentsLayer({
                  model: () => Effect.succeed(model),
                  language: 'en',
                  rules: Effect.succeed({
                    ...defaultAgentRules,
                    replies: 'Use concrete examples.'
                  }),
                  searchSources: () => Effect.die('Assistant must not call tools'),
                  observe: (event) =>
                    Effect.sync(() => {
                      agents.push(event.agentId);
                    })
                })
              )
            )
          )
        )
      );

      return asked;
    };

    try {
      const session = await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const assistant = yield* c.assistantSession();

          expect(yield* c.assistantSession()).toStrictEqual(assistant);
          expect(yield* c.sessionMode(assistant.id)).toBe(ConversationMode.Assistant);
          expect((yield* c.sessions({ limit: 10 })).items).toHaveLength(0);

          return assistant;
        }).pipe(Effect.provide(domain()))
      );

      await execute('Explain gravity.', 'assistant-first');
      await execute('What did I ask?', 'assistant-second');
      expect(new Set(agents)).toStrictEqual(new Set(['assistant']));

      for (const body of bodies) {
        expect(JSON.parse(body).tools ?? []).toHaveLength(0);
        expect(body).toContain('Use concrete examples.');
        expect(body).toContain('You have no tools');
      }

      expect(bodies[1]).toContain('Explain gravity.');
      expect(bodies[1]).toContain('Hello **learner**. Index array[0], then consider [1].');
      expect(bodies[1]).toContain('What did I ask?');
      expect(
        context.db.orm
          .select()
          .from(s.workflowEvents)
          .all()
          .some((event) => decodeEvent(event.payload).type === 'ConversationQuestionRequested')
      ).toBe(false);
      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;

          expect((yield* c.assistantSession()).id).toBe(session.id);
          expect((yield* c.thread({ sessionId: session.id, limit: 30 })).items).toHaveLength(4);
        }).pipe(Effect.provide(domain()))
      );
    } finally {
      await auth.dispose();
      await new Promise<void>((resolve) => peer.close(() => resolve()));
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'Assistant can send a new turn after a cancelled reply without an unfinished shell',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const domain = Layer.mergeAll(Conversations.layer, Sources.layer, Documents.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const first = yield* c.assistantAsk({
            text: 'First question.',
            intentKey: 'cancel-first'
          });
          const event = context.db.orm
            .select()
            .from(s.workflowEvents)
            .all()
            .findLast((row) => decodeEvent(row.payload).type === 'ConversationGenerationRequested');

          assert.ok(event);
          context.db.orm
            .insert(s.workflow_executions)
            .values({
              execution_id: 'cancelled-assistant',
              workflow_tag: 'conversation-reply/v1',
              version: 1,
              payload: JSON.stringify({ event: JSON.parse(event.payload) }),
              status: 'cancelled',
              created_at: 1n,
              updated_at: 1n
            })
            .run();
          const second = yield* c.assistantAsk({
            text: 'Continue with another question.',
            intentKey: 'cancel-second'
          });

          expect(second.messageId).not.toBe(first.messageId);
          const history = (yield* c.thread({ sessionId: first.sessionId, limit: 30 })).items;

          expect(history.some((message) => message.id === first.messageId)).toBe(false);
          expect(history).toHaveLength(3);
        }).pipe(Effect.provide(domain))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable('Assistant bounds model context while retaining older persisted messages', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const domain = Layer.mergeAll(Conversations.layer, Sources.layer, Documents.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Conversations;
        const session = yield* c.assistantSession();

        for (const text of ['a', 'b', 'c'])
          yield* c.postMessage({
            sessionId: session.id,
            text: text.repeat(90000),
            requestReply: false
          });

        const reply = yield* c.assistantAsk({
          text: 'What are we discussing?',
          intentKey: 'bounded-history'
        });
        const snapshot = yield* c.replySnapshot({ requestId: reply.requestId });

        expect(
          snapshot.messages.reduce((size, message) => size + message.text.length, 0)
        ).toBeLessThanOrEqual(200000);
        expect(snapshot.messages.at(-1)?.text).toBe('What are we discussing?');
        expect((yield* c.thread({ sessionId: session.id, limit: 30 })).items).toHaveLength(5);
      }).pipe(Effect.provide(domain))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
