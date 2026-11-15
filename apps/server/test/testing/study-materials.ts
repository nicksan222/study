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

import type { materialGenerationInputSchema } from '@study/contracts/materials/schemas';
import { plainBlock } from '@study/contracts/sources/document';
import { preferences } from '@study/db/schema';
import type { createAiMock } from '@study/testing/ai-mock';
import { Effect } from 'effect';

import { flashcardsAgent } from '#server/features/materials/agents/flashcards';
import { Materials } from '#server/features/materials/index';
import { questionAgent } from '#server/features/notes/agents/question';
import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { Projects } from '#server/features/projects/index';
import { encodeAccount } from '#server/platform/ai/auth/persistence';
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

  const classification = ai.next(questionAgent, { input: { text }, output: { kind: 'note' } });
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
    Effect.flatMap(Materials, (materials) => materials.materialGeneration({ requestId }))
  );
}

function publishedMaterial(app: App, requestId: string) {
  return app.nativeRuntime.runPromise(
    Effect.gen(function* () {
      const materials = yield* Materials;
      const request = yield* materials.materialGeneration({ requestId });

      if (!request.resultVersionId) throw new Error('Material is not published');

      return yield* materials.materialVersion({ id: request.resultVersionId });
    })
  );
}

/** Browser journeys share real feature operations and actual agent contracts. */
export function createStudyMaterials(app: App, ai: ReturnType<typeof createAiMock>) {
  return {
    agents: { flashcards: flashcardsAgent },
    seed: (text?: string) => studyMaterialFixture(app, ai, text),
    request: (input: typeof materialGenerationInputSchema.Type) => materialRequest(app, input),
    snapshot: (requestId: string) => materialSnapshot(app, requestId),
    published: (requestId: string) => publishedMaterial(app, requestId)
  };
}
