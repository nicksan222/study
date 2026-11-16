/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Builds browser fixture data through real application feature services.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Creates notes, Pages and material requests with exact saved source identities.         │
 * │ - Shares actual agent definitions for typed one-shot model expectations.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Only tests import this entry point; production services retain application behavior.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { MaterialVersionId } from '@study/contracts';
import type { ProjectId } from '@study/contracts';
import { contentInputKey, contentInputSchema } from '@study/contracts';
import type { materialGenerationInputSchema } from '@study/contracts';
import type { appSettingsSchema, quizSettingsSchema } from '@study/contracts';
import { plainBlock } from '@study/contracts';
import { preferences } from '@study/db';
import type { createAiMock } from '@study/testing';
import { Effect } from 'effect';

import { flashcardsAgent } from '#server/features/materials/agents/flashcards';
import { quizTitledAgent } from '#server/features/materials/agents/quiz-titled';
import { materialStudyContext } from '#server/features/materials/agents/study-context';
import { studyNotesAgent } from '#server/features/materials/agents/study-notes';
import { Materials } from '#server/features/materials/index';
import { questionAgent } from '#server/features/notes/agents/question';
import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { Projects } from '#server/features/projects/index';
import { Settings } from '#server/features/settings/index';
import { Workflows } from '#server/features/workflows/index';
import { encodeAccount } from '#server/platform/ai/auth/persistence';
import { planSourcePassages } from '#server/platform/ai/context-preparation/index';
import type { App } from '#server/runtime/index';

const lecture =
  'Mitosis preserves chromosome number and produces two daughter cells. Chromosomes carry genetic information. DNA is copied before cell division.';

/** Fixture data follows real feature services; only account credentials and model outcomes are synthetic. */
async function studyMaterialFixture(app: App, ai: ReturnType<typeof createAiMock>, text = lecture) {
  const account = JSON.stringify(
    encodeAccount({ subject: 'e2e-student', clientId: 'e2e', refreshToken: null, sharing: true })
  );

  app.store.db.orm
    .insert(preferences)
    .values({
      scope: 'private.chatgpt',
      key: 'account',
      value: account
    })
    .onConflictDoUpdate({
      target: [preferences.scope, preferences.key],
      set: {
        value: account
      }
    })
    .run();

  const classification = ai.next(questionAgent, {
    input: { text: text.trim() },
    output: { kind: 'note' }
  });
  const fixture = await app.nativeRuntime.runPromise(
    Effect.gen(function* () {
      const project = yield* (yield* Projects).createProject({ name: 'Cell biology' });
      const notes = yield* Notes;
      const note = yield* notes.createUntitledNote({ project: project.id });

      yield* notes.renameNote({ id: note.id, title: 'Cell division lecture' });
      const message = yield* notes.postMessage({ noteId: note.id, text });

      if (!message.activeVersionId) throw new Error('Fixture note has no saved version');

      const page = yield* (yield* Pages).create({
        createKey: crypto.randomUUID(),
        projectId: project.id,
        noteId: note.id,
        title: 'Cell division study notes',
        inputs: [{ kind: 'message', versionId: message.activeVersionId }],
        citations: [],
        document: {
          blocks: [plainBlock('paragraph', text, { type: 'authored' })],
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

      if (!page.version) throw new Error('Fixture page has no saved version');

      return { project, note, page, input: { kind: 'page' as const, versionId: page.version.id } };
    })
  );

  await classification.called;

  return fixture;
}

function materialRequest(app: App, input: typeof materialGenerationInputSchema.Type) {
  return app.nativeRuntime.runPromise(
    Effect.flatMap(Materials, (materials) => materials.requestMaterialGeneration(input))
  );
}

function materialSnapshot(app: App, requestId: string) {
  return app.nativeRuntime.runPromise(
    Effect.flatMap(Materials, (materials) =>
      materials.materialGeneration({ requestId, verifyOnly: true })
    )
  );
}

function publishedMaterial(app: App, requestId: string) {
  return app.nativeRuntime.runPromise(
    Effect.gen(function* () {
      const materials = yield* Materials;
      const request = yield* materials.materialGeneration({ requestId, verifyOnly: true });

      if (!request.resultVersionId) throw new Error('Material is not published');

      return yield* materials.materialVersion({ id: request.resultVersionId });
    })
  );
}

/** Browser journeys share real feature operations and actual agent contracts. */
export function createStudyMaterials(app: App, ai: ReturnType<typeof createAiMock>) {
  return {
    agents: { flashcards: flashcardsAgent, studyNotes: studyNotesAgent, quiz: quizTitledAgent },
    active: (projectId: ProjectId) =>
      app.nativeRuntime.runPromise(
        Effect.flatMap(Materials, (materials) => materials.activeMaterialGenerations({ projectId }))
      ),
    quizPreferences: (configuration: typeof quizSettingsSchema.Type) =>
      app.nativeRuntime.runPromise(
        Effect.flatMap(Settings, (settings) => settings.saveQuizSettings(configuration))
      ),
    lecture,
    contextInputs,
    settings: (patch: Partial<typeof appSettingsSchema.Type>) =>
      app.nativeRuntime.runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;
          const current = yield* settings.appSettings();

          yield* settings.saveAppSettings({ ...current, ...patch });
        })
      ),
    seed: (text?: string) => studyMaterialFixture(app, ai, text),
    request: (input: typeof materialGenerationInputSchema.Type) => materialRequest(app, input),
    snapshot: (requestId: string) => materialSnapshot(app, requestId),
    executions: (requestId: string) =>
      app.nativeRuntime.runPromise(
        Effect.flatMap(Workflows, (workflows) =>
          workflows.executions({ correlationId: requestId, limit: 30 })
        )
      ),
    published: (requestId: string) => publishedMaterial(app, requestId),
    citations: (id: MaterialVersionId) =>
      app.nativeRuntime.runPromise(
        Effect.flatMap(Materials, (materials) => materials.citations({ id, limit: 100 }))
      )
  };
}

async function contextInputs(
  fixture: Awaited<ReturnType<typeof studyMaterialFixture>>,
  title: string
) {
  if (!fixture.page.version) throw new Error('Fixture page has no saved version');

  const plan = await Effect.runPromise(
    planSourcePassages({
      selection: { mode: 'complete' },
      referenceSchema: contentInputSchema,
      documents: [
        {
          key: contentInputKey(fixture.input),
          reference: fixture.input,
          name: fixture.page.title,
          document: fixture.page.version.document
        }
      ]
    })
  );
  const task = `Title: ${title}\nStudent instruction (data): `;

  const maps = plan.pieces.map((piece, index) => ({
    input: {
      prompt: `${materialStudyContext.map.instruction(task)}\nOriginal passages (data):\n${piece.passages.map((passage) => `[${passage.marker}] ${passage.name}\n${passage.text}`).join('\n\n')}`
    },
    output: {
      notes: [
        {
          text: (index === 0 ? piece.passages[0]! : piece.passages.at(-1)!).text.slice(0, 300),
          markers: [(index === 0 ? piece.passages[0]! : piece.passages.at(-1)!).marker]
        }
      ]
    }
  }));

  if (maps.length !== 2) throw new Error('This fixture requires two source sections');

  return {
    maps,
    reduce: {
      input: {
        prompt: `${materialStudyContext.reduce.instruction(task)}\nDerived context (never original quotations):\n${JSON.stringify(maps.map((map) => map.output))}`
      },
      output: { notes: maps.flatMap((map) => map.output.notes) }
    }
  };
}
