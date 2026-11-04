/** Exact authored evidence and a controlled native learning response shared by retention suites. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Effect } from 'effect';

import { Documents } from '#server/features/documents/index';
import { Materials } from '#server/features/materials/index';
import { Projects } from '#server/features/projects/index';
import type { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';
type Fixture = Awaited<ReturnType<typeof documentTransformFixture>>;
export function learningGeneration(f: Fixture) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const docs = yield* Documents;
      const project = yield* (yield* Projects).createProject({ name: 'Generated history' });
      const input = yield* docs.create({
        createKey: randomUUID(),
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
        inputs: [{ kind: 'document', versionId: input.version.id }]
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
