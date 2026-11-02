/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Supplies a controlled provider peer for native Document transformation tests.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Opens migrated SQLite and composes real feature services and Workflow control.         │
 * │ - Sends JSON tool calls, structured output and transient transport failures.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests control remote responses while production Activities, codecs and guards execute.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createServer } from 'node:http';

import type { documentTransformOutputSchema } from '@study/contracts/ai/document-transform';
import type { materialGenerationRequestedSchema } from '@study/contracts/events';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import {
  materialGenerationWorkflow,
  materialGenerationHandler
} from '#server/features/materials/workflows/generation';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { cancelExecution, WorkflowControl } from '#server/platform/workflows/control';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';

type Reply =
  | { kind: 'sources'; query: string }
  | { kind: 'output'; output: typeof documentTransformOutputSchema.Type }
  | { kind: 'transient' };

function responseEvents(reply: Exclude<Reply, { kind: 'transient' }>, ordinal: number) {
  if (reply.kind === 'sources') {
    const call = {
      type: 'function_call',
      id: `item${ordinal}`,
      call_id: `call${ordinal}`,
      name: 'sources',
      arguments: JSON.stringify({ query: reply.query })
    };

    return [
      { type: 'response.output_item.added', output_index: 0, item: call },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { ...call, status: 'completed' }
      },
      { type: 'response.completed', response: {} }
    ];
  }

  return [
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'message', id: `message${ordinal}` }
    },
    {
      type: 'response.output_text.delta',
      item_id: `message${ordinal}`,
      delta: JSON.stringify(reply.output)
    },
    { type: 'response.completed', response: {} }
  ];
}

export async function documentTransformFixture() {
  const cleanups: (() => void | Promise<void>)[] = [];
  let closing: Promise<void> | undefined;

  function close() {
    closing ??= disposeFixture(cleanups);

    return closing;
  }

  try {
    const location = createTestDatabase();

    cleanups.push(() => location.cleanup());
    const openContext = () => {
      const db = location.open();

      try {
        return new ServerContext(db);
      } catch (error) {
        db.close();

        throw error;
      }
    };
    let context = openContext();
    let contextOpen = true;
    const closeContext = () => {
      if (!contextOpen) return;

      contextOpen = false;
      context.close();
    };

    cleanups.push(closeContext);
    const bodies: string[] = [];
    const replies: Reply[] = [];
    let beforeResponse: (() => Promise<void>) | undefined;
    const peer = createServer(async (req, res) => {
      let body = '';

      for await (const chunk of req) body += chunk;

      bodies.push(body);
      const reply = replies.shift();

      const action = beforeResponse;

      beforeResponse = undefined;
      await action?.();

      if (!reply || reply.kind === 'transient') {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Controlled unavailable transport' } }));

        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream' });

      for (const event of responseEvents(reply, bodies.length))
        res.write(`data: ${JSON.stringify(event)}\n\n`);

      res.end('data: [DONE]\n\n');
    });

    cleanups.push(() => closePeer(peer));
    await new Promise<void>((resolve, reject) => {
      peer.once('error', reject);
      peer.listen(0, '127.0.0.1', () => {
        peer.off('error', reject);
        resolve();
      });
    });
    const address = peer.address();

    if (!address || typeof address === 'string') throw new Error('Missing provider address');

    const base = `http://127.0.0.1:${address.port}`;
    const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

    cleanups.push(() => auth.dispose());
    await auth.replace(
      { subject: 'fixture', clientId: 'fixture', sharing: true, refreshToken: 'fixture' },
      { accessToken: 'fixture', expiresIn: 3600 }
    );
    const model = createChatGptModel({ auth, modelId: 'fixture', baseUrl: base });
    const domain = () =>
      Layer.mergeAll(Materials.layer, Conversations.layer, Settings.layer, Sources.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const services = () => {
      const engine = workflowEngineLayer(context);
      const control = Layer.effect(
        WorkflowControl,
        Effect.map(WorkflowEngine.WorkflowEngine, (engine) => ({
          cancel: (input: Parameters<typeof cancelExecution>[2]) =>
            cancelExecution(context, [materialGenerationWorkflow], input).pipe(
              Effect.provideService(WorkflowEngine.WorkflowEngine, engine)
            )
        }))
      ).pipe(Layer.provideMerge(engine));

      return Layer.mergeAll(
        domain(),
        control,
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('fixture') }),
        agentsLayer({
          model: () => Effect.succeed(model),
          language: 'en',
          searchSources: () => Effect.die('Global retrieval is forbidden')
        })
      );
    };

    return {
      get context() {
        return context;
      },
      bodies,
      replies,
      domain,
      services,
      beforeResponse(action: () => Promise<void>) {
        beforeResponse = action;
      },
      beforeOutput(action: () => Promise<void>) {
        beforeResponse = async () => {
          beforeResponse = action;
        };
      },
      reopen() {
        closeContext();
        context = openContext();
        contextOpen = true;
      },
      event(requestId: string): typeof materialGenerationRequestedSchema.Type {
        const event = context.db.orm
          .select()
          .from(s.workflowEvents)
          .all()
          .map((row) => decodeEvent(row.payload))
          .findLast(
            (event) => event.type === 'MaterialGenerationRequested' && event.requestId === requestId
          );

        if (event?.type !== 'MaterialGenerationRequested') throw new Error('Missing request event');

        return event;
      },
      execute(event: typeof materialGenerationRequestedSchema.Type, executionId: string) {
        return Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const engine = yield* WorkflowEngine.WorkflowEngine;

              yield* engine.register(materialGenerationWorkflow, materialGenerationHandler);

              return yield* engine.execute(materialGenerationWorkflow, {
                executionId,
                payload: { event }
              });
            }).pipe(Effect.provide(services()))
          )
        );
      },
      close
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Fixture acquisition and cleanup failed');
    }

    throw error;
  }
}

/** Release every acquired resource even when another disposer fails. */
async function disposeFixture(cleanups: (() => void | Promise<void>)[]) {
  const errors: unknown[] = [];

  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length) throw new AggregateError(errors, 'Document fixture cleanup failed');
}

async function closePeer(peer: ReturnType<typeof createServer>) {
  if (!peer.listening) return;

  await new Promise<void>((resolve, reject) => {
    peer.close((error) => (error ? reject(error) : resolve()));
    peer.closeAllConnections();
  });
}
