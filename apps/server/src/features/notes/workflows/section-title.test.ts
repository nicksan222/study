import { StudyError } from '@study/contracts';
import { eq, workflow_configuration_waits } from '@study/db';
import { ServerContext, normalizeError, notifyConfigurationChanged } from '@study/server';
import type { agentsLayer } from '@study/server';
import { test } from '@study/testing';
import { Effect } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { sectionTitleAgent } from '#server/features/notes/agents/section-title';
import { Notes } from '#server/features/notes/index';
import { noteSectionTitleRegistration } from '#server/features/notes/workflows/section-title';
import { withTestPublication } from '#testing/publication';
import {
  configurationWait,
  domain,
  eventFor,
  execute,
  makeCapture,
  services
} from '#testing/section-titles';

type Model = Parameters<typeof agentsLayer>[0]['model'];

test.server.stable.for([
  {
    language: 'english',
    text: 'Retrieving a memory strengthens it. Rereading only makes it familiar.',
    title: 'Retrieval practice'
  },
  {
    language: 'italian',
    text: 'Ripetere il recupero a distanza aiuta a ricordare più a lungo.',
    title: 'Recupero e spaziatura'
  }
] as const)(
  'the registered section-title workflow publishes a concise $language name and replays after reopening',
  async ({ language, text, title }, { databases, createAiMock, expect }) => {
    const location = await databases();
    let context = new ServerContext(await location.open());
    using mock = createAiMock();
    let calls = 0;
    const model: Model = (tier, call) => {
      expect(tier).toBe('tiny');
      calls++;

      return mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError));
    };

    try {
      const capture = await makeCapture(context, text);
      const event = eventFor(context, capture);

      mock.next(sectionTitleAgent, { input: { prompt: JSON.stringify({ text }) }, output: title });
      await execute(context, model, language, event, 'localized-title');
      context.close();
      context = new ServerContext(await location.open());
      await execute(context, model, language, event, 'localized-title');
      const restored = await Effect.runPromise(
        Notes.use((notes) => notes.message(capture.id)).pipe(Effect.provide(domain(context)))
      );

      expect(restored.sectionTitle).toStrictEqual({ versionId: capture.activeVersionId, title });
      expect(restored.versions[0]?.text).toBe(text);
      expect(calls).toBe(1);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'section naming stays pending without provider setup and resumes the same request after configuration changes',
  async ({ databases, createAiMock, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    using mock = createAiMock();
    let revision = 'before-sign-in';
    let calls = 0;
    const text = 'Spreading practice over several days improves later recall.';
    const model: Model = (tier, call) => {
      calls++;

      return revision === 'before-sign-in'
        ? Effect.fail(new StudyError('auth', 'Provider setup is required'))
        : mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError));
    };

    try {
      const capture = await makeCapture(context, text);
      const event = eventFor(context, capture);
      const waiting = configurationWait(context, 'setup-title');

      mock.next(sectionTitleAgent, {
        input: { prompt: JSON.stringify({ text }) },
        output: 'Spacing effect'
      });
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;
            const notes = yield* Notes;

            yield* engine.execute(noteSectionTitleRegistration.definition, {
              executionId: 'setup-title',
              payload: { event },
              discard: true
            });
            yield* Effect.promise(() => waiting);
            expect((yield* notes.message(capture.id)).sectionTitle).toBeUndefined();
            expect(
              context.db.orm
                .select()
                .from(workflow_configuration_waits)
                .where(eq(workflow_configuration_waits.execution_id, 'setup-title'))
                .get()?.reason
            ).toBe('auth');
            expect(calls).toBe(1);
            revision = 'signed-in';
            yield* notifyConfigurationChanged(context, engine, revision);
            yield* engine.execute(noteSectionTitleRegistration.definition, {
              executionId: 'setup-title',
              payload: { event }
            });
            expect((yield* notes.message(capture.id)).sectionTitle?.title).toBe('Spacing effect');
            expect(calls).toBe(2);
          }).pipe(Effect.provide(services(context, model, 'english', () => revision)))
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'an in-flight section name cannot replace edited content and existing metadata bypasses model work',
  async ({ databases, createAiMock, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    using mock = createAiMock();
    let calls = 0;
    const model: Model = (tier, call) => {
      calls++;

      return mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError));
    };

    try {
      const text = 'Self-testing reveals which concepts I cannot yet explain.';
      const capture = await makeCapture(context, text);
      const event = eventFor(context, capture);
      const plan = mock.next(sectionTitleAgent, {
        input: { prompt: JSON.stringify({ text }) },
        output: 'Active recall',
        hold: true
      });
      const execution = execute(context, model, 'english', event, 'edited-title');

      await plan.called;
      const edited = await Effect.runPromise(
        Notes.use((notes) =>
          notes.editMessage({
            messageId: capture.id,
            text: 'Compare explanations against the source.'
          })
        ).pipe(Effect.provide(domain(context)))
      );

      plan.release();
      await execution;
      expect(
        (
          await Effect.runPromise(
            Notes.use((notes) => notes.message(capture.id)).pipe(Effect.provide(domain(context)))
          )
        ).sectionTitle
      ).toBeUndefined();
      await Effect.runPromise(
        Notes.use((notes) =>
          withTestPublication(
            context,
            notes.publishSectionTitle({
              messageId: capture.id,
              expectedActiveVersionId: edited.activeVersionId!,
              title: 'Checking explanations'
            })
          )
        ).pipe(Effect.provide(domain(context)))
      );
      await execute(context, model, 'english', eventFor(context, edited), 'already-named');
      const named = await Effect.runPromise(
        Notes.use((notes) => notes.message(capture.id)).pipe(Effect.provide(domain(context)))
      );

      expect(named.sectionTitle?.title).toBe('Checking explanations');
      expect(calls).toBe(1);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable.for(['reactivate', 'unarchive'] as const)(
  'restoring a section after obsolete title work completes schedules one fresh request: %s',
  async (action, { databases, createAiMock, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    using mock = createAiMock();
    const model: Model = (tier, call) =>
      mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError));

    try {
      const text = 'Explaining from memory reveals what I have not understood.';
      const capture = await makeCapture(context, text);
      const obsolete = eventFor(context, capture);

      await Effect.runPromise(
        Notes.use((notes) =>
          action === 'reactivate'
            ? notes
                .editMessage({ messageId: capture.id, text: 'Another version of the observation.' })
                .pipe(Effect.asVoid)
            : notes.setItemArchived({
                noteId: capture.noteId,
                target: { kind: 'message', id: capture.id },
                archived: true
              })
        ).pipe(Effect.provide(domain(context)))
      );
      await execute(context, model, 'english', obsolete, 'obsolete-section-title');
      await Effect.runPromise(
        Notes.use((notes) =>
          action === 'reactivate'
            ? notes
                .setActiveVersion({ messageId: capture.id, versionId: capture.activeVersionId! })
                .pipe(Effect.asVoid)
            : notes.setItemArchived({
                noteId: capture.noteId,
                target: { kind: 'message', id: capture.id },
                archived: false
              })
        ).pipe(Effect.provide(domain(context)))
      );
      await Effect.runPromise(
        Notes.use((notes) => notes.thread({ noteId: capture.noteId, limit: 30 })).pipe(
          Effect.provide(domain(context))
        )
      );
      const followup = eventFor(context, capture);

      expect(followup.eventId).not.toBe(obsolete.eventId);
      expect(followup.correlationId).toBe(obsolete.correlationId);
      await Effect.runPromise(
        Notes.use((notes) => notes.thread({ noteId: capture.noteId, limit: 30 })).pipe(
          Effect.provide(domain(context))
        )
      );
      expect(eventFor(context, capture).eventId).toBe(followup.eventId);
      mock.next(sectionTitleAgent, {
        input: { prompt: JSON.stringify({ text }) },
        output: 'Explaining from memory'
      });
      await execute(context, model, 'english', followup, 'restored-section-title');
      const restored = await Effect.runPromise(
        Notes.use((notes) => notes.message(capture.id)).pipe(Effect.provide(domain(context)))
      );

      expect(restored.sectionTitle).toStrictEqual({
        versionId: capture.activeVersionId,
        title: 'Explaining from memory'
      });
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
