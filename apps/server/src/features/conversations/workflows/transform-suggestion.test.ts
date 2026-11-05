import { createServer } from 'node:http';

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import type { Context } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { Conversations } from '#server/features/conversations/service/index';
import { Documents } from '#server/features/documents/index';
import { Settings } from '#server/features/settings/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { dispatchPending } from '#server/platform/workflows/triggers';
import { App, serve } from '#server/runtime/index';
import { deletionDocument } from '#testing/material-deletion';
import { withTestPublication } from '#testing/publication';

import { suggestTransformField } from '../service/transform-suggestion.ts';
import { transformSuggestionWorkflow } from './transform-suggestion-definition.ts';
import {
  transformSuggestionHandler,
  transformSuggestionRegistration
} from './transform-suggestion.ts';

testStable(
  'transform suggestions use saved combined context, tiny models, checkpoint results and reject changed evidence',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    let calls = 0;
    const tiers: string[] = [];
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
      Layer.mergeAll(Conversations.layer, Settings.layer, Documents.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const services = () =>
      Layer.mergeAll(
        domain(),
        Layer.succeed(Database, { store: context }),
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
        agentsLayer({
          model: (tier) => {
            tiers.push(tier);
            return Effect.succeed(model);
          },
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
        | Context.Service.Identifier<typeof Documents>
        | Context.Service.Identifier<typeof Conversations>
        | Context.Service.Identifier<typeof Settings>
      >
    ) => Effect.runPromise(effect.pipe(Effect.provide(domain())));

    try {
      const first = await run(
        Effect.flatMap(Conversations, (c) => c.createSession({ title: 'Cells' }))
      );
      const second = await run(
        Effect.flatMap(Conversations, (c) => c.createSession({ title: 'Plants' }))
      );
      const source = await run(
        Effect.flatMap(Documents, (docs) =>
          docs.create({
            title: 'Cell reference',
            inputs: [],
            citations: [],
            createKey: crypto.randomUUID(),
            document: deletionDocument('Chromosomes carry genetic information.')
          })
        )
      );
      await run(
        Effect.flatMap(Documents, (docs) =>
          docs.attach({ sessionId: second.id, documentId: source.id })
        )
      );
      const message = await run(
        Effect.flatMap(Conversations, (c) =>
          c.postMessage({ sessionId: first.id, text: 'Mitosis produces two daughter cells.' })
        )
      );
      await run(
        Effect.flatMap(Conversations, (c) =>
          c.postMessage({ sessionId: second.id, text: 'Chloroplasts capture light.' })
        )
      );
      const execute = (
        field: 'title' | 'instruction',
        intentKey: string,
        sessionId = first.id,
        additionalSessionIds = [second.id]
      ) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const engine = yield* WorkflowEngine.WorkflowEngine;
              yield* engine.register(transformSuggestionWorkflow, transformSuggestionHandler);
              return yield* suggestTransformField({
                sessionId,
                additionalSessionIds,
                intentKey,
                field,
                language: 'italian'
              });
            }).pipe(Effect.provide(services()))
          )
        );
      const empty = await run(
        Effect.flatMap(Conversations, (c) => c.createSession({ title: 'Empty' }))
      );
      await expect(execute('title', 'empty', empty.id, [])).rejects.toMatchObject({
        kind: 'invalid_input'
      });
      assert.strictEqual(calls, 0);
      assert.strictEqual(await execute('title', 'title-one'), 'Cell Biology');
      assert.strictEqual(
        dispatchPending(context, transformSuggestionRegistration.triggers, Date.now()),
        1
      );
      assert.strictEqual(await execute('title', 'title-one'), 'Cell Biology');
      assert.strictEqual(calls, 1);
      assert.deepEqual(tiers, ['tiny']);
      assert.ok(bodies[0]!.includes('Mitosis produces two daughter cells.'));
      assert.ok(bodies[0]!.includes('Chloroplasts capture light.'));
      assert.ok(bodies[0]!.includes('Italian'));
      assert.ok(bodies[0]!.includes('Chromosomes carry genetic information.'));
      assert.strictEqual(
        (await run(Effect.flatMap(Conversations, (c) => c.session(first.id)))).title,
        'Cells'
      );
      output = 'Explain how cells divide and compare their structures.';
      assert.strictEqual(await execute('instruction', 'instruction-one'), output);
      assert.strictEqual(calls, 2);
      during = async () => {
        await run(
          Effect.flatMap(Conversations, (c) =>
            c.editMessage({ messageId: message.id, text: 'The saved material changed.' })
          )
        );
      };
      await expect(execute('title', 'stale')).rejects.toMatchObject({ kind: 'invalid_input' });
      output = '🌱'.repeat(101);
      await expect(execute('title', 'too-long')).rejects.toMatchObject({ kind: 'invalid_input' });
      const owned = context.db.orm.all<{ execution_id: string }>(sql`
        SELECT execution_id FROM workflow_executions WHERE workflow_tag = 'transform-suggestion/v1'
          AND json_extract(payload, '$.event.sessionId') = ${String(first.id)}
      `);
      assert.strictEqual(owned.length, 4);
      const deletion = await run(Effect.flatMap(Conversations, (c) => c.deleteSession(second.id)));
      await run(
        Effect.flatMap(Conversations, (c) =>
          withTestPublication(
            context,
            c.finishSessionDeletion({ sessionId: second.id, attempt: deletion.attempt })
          )
        )
      );
      for (const row of owned) {
        const retained = context.db.orm.get<{ result: string | null }>(sql`
          SELECT result FROM workflow_executions WHERE execution_id = ${row.execution_id}
        `);
        assert.ok(retained);
        assert.strictEqual(retained.result, null);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        peer.close((error) => (error ? reject(error) : resolve()))
      );
      await auth.dispose();
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'live suggestion RPC uses the worker engine and returns sign-in errors without hanging',
  async () => {
    const location = createTestDatabase();
    const app = await App.open({ path: location.path });
    const server = await serve(app);
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const session = yield* client['conversations.createSession']({ title: 'Biology' });
            yield* client['conversations.postMessage']({
              sessionId: session.id,
              text: 'Cells divide.'
            });
            const error = yield* Effect.flip(
              client['conversations.suggestTransformField']({
                sessionId: session.id,
                intentKey: crypto.randomUUID(),
                field: 'title',
                language: 'english'
              })
            );
            assert.ok('kind' in error);
            assert.strictEqual(error.kind, 'auth');
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      location.cleanup();
    }
  }
);
