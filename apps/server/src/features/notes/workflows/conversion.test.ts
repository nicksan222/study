import { sourceProcessingRequestedSchema, noteGenerationRequestedSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Tests durable text conversion and exact PDF attachment extraction reuse.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks model routing and checkpointed conversion publication.                          │
 * │ - Preserves attachment bytes and excludes unrelated note messages.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use real SQLite and workflow services with a controlled model transport.           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { defaultAgentRules } from '@study/contracts';
import { plainBlock } from '@study/contracts';
import { workflowEvents } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer, Schema } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { Notes } from '#server/features/notes/index';
import { Settings } from '#server/features/settings/index';
import { textConversionAgent } from '#server/features/sources/agents/text-conversion';
import { Sources } from '#server/features/sources/index';
import type { AgentsConfig } from '#server/platform/ai/agents';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { normalizeError } from '#server/platform/errors/classify-error';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';
import { withTestPublication } from '#testing/publication';
import { withTestAdmission } from '#testing/workflow-admission';

import { noteReplyHandler, noteReplyWorkflow } from './index.ts';

let context: ServerContext;

let auth: AuthManager;

test.server.beforeEach(async ({ databases }) => {
  const location = await databases();

  context = new ServerContext(await location.open());
  auth = new AuthManager({ issuer: 'http://test.invalid', saveRefresh: async () => {} });

  await auth.replace(
    { subject: 'test', clientId: 'test', sharing: true, refreshToken: 'test' },
    { accessToken: 'test', expiresIn: 3600 }
  );
});

test.server.afterEach(async () => {
  await auth.dispose();
  context.close();
});

function workflowServices(
  { expect }: Pick<test.server.Context, 'expect'>,
  model: AgentsConfig['model']
) {
  const domain = Layer.mergeAll(Notes.layer, Sources.layer, Settings.layer).pipe(
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
      model: (tier, call) => {
        expect(tier).toBe('tiny');

        return model(tier, call);
      }
    })
  );
}

test.server.stable(
  'conversion executes on the small tier, captures only its target and checkpoints publication',
  async ({ createAiMock, expect }) => {
    using mock = createAiMock();
    const conversion = mock.next(textConversionAgent, {
      input: { text: 'A complete\nparagraph.' },
      output: 'A complete paragraph.'
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const c = yield* Notes;
          const note = yield* c.createNote({ title: 'Conversion workflow' });
          const earlier = yield* c.postMessage({
            noteId: note.id,
            text: 'Unrelated earlier message',
            requestReply: false
          });

          yield* c.rewriteMessage({ messageId: earlier.id, origin: 'improve' });
          const noteMessage = yield* c.postMessage({
            noteId: note.id,
            text: 'A complete\nparagraph.',
            requestReply: false
          });
          const input = {
            messageId: noteMessage.id,
            expectedActiveVersionId: noteMessage.activeVersionId!,
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
                event.type === 'NoteGenerationRequested' && event.requestId === receipt.requestId
            );

          expect(events).toHaveLength(1);
          const event = Schema.decodeUnknownSync(noteGenerationRequestedSchema)(events[0]);
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(noteReplyWorkflow, noteReplyHandler);

          for (let attempt = 0; attempt < 2; attempt++)
            yield* withTestAdmission(
              context,
              noteReplyWorkflow,
              'conversion-test',
              { event },
              engine.execute(noteReplyWorkflow, {
                executionId: 'conversion-test',
                payload: { event }
              })
            );

          const completed = yield* c.message(noteMessage.id);

          expect(completed.activeVersionId).toBe(receipt.versionId);
          expect(completed.versions).toHaveLength(2);
          expect(completed.versions.at(-1)?.text).toBe('A complete paragraph.');
          expect((yield* Effect.promise(() => conversion.called)).input.text).toBe(
            'A complete\nparagraph.'
          );
          const sources = yield* Sources;
          const bytes = yield* Effect.promise(() =>
            Bun.file(
              new URL('../../sources/decoders/fixtures/two-pages.pdf', import.meta.url)
            ).bytes()
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
            noteId: note.id,
            text: '',
            sourceIds: [source.id],
            requestReply: false
          });
          const converted = yield* c.convertMessage({
            messageId: attachment.id,
            expectedActiveVersionId: attachment.activeVersionId!,
            strategyId: 'chatgpt'
          });
          const pdfEvent = Schema.decodeUnknownSync(noteGenerationRequestedSchema)(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .find(
                (event) =>
                  event.type === 'NoteGenerationRequested' &&
                  event.requestId === converted.requestId
              )
          );

          yield* withTestAdmission(
            context,
            noteReplyWorkflow,
            'pdf-conversion-test',
            { event: pdfEvent },
            engine.execute(noteReplyWorkflow, {
              executionId: 'pdf-conversion-test',
              payload: { event: pdfEvent }
            })
          );
          const pdf = yield* c.message(attachment.id);

          expect(pdf.parts).toEqual(attachment.parts);
          expect(pdf.versions.at(-1)?.text).toBe('First page\n\nSecond page');
          mock.verify();
          expect(
            (yield* sources.exportRevision({ sourceId: source.id, revision: 1n })).bytes
          ).toEqual(bytes);
          const threaded = yield* c.postMessage({
            noteId: note.id,
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
          const threadEvent = Schema.decodeUnknownSync(noteGenerationRequestedSchema)(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .find(
                (event) =>
                  event.type === 'NoteGenerationRequested' &&
                  event.requestId === threadReceipt.requestId
              )
          );

          yield* withTestAdmission(
            context,
            noteReplyWorkflow,
            'thread-pdf-conversion-test',
            { event: threadEvent },
            engine.execute(noteReplyWorkflow, {
              executionId: 'thread-pdf-conversion-test',
              payload: { event: threadEvent }
            })
          );
          expect((yield* c.message(threaded.id)).versions.at(-1)?.text).toBe(
            'First page\n\nSecond page'
          );
        }).pipe(
          Effect.provide(
            workflowServices({ expect }, (tier, call) =>
              mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError))
            )
          )
        )
      )
    );
  }
);

test.server.stable(
  'exhausted automatic conversions unblock replies and retry their captured input',
  async ({ expect }) => {
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
          const c = yield* Notes;
          const settings = yield* Settings;

          yield* settings.saveWorkspacePreferences({
            ...(yield* settings.workspacePreferences()),
            textConversionMode: 'automatic'
          });
          const note = yield* c.createNote({ title: 'Failed automatic conversion' });
          const noteMessage = yield* c.postMessage({
            noteId: note.id,
            text: 'Saved\ntext.',
            requestReply: false
          });
          const event = Schema.decodeUnknownSync(noteGenerationRequestedSchema)(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .find(
                (event) =>
                  event.type === 'NoteGenerationRequested' && event.messageId === noteMessage.id
              )
          );
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(noteReplyWorkflow, noteReplyHandler);
          const result = yield* Effect.result(
            withTestAdmission(
              context,
              noteReplyWorkflow,
              'failed-conversion-test',
              { event },
              engine.execute(noteReplyWorkflow, {
                executionId: 'failed-conversion-test',
                payload: { event }
              })
            )
          );

          expect(result._tag).toBe('Failure');
          expect(calls).toBe(4);
          const failed = yield* c.message(noteMessage.id);

          expect(failed.activeVersionId).toBe(noteMessage.activeVersionId);
          expect(failed.versions.at(-1)?.status).toBe('failed');
          expect(
            (yield* c.inspectReplySnapshot({ requestId: event.requestId })).messages[0].text
          ).toBe('Saved\ntext.');
          expect((yield* c.requestReply({ noteId: note.id })).requestId).toBeTruthy();
          available = true;
          const retry = yield* c.convertMessage({
            messageId: noteMessage.id,
            expectedActiveVersionId: noteMessage.activeVersionId!,
            strategyId: 'chatgpt'
          });
          const retryEvent = Schema.decodeUnknownSync(noteGenerationRequestedSchema)(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .find(
                (candidate) =>
                  candidate.type === 'NoteGenerationRequested' &&
                  candidate.requestId === retry.requestId &&
                  candidate.eventId !== event.eventId
              )
          );

          yield* withTestAdmission(
            context,
            noteReplyWorkflow,
            'retried-conversion-test',
            { event: retryEvent },
            engine.execute(noteReplyWorkflow, {
              executionId: 'retried-conversion-test',
              payload: { event: retryEvent }
            })
          );
          expect(calls).toBe(5);
          expect((yield* c.message(noteMessage.id)).versions.at(-1)).toMatchObject({
            id: event.versionId,
            status: 'complete',
            text: 'Saved text.'
          });
        }).pipe(Effect.provide(workflowServices({ expect }, () => Effect.succeed(model))))
      )
    );
  }
);
