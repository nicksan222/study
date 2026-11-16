import type { MaterialContentInput } from '@study/contracts';
import { plainBlock } from '@study/contracts';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { Projects } from '#server/features/projects/index';
import { pageTransformFixture } from '#testing/page-transform';

const cases = [
  {
    name: 'exact',
    candidate: 'What carries energy? [1]',
    review: [],
    repair: 'How many phosphate groups does ADP have? [1]',
    failure: null,
    calls: 7
  },
  {
    name: 'semantic',
    candidate: 'Which molecule transports energy? [1]',
    review: [{ index: 0, reason: 'history_duplicate' }],
    repair: 'How many phosphate groups does ADP have? [1]',
    failure: null,
    calls: 7
  },
  {
    name: 'exhausted',
    candidate: 'What carries energy? [1]',
    review: [],
    repair: 'What carries energy? [1]',
    failure: 'not_enough',
    calls: 7
  },
  {
    name: 'invalid-review',
    candidate: 'What carries energy? [1]',
    review: [{ index: 49, reason: 'history_duplicate' }],
    repair: 'How many phosphate groups does ADP have? [1]',
    failure: 'invalid_input',
    calls: 4
  }
] as const;

for (const kind of ['quiz', 'flashcards'] as const) {
  for (const scenario of cases) {
    test.server.stable(
      `${kind} generation handles ${scenario.name} novelty with bounded repair and durable outcomes`,
      async ({ databases, expect }) => {
        const f = await pageTransformFixture(databases);
        const content = (prompt: string): MaterialContentInput =>
          kind === 'quiz'
            ? {
                kind,
                questions: [
                  {
                    kind: 'open',
                    prompt,
                    explanation: 'ATP carries energy [1]',
                    referenceAnswer: 'ATP'
                  }
                ]
              }
            : { kind, cards: [{ front: prompt, back: 'ATP carries energy [1]' }] };

        try {
          const request = await Effect.runPromise(
            Effect.gen(function* () {
              const project = yield* (yield* Projects).createProject({ name: 'Cells' });
              const page = yield* (yield* Pages).create({
                createKey: crypto.randomUUID(),
                projectId: project.id,
                title: 'Energy',
                inputs: [],
                citations: [],
                document: {
                  blocks: [
                    plainBlock('paragraph', 'ATP carries energy. ADP has two phosphate groups.', {
                      type: 'authored'
                    })
                  ],
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
              const inputs = [{ kind: 'page' as const, versionId: page.version!.id }];
              const materials = yield* Materials;

              yield* materials.create({
                projectId: project.id,
                title: 'Older exercise',
                publish: true,
                inputs,
                content: content('What carries energy?')
              });

              return yield* materials.requestMaterialGeneration({
                projectId: project.id,
                title: 'Fresh exercise',
                kind,
                inputs
              });
            }).pipe(Effect.provide(f.domain()))
          );

          f.replies.push(
            { kind: 'output', output: '{"focus":["Explore ADP phosphate groups"]}' },
            { kind: 'sources', query: 'ATP' },
            {
              kind: 'output',
              output: JSON.stringify(content(scenario.candidate))
            },
            {
              kind: 'output',
              output: JSON.stringify({
                duplicates: scenario.review
              })
            },
            { kind: 'sources', query: 'ADP' },
            {
              kind: 'output',
              output: JSON.stringify(content(scenario.repair))
            },
            { kind: 'output', output: '{"duplicates":[]}' }
          );
          const event = f.event(request.id);

          if (scenario.failure) {
            await expect(f.execute(event, request.id)).rejects.toMatchObject({
              kind: scenario.failure
            });
            const state = await Effect.runPromise(
              Effect.flatMap(Materials, (m) =>
                m.materialGeneration({ requestId: request.id, verifyOnly: true })
              ).pipe(Effect.provide(f.domain()))
            );

            expect(state.resultVersionId).toBeNull();
            expect(state.errorKind).toBe(scenario.failure);
            expect(f.bodies).toHaveLength(scenario.calls);
            const calls = f.bodies.length;

            await f.reopen();
            await expect(f.execute(event, request.id)).rejects.toMatchObject({
              kind: state.errorKind
            });
            expect(f.bodies).toHaveLength(calls);

            return;
          }

          const versionId = await f.execute(event, request.id);
          const result = await Effect.runPromise(
            Effect.flatMap(Materials, (m) => m.materialVersion({ id: versionId })).pipe(
              Effect.provide(f.domain())
            )
          );

          const prompt =
            result.content.kind === 'quiz'
              ? result.content.questions[0]!.prompt
              : result.content.cards[0]!.front;

          expect(prompt).toContain('How many phosphate groups');
          const calls = f.bodies.length;

          await f.reopen();
          expect(await f.execute(event, request.id)).toBe(versionId);
          expect(f.bodies).toHaveLength(calls);
        } finally {
          await f.close();
        }
      }
    );
  }
}
