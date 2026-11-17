/** @file Real notebook services and controlled, typed model outcomes for browser journeys. */

import type { NoteId, transformRequestSchema } from '@study/contracts';
import { transformSnapshotSchema } from '@study/contracts';
import { preferences } from '@study/db';
import { encodeAccount } from '@study/server';
import type { createAiMock } from '@study/testing';
import { Effect } from 'effect';

import { questionAgent } from '#server/features/notes/agents/question';
import { sectionTitleAgent } from '#server/features/notes/agents/section-title';
import { Notes } from '#server/features/notes/index';
import { pageTransformAgent } from '#server/features/pages/agents/page-transform';
import { pageTransformPrompt } from '#server/features/pages/decoders/page-transform-prompt';
import { Projects } from '#server/features/projects/index';
import type { App } from '#server/runtime/index';

export function createNoteWorkspace(app: App, ai: ReturnType<typeof createAiMock>) {
  return {
    seed: async () => {
      connectStudyAccount(app);

      return app.nativeRuntime.runPromise(studyNotebook('Cell division research dump'));
    },
    capture: (text: string, title: string) => {
      const classification = ai.next(questionAgent, {
        input: { text: text.trim() },
        output: { kind: 'note' }
      });
      const naming = ai.next(sectionTitleAgent, {
        input: { prompt: JSON.stringify({ text: text.trim() }) },
        output: title,
        hold: true
      });

      return { classification, naming };
    },
    transform: async (
      noteId: NoteId,
      input: Omit<typeof transformRequestSchema.Type, 'contextRequestId'> & { instruction: string }
    ) => {
      const context = await app.nativeRuntime.runPromise(
        Effect.flatMap(Notes, (notes) =>
          notes.captureNoteContext({
            noteId,
            intentKey: crypto.randomUUID(),
            instruction: input.instruction,
            preferences: { language: 'english' }
          })
        )
      );
      // IDs belong to capture/publication, and are deliberately absent from the model prompt.
      const request = transformSnapshotSchema.make({
        id: 'expected-transform',
        eventId: 'expected-transform',
        contextRequestId: context.requestId,
        noteId,
        title: input.title,
        operations: input.operations,
        instruction: input.instruction,
        cancelled: false,
        errorKind: null,
        resultVersionId: null,
        report: null
      });
      const expectedInput = { prompt: pageTransformPrompt(request, context).prompt };

      return {
        next: (output: typeof pageTransformAgent.output.Type) =>
          ai.next(pageTransformAgent, { input: expectedInput, output, hold: true }),
        fail: (error: Error) =>
          ai.failNext(pageTransformAgent, { input: expectedInput, error, hold: true })
      };
    }
  };
}

/** Only credentials are synthetic; all notebook behavior uses application services. */
export function connectStudyAccount(app: App) {
  const account = JSON.stringify(
    encodeAccount({
      subject: 'e2e-student',
      clientId: 'e2e',
      refreshToken: null,
      sharing: true
    })
  );

  app.store.db.orm
    .insert(preferences)
    .values({ scope: 'private.chatgpt', key: 'account', value: account })
    .onConflictDoUpdate({
      target: [preferences.scope, preferences.key],
      set: { value: account }
    })
    .run();
}

/** Seed a named notebook without triggering unrelated automatic notebook naming. */
export function studyNotebook(title: string) {
  return Effect.gen(function* () {
    const project = yield* (yield* Projects).createProject({ name: 'Cell biology' });
    const notes = yield* Notes;
    const note = yield* notes.createUntitledNote({ project: project.id });

    yield* notes.renameNote({ id: note.id, title });

    return { note, project };
  });
}
