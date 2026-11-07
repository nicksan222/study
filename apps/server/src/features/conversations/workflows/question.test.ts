/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises durable question classifier recovery and publication ownership fences.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks persisted event recovery and generation checkpoint replay.                      │
 * │ - Checks automatic answer opt out and obsolete version retirement.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use migrated SQLite and the real provider adapter against a local fixture          │
 * │ endpoint.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createServer } from 'node:http';

import { conversationQuestionRequestedSchema } from '@study/contracts/events';
import { defaultAgentRules } from '@study/contracts/settings/types';
import { workflowEvents } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import type { Context } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { Settings } from '#server/features/settings/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';
import { workflowDefinitions, workflowTriggers } from '#server/runtime/workflows';

import { conversationQuestionHandler, conversationQuestionWorkflow } from './question.ts';

testStable(
  'classifier resumes persisted events and checkpoints generation; opt-out and obsolete work are safe',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    let calls = 0;
    let during: (() => Promise<void>) | undefined;
    const peer = createServer(async (req, res) => {
      for await (const _ of req) {
      }

      calls++;
      await during?.();
      during = undefined;
      res.writeHead(200, { 'content-type': 'text/event-stream' });

      for (const event of [
        { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm' } },
        { type: 'response.output_text.delta', item_id: 'm', delta: '{"kind":"question"}' },
        { type: 'response.completed', response: {} }
      ])
        res.write(`data: ${JSON.stringify(event)}\n\n`);

      res.end();
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
      Layer.merge(Conversations.layer, Settings.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const services = () =>
      Layer.mergeAll(
        domain(),
        agentsLayer({
          model: (tier) => {
            expect(tier).toBe('tiny');

            return Effect.succeed(model);
          },
          language: 'english',
          rules: Effect.succeed(defaultAgentRules),
          searchSources: () => Effect.succeed([])
        }),
        workflowEngineLayer(context),
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') })
      );
    const run = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | Context.Service.Identifier<typeof Conversations>
        | Context.Service.Identifier<typeof Settings>
        | Database
      >
    ) => Effect.runPromise(effect.pipe(Effect.provide(domain())));
    const make = () =>
      run(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const session = yield* c.createSession({ title: 'Question' });

          return yield* c.postMessage({
            sessionId: session.id,
            text: 'Why do stars shine?',
            requestReply: false
          });
        })
      );
    const eventFor = (id: Awaited<ReturnType<typeof make>>['id']) =>
      context.db.orm
        .select()
        .from(workflowEvents)
        .all()
        .map((e) => decodeEvent(e.payload))
        .find((e) => e.type === 'ConversationQuestionRequested' && e.messageId === id);
    const execute = (raw: unknown, id: string) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const event = Schema.decodeUnknownSync(conversationQuestionRequestedSchema)(raw);
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(conversationQuestionWorkflow, conversationQuestionHandler);
            yield* engine.execute(conversationQuestionWorkflow, {
              executionId: id,
              payload: { event }
            });
          }).pipe(Effect.provide(services()))
        )
      );

    try {
      expect(workflowDefinitions.some((d) => d.name === conversationQuestionWorkflow.name)).toBe(
        true
      );
      expect(workflowTriggers.some((t) => t.event === 'ConversationQuestionRequested')).toBe(true);
      const note = await make();
      const persisted = eventFor(note.id);

      assert.ok(persisted);
      context.close();
      context = new ServerContext(location.open());
      await execute(eventFor(note.id), 'question-recovered');
      expect(calls).toBe(1);
      await execute(eventFor(note.id), 'question-recovered');
      expect(calls).toBe(1);
      const read = await run(Effect.flatMap(Conversations, (c) => c.message(note.id)));

      expect(read.question?.kind).toBe('question');
      expect(read.question?.answerMessageId).toBeUndefined();
      await run(
        Effect.flatMap(Settings, (s) =>
          Effect.flatMap(s.workspacePreferences(), (p) =>
            s.saveWorkspacePreferences({ ...p, autoAnswerQuestions: true })
          )
        )
      );
      const optout = await make();

      during = () =>
        run(
          Effect.flatMap(Settings, (s) =>
            Effect.flatMap(s.workspacePreferences(), (p) =>
              s.saveWorkspacePreferences({ ...p, autoAnswerQuestions: false })
            )
          )
        ).then(() => {});
      await execute(eventFor(optout.id), 'question-optout');
      expect(
        (await run(Effect.flatMap(Conversations, (c) => c.message(optout.id)))).question
          ?.answerMessageId
      ).toBeUndefined();
      const stale = await make();

      await run(
        Effect.flatMap(Conversations, (c) =>
          c.editMessage({
            messageId: stale.id,
            expectedActiveVersionId: stale.activeVersionId!,
            text: 'A later revision'
          })
        )
      );
      const before = calls;

      await execute(eventFor(stale.id), 'question-stale');
      expect(calls).toBe(before);
      await run(
        Effect.flatMap(Settings, (s) =>
          Effect.flatMap(s.workspacePreferences(), (p) =>
            s.saveWorkspacePreferences({ ...p, autoAnswerQuestions: true })
          )
        )
      );
      const manual = await make();

      await run(
        Effect.flatMap(Conversations, (c) =>
          c.setMessageKind({
            messageId: manual.id,
            expectedActiveVersionId: manual.activeVersionId!,
            kind: 'question'
          })
        )
      );
      const followup = context.db.orm
        .select()
        .from(workflowEvents)
        .all()
        .map((e) => decodeEvent(e.payload))
        .findLast((e) => e.type === 'ConversationQuestionRequested' && e.messageId === manual.id);

      assert.ok(followup);
      context.close();
      context = new ServerContext(location.open());
      const beforeManual = calls;

      await execute(followup, 'manual-question-recovered');
      expect(calls).toBe(beforeManual);
      const answered = await run(Effect.flatMap(Conversations, (c) => c.message(manual.id)));

      expect(answered.question?.answerMessageId).toBeDefined();
      await execute(followup, 'manual-question-recovered');
      expect(
        (await run(Effect.flatMap(Conversations, (c) => c.message(manual.id)))).question
          ?.answerMessageId
      ).toBe(answered.question?.answerMessageId);
    } finally {
      await auth.dispose();
      await new Promise<void>((resolve) => peer.close(() => resolve()));
      context.close();
      location.cleanup();
    }
  }
);
