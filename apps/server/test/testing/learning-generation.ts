/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Builds exact authored evidence and controlled native learning generation fixtures. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Prepares independent retained inputs through real feature services.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Test callers own isolated SQLite lifetimes and explicitly control provider responses.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Effect } from 'effect';
import { assert } from 'vite-plus/test';

import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { Projects } from '#server/features/projects/index';
import { deletionDocument } from '#testing/material-deletion';
import type { pageTransformFixture } from '#testing/page-transform';

type Fixture = Awaited<ReturnType<typeof pageTransformFixture>>;

export function learningGeneration(f: Fixture) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const docs = yield* Pages;
      const project = yield* (yield* Projects).createProject({ name: 'Generated history' });
      const input = yield* docs.create({
        createKey: crypto.randomUUID(),
        title: 'Evidence',
        projectId: project.id,
        document: deletionDocument('Shared generation evidence'),
        inputs: [],
        citations: []
      });

      assert.ok(input.version);
      const request = yield* (yield* Materials).requestMaterialGeneration({
        projectId: project.id,
        kind: 'flashcards',
        title: 'Aid',
        instruction: 'HISTORY_PRIVATE_GENERATION',
        inputs: [{ kind: 'page', versionId: input.version.id }]
      });

      return { input: { ...input, version: input.version }, request };
    }).pipe(Effect.provide(f.domain()))
  );
}

export function queueLearningGeneration(f: Fixture) {
  f.replies.push(
    { kind: 'sources', query: 'generation evidence' },
    {
      kind: 'output',
      output: {
        kind: 'flashcards',
        cards: [{ front: 'GENERATED_HISTORICAL_BODY [1]', back: 'Shared generation evidence' }]
      }
    }
  );
}
