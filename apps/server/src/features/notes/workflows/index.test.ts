/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks reply workflow checkpointing and rejects stale note context or              │
 * │ citations that were not present in captured evidence.                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Provides controlled agent and database layers to test checkpoint and citation fences.  │
 * │ - Asserts durable effects against persisted state and replay behavior.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite drives the native workflow engine with persisted test state; it does not       │
 * │ replace production activities.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { messageVersionSchema } from '@study/contracts/notes/schemas';
import { defaultAgentRules } from '@study/contracts/settings/types';
import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import { createBlock } from '@study/contracts/sources/document';
import { blockIdSchema } from '@study/contracts/sources/schemas';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { Effect, Layer } from 'effect';
import type { Context } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { Notes } from '#server/features/notes/service/index';
import { Pages } from '#server/features/pages/index';
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

import { noteReplyHandler, noteReplyWorkflow } from './index.ts';

testStable(
  'reply checkpoints plain output and fences stale context and fabricated citations',
  async () => {
    const location = await createTestDatabase();
    let context = new ServerContext(await location.open());
    let calls = 0;
    let output = 'A plain answer';
    let cancel: (() => Promise<void>) | undefined;
    let toolCall = false;
    const bodies: string[] = [];
    let duringCall: (() => Promise<void>) | undefined;
    let duringModelResolution: (() => Promise<void>) | undefined;
    let duringLanguageResolution: (() => Promise<void>) | undefined;
    let duringToolCall: (() => Promise<void>) | undefined;
    const peer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => {
        let events = '';
        const body = await request.text();

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

          for (const event of [
            { type: 'response.output_item.added', output_index: 0, item: call },
            {
              type: 'response.output_item.done',
              output_index: 0,
              item: { ...call, status: 'completed' }
            },
            { type: 'response.completed', response: {} }
          ])
            events += `data: ${JSON.stringify(event)}\n\n`;

          return new Response(events, { headers: { 'content-type': 'text/event-stream' } });
        }

        if (duringCall) {
          const action = duringCall;

          duringCall = undefined;
          await action();
        }

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
          events += `data: ${JSON.stringify(event)}\n\n`;

        return new Response(events + 'data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' }
        });
      }
    });

    assert.ok(peer.port, 'missing address');
    const base = peer.url.origin;
    const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'token', expiresIn: 3600 }
    );
    const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
    const domain = () =>
      Layer.mergeAll(Notes.layer, Sources.layer, Pages.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const services = () =>
      Layer.mergeAll(
        domain(),
        Layer.succeed(Database, { store: context }),
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
        agentsLayer({
          rules: Effect.succeed(defaultAgentRules),
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
      effect: Effect.Effect<
        A,
        E,
        | Database
        | Context.Service.Identifier<typeof Notes>
        | Context.Service.Identifier<typeof Pages>
      >
    ) => Effect.runPromise(effect.pipe(Effect.provide(domain())));

    try {
      const project = context.db.orm
        .insert(s.projects)
        .values({ name: 'P', created_at: 1n, updated_at: 1n })
        .returning()
        .get();
      const note = await run(
        Effect.flatMap(Notes, (c) => c.createNote({ project: project.id, title: 'Chat' }))
      );
      const post = () =>
        run(Effect.flatMap(Notes, (c) => c.postMessage({ noteId: note.id, text: 'Question' })));
      const request = async (detail?: 'brief' | 'balanced' | 'detailed') => {
        await run(
          Effect.flatMap(Notes, (c) => c.requestReply({ noteId: note.id, preferences: { detail } }))
        );
        const event = decodeEvent(
          context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
        );

        assertEventType(event, 'NoteGenerationRequested', 'wrong event');

        return event;
      };
      const execute = (event: Awaited<ReturnType<typeof request>>, id: string) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const engine = yield* WorkflowEngine.WorkflowEngine;

              cancel = () => Effect.runPromise(engine.interruptUnsafe(noteReplyWorkflow, id));
              yield* engine.register(noteReplyWorkflow, noteReplyHandler);

              return yield* engine.execute(noteReplyWorkflow, {
                executionId: id,
                payload: { event }
              });
            }).pipe(Effect.provide(services()))
          )
        );

      await Effect.runPromise(
        Effect.flatMap(Settings, (settings) =>
          settings.saveWorkspacePreferences({
            ...defaultWorkspacePreferences,
            defaultAiDetail: 'detailed'
          })
        ).pipe(Effect.provide(Settings.layer), Effect.provideService(Database, { store: context }))
      );
      const first = await post();
      const stale = await request();

      await run(Effect.flatMap(Notes, (c) => c.deleteMessage(stale.messageId)));
      await expect(execute(stale, 'stale')).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, 0);
      const resolverRace = await request();

      duringModelResolution = async () => {
        await run(Effect.flatMap(Notes, (c) => c.deleteMessage(resolverRace.messageId)));
      };
      await expect(execute(resolverRace, 'model-resolution-race')).rejects.toSatisfy(() => true);
      assert.strictEqual(
        calls,
        0,
        'stale context must not reach the provider after model resolution'
      );
      const languageRace = await request();

      duringLanguageResolution = async () => {
        await run(Effect.flatMap(Notes, (c) => c.deleteMessage(languageRace.messageId)));
      };
      await expect(execute(languageRace, 'language-resolution-race')).rejects.toSatisfy(() => true);
      assert.strictEqual(
        calls,
        0,
        'stale context must not reach the provider after language resolution'
      );
      const current = await request('brief');

      await expect(execute({ ...current, messageId: first.id }, 'wrong-target')).rejects.toSatisfy(
        () => true
      );
      await run(Effect.flatMap(Notes, (c) => c.replySnapshot({ requestId: current.requestId })));

      context.db.orm.run(
        sql`CREATE TRIGGER fail_reply BEFORE UPDATE OF status ON message_versions WHEN NEW.status = 'complete' BEGIN SELECT RAISE(ABORT, 'unavailable'); END`
      );
      await expect(execute(current, 'replay')).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, 1);
      expect(bodies[0]!).toMatch(/detail.*brief/);
      context.db.orm.run(sql`DROP TRIGGER fail_reply`);
      context.db.orm.run(
        sql`DELETE FROM workflow_activities WHERE execution_id = 'replay' AND name = 'publish-reply'`
      );
      context.db.orm.run(
        sql`UPDATE workflow_executions SET status = 'suspended', result = NULL, owner_token = NULL WHERE execution_id = 'replay'`
      );
      context.close();
      context = new ServerContext(await location.open());
      await execute(current, 'replay');
      assert.strictEqual(calls, 1);
      assert.ok(
        context.db.orm
          .select()
          .from(s.message_versions)
          .all()
          .find((v) => v.id === current.versionId)?.text === 'A plain answer'
      );
      const reanswer = await run(
        Effect.flatMap(Notes, (c) => c.reanswer({ messageId: current.messageId }))
      );
      const reanswerEvent = decodeEvent(
        context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
      );

      assertEventType(reanswerEvent, 'NoteGenerationRequested', 'wrong event');

      output = 'Another answer';
      await execute(reanswerEvent, 'reanswer');
      const answered = await run(Effect.flatMap(Notes, (c) => c.message(current.messageId)));

      assert.strictEqual(reanswer.messageId, current.messageId);
      assert.strictEqual(answered.versions.length, 2);
      assert.ok(latestVersion(answered.versions).text === 'Another answer');
      const rewrite = await run(
        Effect.flatMap(Notes, (c) =>
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

      assertEventType(rewriteEvent, 'NoteGenerationRequested', 'wrong event');

      output = 'Rewritten answer';
      context.db.orm.run(
        sql`CREATE TRIGGER fail_rewrite BEFORE UPDATE OF status ON message_versions WHEN NEW.status = 'complete' BEGIN SELECT RAISE(ABORT, 'unavailable'); END`
      );
      const beforeRewrite = calls;

      await expect(execute(rewriteEvent, 'rewrite')).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, beforeRewrite + 1);
      context.db.orm.run(sql`DROP TRIGGER fail_rewrite`);
      context.db.orm.run(
        sql`DELETE FROM workflow_activities WHERE execution_id = 'rewrite' AND name = 'publish-reply'`
      );
      context.db.orm.run(
        sql`UPDATE workflow_executions SET status = 'suspended', result = NULL, owner_token = NULL WHERE execution_id = 'rewrite'`
      );
      context.close();
      context = new ServerContext(await location.open());
      await execute(rewriteEvent, 'rewrite');
      assert.strictEqual(calls, beforeRewrite + 1);
      const rewritten = await run(Effect.flatMap(Notes, (c) => c.message(current.messageId)));

      assert.strictEqual(rewrite.messageId, current.messageId);
      assert.ok(latestVersion(rewritten.versions).origin === 'instruction');
      assert.ok(latestVersion(rewritten.versions).instruction === 'Use bullet points');
      expect(bodies.at(-1)!).toMatch(/Another answer/);
      assert.strictEqual(bodies.at(-1)!.match(/Use bullet points/g)?.length, 1);
      expect(bodies.at(-1)!).not.toMatch(/Preferences: \{\}/);
      expect(bodies.at(-1)!).toMatch(/detail.*detailed/);
      const userRewrite = await run(
        Effect.flatMap(Notes, (c) => c.rewriteMessage({ messageId: first.id, origin: 'summarize' }))
      );
      const userEvent = decodeEvent(
        context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
      );

      assertEventType(userEvent, 'NoteGenerationRequested', 'wrong event');

      output = 'Short question';
      await execute(userEvent, 'rewrite-user');
      expect(bodies.at(-1)!).not.toMatch(/Preferences: \{\}/);
      const userResult = await run(Effect.flatMap(Notes, (c) => c.message(first.id)));

      assert.ok(latestVersion(userResult.versions).origin === 'summarize');
      assert.strictEqual(userResult.activeVersionId, userRewrite.versionId);
      const oldRequest = await run(
        Effect.flatMap(Notes, (c) =>
          c.rewriteMessage({ messageId: current.messageId, origin: 'improve' })
        )
      );
      const oldEvent = decodeEvent(
        context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
      );

      assertEventType(oldEvent, 'NoteGenerationRequested', 'wrong event');

      const newer = await run(
        Effect.flatMap(Notes, (c) =>
          c.rewriteMessage({
            messageId: current.messageId,
            origin: 'improve',
            instruction: 'Be clear'
          })
        )
      );

      assert.notStrictEqual(oldRequest.versionId, newer.versionId);
      const callsBeforeOld = calls;

      await expect(execute(oldEvent, 'superseded')).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, callsBeforeOld);
      const newerEvent = decodeEvent(
        context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
      );

      assertEventType(newerEvent, 'NoteGenerationRequested', 'wrong event');

      await run(
        Effect.flatMap(Notes, (c) =>
          c.editMessage({ messageId: current.messageId, text: 'Manual edit' })
        )
      );
      await expect(execute(newerEvent, 'manual-edit')).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, callsBeforeOld);
      output = 'A plain answer';
      await post();
      const racing = await request();

      duringCall = async () => {
        await run(Effect.flatMap(Notes, (c) => c.deleteMessage(racing.messageId)));
      };
      await expect(execute(racing, 'race')).rejects.toSatisfy(() => true);
      output = 'Fake [1]';
      const fake = await request();

      await expect(execute(fake, 'fake')).rejects.toSatisfy(() => true);
      expect(bodies.at(-1)!).toMatch(/Manual edit/);
      expect(bodies.at(-1)!).toMatch(/"role":"assistant"/);
      expect(bodies.at(-1)!).toMatch(/"role":"user"/);
      assert.strictEqual(
        context.db.orm
          .select()
          .from(s.message_versions)
          .all()
          .find((v) => v.id === fake.versionId)?.status,
        undefined
      );
      const retryAfterInvalidOutput = await request();

      assert.notStrictEqual(retryAfterInvalidOutput.requestId, fake.requestId);
      const groundedNote = await run(
        Effect.flatMap(Notes, (c) => c.createNote({ project: project.id, title: 'Grounded' }))
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
        corrected: false,
        omissions: []
      });
      const old = context.db.orm
        .insert(s.content_snapshots)
        .values({ source_id: source.id, extractor_version: 1n, meta, created_at: 1n })
        .returning()
        .get();

      context.db.orm
        .insert(s.blocks)
        .values({
          document_id: old.id,
          ordinal: 0n,
          kind: 'paragraph',
          editing_id: Schema.decodeUnknownSync(blockIdSchema)(crypto.randomUUID()),
          content: JSON.stringify({
            type: 'paragraph',
            inlines: [{ type: 'text', text: 'alpha old evidence', marks: [] }]
          }),
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
      context.db.orm
        .insert(s.source_snapshots)
        .values({
          source_id: source.id,
          revision: 1n,
          bytes: Buffer.from([1]),
          kind: 'text',
          mime: 'text/plain'
        })
        .run();
      context.db.orm
        .insert(s.source_extraction_revisions)
        .values({ source_id: source.id, revision: 1n, snapshot_id: old.id })
        .run();
      await run(
        Effect.flatMap(Notes, (c) =>
          c.postMessage({
            noteId: groundedNote.id,
            text: 'Find alpha',
            sourceIds: [source.id]
          })
        )
      );
      await run(Effect.flatMap(Notes, (c) => c.requestReply({ noteId: groundedNote.id })));
      const grounded = decodeEvent(
        context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
      );

      assertEventType(grounded, 'NoteGenerationRequested', 'wrong event');

      const replacement = context.db.orm
        .insert(s.content_snapshots)
        .values({ source_id: source.id, extractor_version: 1n, meta, created_at: 2n })
        .returning()
        .get();

      context.db.orm
        .insert(s.blocks)
        .values({
          document_id: replacement.id,
          ordinal: 0n,
          kind: 'paragraph',
          editing_id: Schema.decodeUnknownSync(blockIdSchema)(crypto.randomUUID()),
          content: JSON.stringify({
            type: 'paragraph',
            inlines: [{ type: 'text', text: 'alpha new evidence', marks: [] }]
          }),
          text: 'alpha new evidence',
          anchor: JSON.stringify({ type: 'page', page: 2 })
        })
        .run();
      context.db.orm
        .insert(s.source_extraction_revisions)
        .values({ source_id: source.id, revision: 1n, snapshot_id: replacement.id })
        .run();
      context.db.orm.run(
        sql`UPDATE source_processing SET document_id = ${replacement.id} WHERE source_id = ${source.id}`
      );
      toolCall = true;
      output = 'Grounded [1]';
      await execute(grounded, 'grounded');
      expect(bodies.at(-1)!).toMatch(/alpha old evidence/);
      expect(bodies.at(-1)!).not.toMatch(/alpha new evidence/);

      await run(
        Effect.flatMap(Notes, (c) =>
          c.postMessage({ noteId: groundedNote.id, text: 'One more alpha question' })
        )
      );

      await run(Effect.flatMap(Notes, (c) => c.requestReply({ noteId: groundedNote.id })));
      const toolRace = decodeEvent(
        context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
      );

      assertEventType(toolRace, 'NoteGenerationRequested', 'wrong event');

      const callsBeforeToolRace = calls;

      toolCall = true;
      duringToolCall = async () => {
        await run(Effect.flatMap(Notes, (c) => c.deleteMessage(toolRace.messageId)));
      };
      await expect(execute(toolRace, 'tool-step-race')).rejects.toSatisfy(() => true);
      assert.strictEqual(
        calls,
        callsBeforeToolRace + 1,
        'a stale tool round trip must not start another provider call'
      );

      await run(
        Effect.flatMap(Notes, (c) =>
          c.postMessage({ noteId: groundedNote.id, text: 'Cancel this' })
        )
      );
      await run(Effect.flatMap(Notes, (c) => c.requestReply({ noteId: groundedNote.id })));
      const cancelled = decodeEvent(
        context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
      );

      assertEventType(cancelled, 'NoteGenerationRequested', 'wrong event');

      output = 'Cancelled answer';
      duringCall = async () => {
        await cancel!();
      };
      await expect(execute(cancelled, 'cancelled')).rejects.toSatisfy(() => true);
      assert.notStrictEqual(
        context.db.orm
          .select()
          .from(s.message_versions)
          .all()
          .find((v) => v.id === cancelled.versionId)?.status,
        'complete'
      );
      assert.ok(
        context.db.orm
          .select()
          .from(s.citations)
          .all()
          .find((c) => c.version_id === grounded.versionId)?.quote === 'alpha old evidence'
      );
      const attachmentAnswer = await run(
        Effect.flatMap(Notes, (c) => c.message(grounded.messageId))
      );
      const attachmentEdit = await run(
        Effect.flatMap(Notes, (c) =>
          c.editMessage({ messageId: grounded.messageId, text: 'Edited attachment answer [1]' })
        )
      );

      assert.strictEqual(attachmentAnswer.citations[0]?.sourceId, source.id);
      expect(attachmentEdit.citations).toStrictEqual(attachmentAnswer.citations);
      const selected = await run(
        Effect.gen(function* () {
          const materials = yield* Pages;
          const notes = yield* Notes;
          const note = yield* notes.createNote({ title: 'Selected passages' });
          const block = createBlock({
            type: 'paragraph',
            inlines: [
              {
                type: 'text',
                text: 'secret before alpha selected passage secret after alpha',
                marks: []
              }
            ]
          });
          const material = yield* materials.create({
            createKey: crypto.randomUUID(),
            inputs: [],
            citations: [],
            title: 'Exact authored input',
            noteId: note.id,
            document: {
              blocks: [block],
              meta: {
                extractor: null,
                extractorVersion: 1,
                provider: null,
                durationMs: null,
                pageCount: null,
                refiners: [],
                waitingFor: [],
                corrected: false,
                omissions: []
              }
            }
          });

          assert.ok(material.version);

          yield* notes.updateNoteSelection({
            noteId: note.id,
            expectedRevision: 0n,
            targets: [
              {
                input: { kind: 'page', versionId: material.version.id },
                scope: {
                  kind: 'ranges',
                  ranges: [
                    {
                      blockId: block.id,
                      start: 14,
                      end: 36
                    },
                    {
                      blockId: block.id,
                      start: 14,
                      end: 19
                    },
                    {
                      blockId: block.id,
                      start: 50,
                      end: 55
                    }
                  ]
                }
              }
            ]
          });
          const message = yield* notes.postMessage({
            noteId: note.id,
            text: 'Explain alpha'
          });
          const request = yield* notes.requestReply({
            noteId: note.id,
            intentKey: 'exact-workflow'
          });

          yield* notes.updateNoteSelection({
            noteId: note.id,
            expectedRevision: 1n,
            targets: []
          });
          yield* notes.editMessage({
            messageId: message.id,
            text: 'New unrelated message'
          });

          return request;
        })
      );
      const selectedEvent = decodeEvent(
        context.db.orm
          .select()
          .from(s.workflowEvents)
          .all()
          .find(
            (event) =>
              event.type === 'NoteGenerationRequested' && event.correlationId === selected.requestId
          )!.payload
      );

      assertEventType(selectedEvent, 'NoteGenerationRequested', 'wrong selected event');
      toolCall = true;
      output = 'Exact answer [1]';
      await execute(selectedEvent, 'selected-range');
      expect(bodies.at(-1)!).toMatch(/alpha selected passage/);
      expect(bodies.at(-1)!).toMatch(/secret before.*secret after/);
      expect(bodies.at(-1)!).not.toMatch(/New unrelated message/);
      const selectedAnswer = await run(Effect.flatMap(Notes, (c) => c.message(selected.messageId)));

      assert.ok(
        selectedAnswer.citations[0]?.quote ===
          'secret before alpha selected passage secret after alpha'
      );
      assert.strictEqual(selectedAnswer.citations[0]?.rangeStart, 0);
      expect(
        selectedAnswer.citations.map((citation) => [citation.rangeStart, citation.rangeEnd])
      ).toStrictEqual([[0, 55]]);
      await execute(selectedEvent, 'selected-range');
      const selectedEdit = await run(
        Effect.flatMap(Notes, (c) =>
          c.editMessage({ messageId: selected.messageId, text: 'Retained evidence [1]' })
        )
      );

      expect(selectedEdit.citations).toStrictEqual(selectedAnswer.citations);
      await assertLongHistoryPreservesEarlyMessages();

      const marked = await run(
        Effect.gen(function* () {
          const c = yield* Notes;
          const notebook = yield* c.createNote({ title: 'Question and answer' });
          const note = yield* c.postMessage({
            noteId: notebook.id,
            text: 'Why does ice float?',
            requestReply: false
          });

          return yield* c.setMessageKind({
            messageId: note.id,
            expectedActiveVersionId: note.activeVersionId!,
            kind: 'question'
          });
        })
      );
      const questionEvent = context.db.orm
        .select()
        .from(s.workflowEvents)
        .all()
        .map((event) => decodeEvent(event.payload))
        .find(
          (event) =>
            event.type === 'NoteGenerationRequested' &&
            event.requestId === marked.question?.answerRequestId
        );

      assertEventType(questionEvent, 'NoteGenerationRequested', 'missing in-place answer event');
      output = 'Ice is less dense than water.';
      const callsBeforeQuestion = calls;

      await execute(questionEvent, 'answer-question-in-place');
      await execute(questionEvent, 'answer-question-in-place');
      expect(calls).toBe(callsBeforeQuestion + 1);
      const answeredQuestion = await run(Effect.flatMap(Notes, (c) => c.message(marked.id)));

      expect(answeredQuestion.activeVersionId).toBe(questionEvent.versionId);
      expect(answeredQuestion.versions).toHaveLength(2);
      expect(latestVersion(answeredQuestion.versions).text).toBe(
        '**Question**\n\nWhy does ice float?\n\n**Answer**\n\nIce is less dense than water.'
      );

      async function assertLongHistoryPreservesEarlyMessages() {
        const longNote = await run(
          Effect.flatMap(Notes, (c) => c.createNote({ project: project.id, title: 'Long' }))
        );
        const early = await run(
          Effect.flatMap(Notes, (c) =>
            c.postMessage({ noteId: longNote.id, text: 'Early message' })
          )
        );

        for (let i = 0; i < 55; i++) {
          await run(
            Effect.flatMap(Notes, (c) => c.postMessage({ noteId: longNote.id, text: `Later ${i}` }))
          );
        }

        const earlyRewrite = await run(
          Effect.flatMap(Notes, (c) => c.rewriteMessage({ messageId: early.id, origin: 'improve' }))
        );
        const earlySnapshot = await run(
          Effect.flatMap(Notes, (c) => c.replySnapshot({ requestId: earlyRewrite.requestId }))
        );

        assert.ok(earlySnapshot.messages.at(-1)?.text === 'Early message');
      }
    } finally {
      await auth.dispose();
      context.close();
      await location.cleanup();
      await peer.stop(true);
    }
  }
);

function assertEventType<T extends ReturnType<typeof decodeEvent>['type']>(
  event: ReturnType<typeof decodeEvent> | undefined,
  type: T,
  message: string
): asserts event is Extract<ReturnType<typeof decodeEvent>, { type: T }> {
  assert.ok(event && event.type === type, message);
}

function latestVersion(versions: readonly (typeof messageVersionSchema.Type)[]) {
  const version = versions.at(-1);

  assert.ok(version, 'expected a retained message version');

  return version;
}
