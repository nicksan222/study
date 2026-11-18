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
import { planSourcePassages } from '@study/server';
import type { createAiMock } from '@study/testing';
import { Effect } from 'effect';

import { flashcardsAgent } from '#server/features/materials/agents/flashcards';
import { generationPlanAgent } from '#server/features/materials/agents/generation-plan';
import { quizTitledAgent } from '#server/features/materials/agents/quiz-titled';
import { materialStudyContext } from '#server/features/materials/agents/study-context';
import { studyNotesAgent } from '#server/features/materials/agents/study-notes';
import { writtenExamAgent } from '#server/features/materials/agents/written-exam';
import { materialGenerationPrompt } from '#server/features/materials/decoders/generation-novelty';
import { Materials } from '#server/features/materials/index';
import { questionAgent } from '#server/features/notes/agents/question';
import { sectionTitleAgent } from '#server/features/notes/agents/section-title';
import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { Settings } from '#server/features/settings/index';
import { Workflows } from '#server/features/workflows/index';
import type { App } from '#server/runtime/index';
import {
  emptyGenerationHistory,
  expectMaterialGeneration,
  expectNoveltyGeneration,
  failMaterialGeneration,
  generationTestPlan,
  generationTestHistory
} from '#testing/generation-expectations';
import { connectStudyAccount, createNoteWorkspace, studyNotebook } from '#testing/note-workspace';

const lecture =
  'Mitosis preserves chromosome number and produces two daughter cells. Chromosomes carry genetic information. DNA is copied before cell division.';

/** Fixture data follows real feature services; only account credentials and model outcomes are synthetic. */
async function studyMaterialFixture(app: App, ai: ReturnType<typeof createAiMock>, text = lecture) {
  connectStudyAccount(app);

  const classification = ai.next(questionAgent, {
    input: { text: text.trim() },
    output: { kind: 'note' }
  });
  const sectionTitle = ai.next(sectionTitleAgent, {
    input: { prompt: JSON.stringify({ text: text.trim() }) },
    output: 'Cell division overview'
  });
  const fixture = await app.nativeRuntime.runPromise(
    Effect.gen(function* () {
      const { project, note } = yield* studyNotebook('Cell division lecture');
      const notes = yield* Notes;
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

  await Promise.all([classification.called, sectionTitle.called]);

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
    notes: createNoteWorkspace(app, ai),
    agents: {
      flashcards: flashcardsAgent,
      studyNotes: studyNotesAgent,
      quiz: quizTitledAgent,
      writtenExam: writtenExamAgent
    },
    generate: <A extends typeof flashcardsAgent | typeof quizTitledAgent>(
      target: A,
      options: Parameters<typeof expectMaterialGeneration<A>>[2],
      history?: Parameters<typeof expectMaterialGeneration<A>>[3]
    ) => expectMaterialGeneration(ai, target, options, history),
    failGeneration: (
      target: typeof flashcardsAgent | typeof quizTitledAgent,
      options: Parameters<typeof failMaterialGeneration>[2],
      history?: Parameters<typeof failMaterialGeneration>[3]
    ) => failMaterialGeneration(ai, target, options, history),
    history: generationTestHistory,
    novelty: <A extends typeof flashcardsAgent | typeof quizTitledAgent>(
      target: A,
      options: Parameters<typeof expectNoveltyGeneration<A>>[2],
      history: Parameters<typeof expectNoveltyGeneration<A>>[3]
    ) => expectNoveltyGeneration(ai, target, options, history),
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
  title: string,
  stage: 'plan' | 'candidate' = 'plan'
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
  const request = `Title: ${title}\nStudent instruction (data): `;
  const task =
    stage === 'plan'
      ? generationPlanAgent.prompt({ kind: 'flashcards', request, history: emptyGenerationHistory })
      : materialGenerationPrompt(request, generationTestPlan, emptyGenerationHistory);

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
