/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises persisted Assistant notes through the native workflow and                │
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

import type { MessageId, NoteId, VersionId } from '@study/contracts/ids';
import { NoteMode } from '@study/contracts/notes/schemas';
import { defaultAgentRules } from '@study/contracts/settings/types';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import { settingsTools } from '#server/features/notes/tools/settings';
import { subjectTools } from '#server/features/notes/tools/subjects';
import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';

import { noteReplyHandler, noteReplyWorkflow } from './index.ts';

function scriptedCall(
  tools: { name: string }[],
  step: number,
  fail: boolean,
  edit?: { messageId: MessageId; versionId: VersionId }
) {
  if (tools.some((tool) => tool.name === 'read_note_context'))
    return [
      { name: 'read_note_context', arguments: '{}' },
      {
        name: 'edit_note_message',
        arguments: JSON.stringify({
          messageId: String(edit?.messageId),
          expectedActiveVersionId: String(edit?.versionId),
          text: 'Improved by the note assistant'
        })
      }
    ][step];

  if (!tools.some((tool) => tool.name === 'create_subject')) return undefined;

  if (fail) return { name: 'read_subject', arguments: '{"id":"999999999999"}' };

  return [
    { name: 'create_subject', arguments: '{"name":"Biology"}' },
    { name: 'read_subject', arguments: '{"id":"1"}' },
    { name: 'update_review_settings', arguments: '{"newCardsPerDay":12}' }
  ][step];
}

testStable(
  'Assistant uses durable capability-guided replies, retains history across reopen and stays out of notebooks',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const bodies: string[] = [];
    const agents: string[] = [];
    let failTool = false;
    let scopedEdit: { messageId: MessageId; versionId: VersionId } | undefined;
    const peer = createServer(async (request, response) => {
      let body = '';

      for await (const chunk of request) body += chunk;

      bodies.push(body);
      response.writeHead(200, { 'content-type': 'text/event-stream' });

      const requestBody = JSON.parse(body);
      const toolStep = (requestBody.input ?? []).filter(
        (item: { type: string }) => item.type === 'function_call_output'
      ).length;

      const callStep = scriptedCall(requestBody.tools ?? [], toolStep, failTool, scopedEdit);

      if (callStep) {
        const call = {
          type: 'function_call',
          id: `item${toolStep}`,
          call_id: `call${toolStep}`,
          ...callStep
        };

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
      Layer.mergeAll(Notes.layer, Sources.layer, Pages.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const execute = async (
      text: string,
      key: string,
      retryMessageId?: MessageId,
      chatId?: NoteId
    ) => {
      const asked = await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Notes;
          const input = { text, intentKey: key, noteId: chatId };
          const asked = yield* retryMessageId === undefined
            ? c.assistantAsk(input)
            : c.reanswer({ messageId: retryMessageId });

          if (retryMessageId === undefined)
            expect(yield* c.assistantAsk(input)).toStrictEqual(asked);

          return asked;
        }).pipe(Effect.provide(domain()))
      );
      const event = decodeEvent(
        context.db.orm
          .select()
          .from(s.workflowEvents)
          .all()
          .findLast((event) => decodeEvent(event.payload).type === 'NoteGenerationRequested')!
          .payload
      );

      assert.ok(event.type === 'NoteGenerationRequested');
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(noteReplyWorkflow, noteReplyHandler);

            return yield* engine.execute(noteReplyWorkflow, {
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
      const note = await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Notes;
          const assistant = yield* c.assistantNote();

          expect(yield* c.assistantNote()).toStrictEqual(assistant);
          expect(yield* c.noteMode(assistant.id)).toBe(NoteMode.Assistant);
          expect((yield* c.notes({ limit: 10 })).items).toHaveLength(0);

          return assistant;
        }).pipe(Effect.provide(domain()))
      );

      const firstReply = await execute('Explain gravity.', 'assistant-first');

      await execute('What did I ask?', 'assistant-second');
      expect(new Set(agents)).toStrictEqual(new Set(['assistant']));

      for (const body of bodies) {
        expect(JSON.parse(body).tools ?? []).toHaveLength(43);

        for (const tool of JSON.parse(body).tools) expect(tool.parameters.type).toBe('object');

        expect(body).toContain('Use concrete examples.');
        expect(body).toContain('Available capabilities');
        expect(body).toContain('create_subject');
      }

      const environment = { language: 'en', searchSources: () => Effect.succeed([]) };

      await Effect.runPromise(
        Effect.gen(function* () {
          expect(
            (yield* subjectTools.list_subjects.execute({ limit: 100 }, environment)).items.map(
              (subject) => subject.name
            )
          ).toStrictEqual(['Biology']);
          expect(
            (yield* settingsTools.read_settings.execute({}, environment)).review.newCardsPerDay
          ).toBe(12);
        }).pipe(Effect.provideService(Database, { store: context }))
      );
      expect(bodies[2]).toContain('function_call_output');
      expect(bodies.at(-1)).toContain('Explain gravity.');
      expect(bodies.at(-1)).toContain('Hello **learner**. Index array[0], then consider [1].');
      expect(bodies.at(-1)).toContain('What did I ask?');
      expect(
        context.db.orm
          .select()
          .from(s.workflowEvents)
          .all()
          .some((event) => decodeEvent(event.payload).type === 'NoteQuestionRequested')
      ).toBe(false);
      await Effect.runPromise(
        settingsTools.update_review_settings
          .execute({ newCardsPerDay: 20 }, environment)
          .pipe(Effect.provideService(Database, { store: context }))
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const subjects = yield* subjectTools.list_subjects.execute({ limit: 100 }, environment);

          yield* subjectTools.rename_subject.execute(
            { id: subjects.items[0]!.id, name: 'Updated biology' },
            environment
          );
        }).pipe(Effect.provideService(Database, { store: context }))
      );
      await execute('unused', 'assistant-retried', firstReply.messageId);
      expect(context.db.orm.select().from(s.assistant_tool_receipts).all()).toHaveLength(4);
      expect(bodies.at(-1)).toContain('Updated biology');
      await Effect.runPromise(
        Effect.gen(function* () {
          expect(
            (yield* settingsTools.read_settings.execute({}, environment)).review.newCardsPerDay
          ).toBe(20);
        }).pipe(Effect.provideService(Database, { store: context }))
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Notes;

          for (const text of ['a'.repeat(90000), 'b'.repeat(70000), 'c'.repeat(60000)])
            yield* c.postMessage({ noteId: note.id, text, requestReply: false });
        }).pipe(Effect.provide(domain()))
      );
      const compactedReply = await execute('Continue after compaction.', 'assistant-compacted');

      expect(agents).toContain('assistant-compaction');
      expect(bodies.some((body) => body.includes('a'.repeat(90000)))).toBe(true);
      expect(bodies.at(-1)).toContain('Summary of earlier note');
      expect(bodies.at(-1)).not.toContain('a'.repeat(90000));
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Notes;

          expect((yield* c.assistantContext({ noteId: note.id })).estimatedTokens).toBeLessThan(
            21000
          );
          expect(yield* c.assistantMemory(note.id)).not.toBeNull();
        }).pipe(Effect.provide(domain()))
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Notes;

          for (const text of ['d'.repeat(90000), 'e'.repeat(70000)])
            yield* c.postMessage({ noteId: note.id, text, requestReply: false });
        }).pipe(Effect.provide(domain()))
      );
      await execute('A later question.', 'assistant-later-compaction');
      const compactedRuns = agents.filter((id) => id === 'assistant-compaction').length;

      await execute('unused', 'assistant-retrospective', compactedReply.messageId);
      expect(agents.filter((id) => id === 'assistant-compaction')).toHaveLength(compactedRuns);
      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Notes;

          expect((yield* c.assistantNote()).id).toBe(note.id);
          expect((yield* c.thread({ noteId: note.id, limit: 30 })).items).toHaveLength(13);
        }).pipe(Effect.provide(domain()))
      );
      failTool = true;
      await expect(
        execute('Read the missing subject.', 'assistant-missing-subject')
      ).rejects.toBeDefined();
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Notes;
          const history = (yield* c.thread({ noteId: note.id, limit: 30 })).items;
          const failed = history.at(-1)!;

          expect(failed.role).toBe('assistant');
          expect(
            failed.versions.find((version) => version.id === failed.activeVersionId)?.status
          ).toBe('pending');
        }).pipe(Effect.provide(domain()))
      );
      const scoped = await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Notes;
          const notebook = yield* c.createNote({ title: 'Scoped workflow notebook' });
          const unrelated = yield* c.createNote({ title: 'PRIVATE_OTHER_NOTEBOOK' });

          yield* c.postMessage({ noteId: unrelated.id, text: 'PRIVATE_OTHER_NOTE' });
          const note = yield* c.postMessage({
            noteId: notebook.id,
            text: 'SESSION_SCOPE_ORIGINAL_NOTE'
          });
          const chat = yield* c.noteAssistant({ noteId: notebook.id });

          return { notebook, note, chat };
        }).pipe(Effect.provide(domain()))
      );

      scopedEdit = { messageId: scoped.note.id, versionId: scoped.note.activeVersionId! };
      await execute(
        'Read my note and improve the note.',
        'note-assistant-edit',
        undefined,
        scoped.chat.id
      );
      expect(agents).toContain('note-assistant');
      const scopedRequest = bodies.at(-1)!;

      for (const tool of JSON.parse(scopedRequest).tools)
        expect(tool.parameters.type).toBe('object');

      const capabilities = JSON.parse(scopedRequest).tools.map(
        (tool: { name: string }) => tool.name
      );

      expect(capabilities).toHaveLength(8);
      expect(capabilities).toContain('edit_note_message');
      expect(capabilities).not.toContain('read_settings');
      expect(capabilities).not.toContain('list_notes');
      expect(scopedRequest).toContain('SESSION_SCOPE_ORIGINAL_NOTE');
      expect(scopedRequest).not.toContain('PRIVATE_OTHER_NOTE');
      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Notes;
          const edited = yield* c.message(scoped.note.id);

          expect(
            edited.versions.find((version) => version.id === edited.activeVersionId)?.text
          ).toBe('Improved by the note assistant');
          expect(
            edited.versions.some((version) => version.text === 'SESSION_SCOPE_ORIGINAL_NOTE')
          ).toBe(true);
          expect((yield* c.noteAssistant({ noteId: scoped.notebook.id })).id).toBe(scoped.chat.id);
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
    const domain = Layer.mergeAll(Notes.layer, Sources.layer, Pages.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Notes;
          const first = yield* c.assistantAsk({
            text: 'First question.',
            intentKey: 'cancel-first'
          });
          const event = context.db.orm
            .select()
            .from(s.workflowEvents)
            .all()
            .findLast((row) => decodeEvent(row.payload).type === 'NoteGenerationRequested');

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
          const history = (yield* c.thread({ noteId: first.noteId, limit: 30 })).items;

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
  const domain = Layer.mergeAll(Notes.layer, Sources.layer, Pages.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Notes;
        const note = yield* c.assistantNote();

        for (const text of ['a', 'b', 'c'])
          yield* c.postMessage({
            noteId: note.id,
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
        expect((yield* c.thread({ noteId: note.id, limit: 30 })).items).toHaveLength(5);
      }).pipe(Effect.provide(domain))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable('Assistant chats retain separate histories and replay new-chat intents', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const domain = Notes.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Notes;
        const first = yield* c.assistantNote();
        const second = yield* c.newAssistantNote({ key: 'new-chat' });

        expect(second.id).not.toBe(first.id);
        expect(yield* c.newAssistantNote({ key: 'new-chat' })).toStrictEqual(second);
        expect((yield* c.assistantNote()).id).toBe(second.id);
        yield* c.assistantAsk({
          noteId: first.id,
          text: 'First chat only',
          intentKey: 'first-only'
        });
        yield* c.assistantAsk({
          noteId: second.id,
          text: 'Second chat only',
          intentKey: 'second-only'
        });
        expect((yield* c.thread({ noteId: first.id, limit: 30 })).items[0]?.versions[0]?.text).toBe(
          'First chat only'
        );
        expect(
          (yield* c.thread({ noteId: second.id, limit: 30 })).items[0]?.versions[0]?.text
        ).toBe('Second chat only');
        const page = yield* c.assistantChats({ limit: 1 });

        expect(page.items[0]?.id).toBe(second.id);
        expect((yield* c.assistantChats({ limit: 1, before: page.next! })).items[0]?.id).toBe(
          first.id
        );
        expect((yield* c.notes({ limit: 100 })).items).toHaveLength(0);
      }).pipe(Effect.provide(domain))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable(
  'Assistant retries an unfinished first reply while retaining its message identity',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Notes;
          const first = yield* c.assistantAsk({
            text: 'Retry this question',
            intentKey: 'retry-question'
          });
          const retried = yield* c.reanswer({ messageId: first.messageId });

          expect(retried.messageId).toBe(first.messageId);
          expect(retried.requestId).not.toBe(first.requestId);
          expect((yield* c.thread({ noteId: first.noteId, limit: 30 })).items).toHaveLength(2);
        }).pipe(Effect.provide(Notes.layer), Effect.provideService(Database, { store: context }))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
