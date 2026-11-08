/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies durable suggestions against real persistence and native RPC.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises combined evidence, checkpoint reuse, model selection and stale results.      │
 * │ - Checks note deletion scrubbing and authentication failures through live RPC.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use temporary SQLite databases and a local provider fixture; no external model is  │
 * │ called.                                                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createServer } from 'node:http';

import { StudyRpc } from '@study/contracts/rpc';
import { defaultAgentRules } from '@study/contracts/settings/types';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import type { Context } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { Notes } from '#server/features/notes/service/index';
import { suggestTransformField } from '#server/features/notes/service/transform-suggestion';
import { transformSuggestionWorkflow } from '#server/features/notes/service/transform-suggestion-definition';
import { Pages } from '#server/features/pages/index';
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
      Layer.mergeAll(Notes.layer, Settings.layer, Pages.layer).pipe(
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
          rules: Effect.succeed(defaultAgentRules),
          searchSources: () => Effect.succeed([])
        }),
        workflowEngineLayer(context)
      );
    const run = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | Database
        | Context.Service.Identifier<typeof Pages>
        | Context.Service.Identifier<typeof Notes>
        | Context.Service.Identifier<typeof Settings>
      >
    ) => Effect.runPromise(effect.pipe(Effect.provide(domain())));

    try {
      const first = await run(Effect.flatMap(Notes, (c) => c.createNote({ title: 'Cells' })));
      const second = await run(Effect.flatMap(Notes, (c) => c.createNote({ title: 'Plants' })));
      const source = await run(
        Effect.flatMap(Pages, (docs) =>
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
        Effect.flatMap(Pages, (docs) => docs.attach({ noteId: second.id, pageId: source.id }))
      );
      const message = await run(
        Effect.flatMap(Notes, (c) =>
          c.postMessage({ noteId: first.id, text: 'Mitosis produces two daughter cells.' })
        )
      );

      await run(
        Effect.flatMap(Notes, (c) =>
          c.postMessage({ noteId: second.id, text: 'Chloroplasts capture light.' })
        )
      );
      const execute = (
        field: 'title' | 'instruction',
        intentKey: string,
        noteId = first.id,
        additionalNoteIds = [second.id]
      ) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const engine = yield* WorkflowEngine.WorkflowEngine;

              yield* engine.register(transformSuggestionWorkflow, transformSuggestionHandler);

              return yield* suggestTransformField({
                noteId,
                additionalNoteIds,
                intentKey,
                field,
                language: 'italian'
              });
            }).pipe(Effect.provide(services()))
          )
        );
      const empty = await run(Effect.flatMap(Notes, (c) => c.createNote({ title: 'Empty' })));

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
        (await run(Effect.flatMap(Notes, (c) => c.note(first.id)))).title,
        'Cells'
      );
      output = 'Explain how cells divide and compare their structures.';
      assert.strictEqual(await execute('instruction', 'instruction-one'), output);
      assert.strictEqual(calls, 2);
      during = async () => {
        await run(
          Effect.flatMap(Notes, (c) =>
            c.editMessage({ messageId: message.id, text: 'The saved material changed.' })
          )
        );
      };
      await expect(execute('title', 'stale')).rejects.toMatchObject({ kind: 'invalid_input' });
      output = '🌱'.repeat(101);
      await expect(execute('title', 'too-long')).rejects.toMatchObject({ kind: 'transient' });
      const owned = context.db.orm.all<{ execution_id: string }>(sql`
        SELECT execution_id FROM workflow_executions WHERE workflow_tag = 'transform-suggestion/v1'
          AND json_extract(payload, '$.event.noteId') = ${String(first.id)}
      `);

      assert.strictEqual(owned.length, 4);
      const deletion = await run(Effect.flatMap(Notes, (c) => c.deleteNote(second.id)));

      await run(
        Effect.flatMap(Notes, (c) =>
          withTestPublication(
            context,
            c.finishNoteDeletion({ noteId: second.id, attempt: deletion.attempt })
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
            const note = yield* client['notes.createNote']({ title: 'Biology' });

            yield* client['notes.postMessage']({
              noteId: note.id,
              text: 'Cells divide.'
            });
            const error = yield* Effect.flip(
              client['notes.suggestTransformField']({
                noteId: note.id,
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
