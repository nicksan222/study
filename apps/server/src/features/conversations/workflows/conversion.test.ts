/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Tests durable text conversion and exact PDF attachment extraction reuse.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks model routing and checkpointed conversion publication.                          │
 * │ - Preserves attachment bytes and excludes unrelated conversation messages.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use real SQLite and workflow services with a controlled model transport.           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { readFileSync } from 'node:fs';

import {
  sourceProcessingRequestedSchema,
  conversationGenerationRequestedSchema
} from '@study/contracts/events';
import { defaultAgentRules } from '@study/contracts/settings/types';
import { plainBlock } from '@study/contracts/sources/document';
import { workflowEvents } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { afterEach, beforeEach, expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';
import { withTestPublication } from '#testing/publication';

import { conversationReplyHandler, conversationReplyWorkflow } from './index.ts';

let location: ReturnType<typeof createTestDatabase>;

let context: ServerContext;

let auth: AuthManager;

beforeEach(async () => {
  location = createTestDatabase();
  context = new ServerContext(location.open());
  auth = new AuthManager({ issuer: 'http://test.invalid', saveRefresh: async () => {} });

  await auth.replace(
    { subject: 'test', clientId: 'test', sharing: true, refreshToken: 'test' },
    { accessToken: 'test', expiresIn: 3600 }
  );
});

afterEach(async () => {
  await auth.dispose();
  context.close();
  location.cleanup();
});

function workflowServices(model: ReturnType<typeof createChatGptModel>) {
  const domain = Layer.mergeAll(Conversations.layer, Sources.layer, Settings.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  return Layer.mergeAll(
    domain,
    workflowEngineLayer(context),
    Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
    agentsLayer({
      language: 'english',
      rules: Effect.succeed(defaultAgentRules),
      searchSources: () => Effect.succeed([]),
      model: (tier) => {
        expect(tier).toBe('tiny');

        return Effect.succeed(model);
      }
    })
  );
}

testStable(
  'conversion executes on the small tier, captures only its target and checkpoints publication',
  async () => {
    const bodies: string[] = [];
    const model = createChatGptModel({
      auth,
      modelId: 'test',
      fetch: async (_url, init) => {
        bodies.push(await new Response(init?.body).text());
        const events = [
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'm' }
          },
          { type: 'response.output_text.delta', item_id: 'm', delta: 'A complete paragraph.' },
          { type: 'response.completed', response: {} }
        ];

        return new Response(
          events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
          { headers: { 'content-type': 'text/event-stream' } }
        );
      }
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const session = yield* c.createSession({ title: 'Conversion workflow' });
          const earlier = yield* c.postMessage({
            sessionId: session.id,
            text: 'Unrelated earlier message',
            requestReply: false
          });

          yield* c.rewriteMessage({ messageId: earlier.id, origin: 'improve' });
          const note = yield* c.postMessage({
            sessionId: session.id,
            text: 'A complete\nparagraph.',
            requestReply: false
          });
          const input = {
            messageId: note.id,
            expectedActiveVersionId: note.activeVersionId!,
            strategyId: 'chatgpt'
          };
          const receipt = yield* c.convertMessage(input);

          yield* c.convertMessage(input);
          const events = context.db.orm
            .select()
            .from(workflowEvents)
            .all()
            .map((row) => decodeEvent(row.payload))
            .filter(
              (event) =>
                event.type === 'ConversationGenerationRequested' &&
                event.requestId === receipt.requestId
            );

          expect(events).toHaveLength(1);
          const event = Schema.decodeUnknownSync(conversationGenerationRequestedSchema)(events[0]);
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(conversationReplyWorkflow, conversationReplyHandler);

          for (let attempt = 0; attempt < 2; attempt++)
            yield* engine.execute(conversationReplyWorkflow, {
              executionId: 'conversion-test',
              payload: { event }
            });

          const completed = yield* c.message(note.id);

          expect(completed.activeVersionId).toBe(receipt.versionId);
          expect(completed.versions).toHaveLength(2);
          expect(completed.versions.at(-1)?.text).toBe('A complete paragraph.');
          expect(bodies).toHaveLength(1);
          expect(bodies[0]).not.toContain('Unrelated earlier message');
          expect(bodies[0]).toContain('A complete\\nparagraph.');
          const sources = yield* Sources;
          const bytes = new Uint8Array(
            readFileSync(new URL('../../sources/decoders/fixtures/two-pages.pdf', import.meta.url))
          );
          const source = yield* sources.createSource({
            name: 'two-pages.pdf',
            bytes,
            projectId: null
          });
          const sourceEvent = Schema.decodeUnknownSync(sourceProcessingRequestedSchema)(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .find(
                (event) =>
                  event.type === 'SourceProcessingRequested' && event.sourceId === source.id
              )
          );

          yield* withTestPublication(
            context,
            sources
              .publishSourceDocument({
                event: sourceEvent,
                document: {
                  blocks: [
                    plainBlock('heading', 'First page', { type: 'page', page: 1 }),
                    plainBlock('paragraph', 'Second page', { type: 'page', page: 2 })
                  ],
                  meta: {
                    extractor: 'vision',
                    extractorVersion: 1,
                    provider: 'chatgpt',
                    durationMs: null,
                    pageCount: 2,
                    refiners: [],
                    waitingFor: [],
                    corrected: false,
                    omissions: []
                  }
                }
              })
              .pipe(Effect.asVoid)
          );
          const attachment = yield* c.postMessage({
            sessionId: session.id,
            text: '',
            sourceIds: [source.id],
            requestReply: false
          });
          const converted = yield* c.convertMessage({
            messageId: attachment.id,
            expectedActiveVersionId: attachment.activeVersionId!,
            strategyId: 'chatgpt'
          });
          const pdfEvent = Schema.decodeUnknownSync(conversationGenerationRequestedSchema)(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .find(
                (event) =>
                  event.type === 'ConversationGenerationRequested' &&
                  event.requestId === converted.requestId
              )
          );

          yield* engine.execute(conversationReplyWorkflow, {
            executionId: 'pdf-conversion-test',
            payload: { event: pdfEvent }
          });
          const pdf = yield* c.message(attachment.id);

          expect(pdf.parts).toEqual(attachment.parts);
          expect(pdf.versions.at(-1)?.text).toBe('First page\n\nSecond page');
          expect(bodies).toHaveLength(1);
          expect(
            (yield* sources.exportRevision({ sourceId: source.id, revision: 1n })).bytes
          ).toEqual(bytes);
          const threaded = yield* c.postMessage({
            sessionId: session.id,
            threadRoot: attachment.parts[0].id,
            text: '',
            sourceIds: [source.id],
            requestReply: false
          });
          const threadReceipt = yield* c.convertMessage({
            messageId: threaded.id,
            expectedActiveVersionId: threaded.activeVersionId!,
            strategyId: 'chatgpt'
          });
          const threadEvent = Schema.decodeUnknownSync(conversationGenerationRequestedSchema)(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .find(
                (event) =>
                  event.type === 'ConversationGenerationRequested' &&
                  event.requestId === threadReceipt.requestId
              )
          );

          yield* engine.execute(conversationReplyWorkflow, {
            executionId: 'thread-pdf-conversion-test',
            payload: { event: threadEvent }
          });
          expect((yield* c.message(threaded.id)).versions.at(-1)?.text).toBe(
            'First page\n\nSecond page'
          );
        }).pipe(Effect.provide(workflowServices(model)))
      )
    );
  }
);

testStable(
  'exhausted automatic conversions unblock replies and retry their captured input',
  async () => {
    let calls = 0;
    let available = false;
    const model = createChatGptModel({
      auth,
      modelId: 'test',
      fetch: async () => {
        calls++;

        if (!available) return new Response('Unavailable', { status: 503 });

        const events = [
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'm' }
          },
          { type: 'response.output_text.delta', item_id: 'm', delta: 'Saved text.' },
          { type: 'response.completed', response: {} }
        ];

        return new Response(
          events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
          {
            headers: { 'content-type': 'text/event-stream' }
          }
        );
      }
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const settings = yield* Settings;

          yield* settings.saveWorkspacePreferences({
            ...(yield* settings.workspacePreferences()),
            textConversionMode: 'automatic'
          });
          const session = yield* c.createSession({ title: 'Failed automatic conversion' });
          const note = yield* c.postMessage({
            sessionId: session.id,
            text: 'Saved\ntext.',
            requestReply: false
          });
          const event = Schema.decodeUnknownSync(conversationGenerationRequestedSchema)(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .find(
                (event) =>
                  event.type === 'ConversationGenerationRequested' && event.messageId === note.id
              )
          );
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(conversationReplyWorkflow, conversationReplyHandler);
          const result = yield* Effect.result(
            engine.execute(conversationReplyWorkflow, {
              executionId: 'failed-conversion-test',
              payload: { event }
            })
          );

          expect(result._tag).toBe('Failure');
          expect(calls).toBe(4);
          const failed = yield* c.message(note.id);

          expect(failed.activeVersionId).toBe(note.activeVersionId);
          expect(failed.versions.at(-1)?.status).toBe('failed');
          expect(
            (yield* c.inspectReplySnapshot({ requestId: event.requestId })).messages[0].text
          ).toBe('Saved\ntext.');
          expect((yield* c.requestReply({ sessionId: session.id })).requestId).toBeTruthy();
          available = true;
          const retry = yield* c.convertMessage({
            messageId: note.id,
            expectedActiveVersionId: note.activeVersionId!,
            strategyId: 'chatgpt'
          });
          const retryEvent = Schema.decodeUnknownSync(conversationGenerationRequestedSchema)(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .find(
                (candidate) =>
                  candidate.type === 'ConversationGenerationRequested' &&
                  candidate.requestId === retry.requestId &&
                  candidate.eventId !== event.eventId
              )
          );

          yield* engine.execute(conversationReplyWorkflow, {
            executionId: 'retried-conversion-test',
            payload: { event: retryEvent }
          });
          expect(calls).toBe(5);
          expect((yield* c.message(note.id)).versions.at(-1)).toMatchObject({
            id: event.versionId,
            status: 'complete',
            text: 'Saved text.'
          });
        }).pipe(Effect.provide(workflowServices(model)))
      )
    );
  }
);
