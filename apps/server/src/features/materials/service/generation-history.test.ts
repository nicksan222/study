import { plainBlock } from '@study/contracts';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { Projects } from '#server/features/projects/index';
import { acceptHistory } from '#testing/material-history';
import { pageTransformFixture } from '#testing/page-transform';

test.server.stable(
  'generation history selects only published matching material in the project with overlapping inputs',
  async ({ databases, expect }) => {
    const f = await pageTransformFixture(databases);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials;
          const projects = yield* Projects;
          const project = yield* projects.createProject({ name: 'Biology' });
          const other = yield* projects.createProject({ name: 'Private other project' });
          const page = yield* (yield* Pages).create({
            createKey: crypto.randomUUID(),
            projectId: project.id,
            title: 'Cells',
            inputs: [],
            citations: [],
            document: {
              blocks: [
                plainBlock('paragraph', 'ATP carries energy in cells.', { type: 'authored' })
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
          const save = (
            title: string,
            projectId: typeof project.id,
            publish: boolean,
            overlap = true
          ) =>
            materials.create({
              title,
              projectId,
              publish,
              inputs: overlap ? inputs : [],
              content: { kind: 'flashcards', cards: [{ front: title, back: 'Answer' }] }
            });
          const retained = yield* save('ATP', project.id, true);

          yield* save('Draft', project.id, false);
          yield* save('Different inputs', project.id, true, false);
          yield* (yield* Pages).attachProject({ pageId: page.id, projectId: other.id });
          yield* save('Other project', other.id, true);
          yield* materials.create({
            title: 'Different exercise kind',
            projectId: project.id,
            publish: true,
            inputs,
            content: {
              kind: 'quiz',
              questions: [
                {
                  kind: 'open',
                  prompt: 'Other kind',
                  referenceAnswer: 'ATP',
                  explanation: 'Answer'
                }
              ]
            }
          });
          const request = yield* materials.requestMaterialGeneration({
            projectId: project.id,
            title: 'Fresh cards',
            kind: 'flashcards',
            inputs
          });
          const history = yield* materials.materialGenerationHistory({ requestId: request.id });

          expect(history.items.map(({ prompt }) => prompt)).toEqual(['ATP']);
          expect(history.items[0]?.versionId).toBe(retained.version.id);
          expect(history.limited).toBe(false);
          yield* materials.createVersion({
            materialId: retained.id,
            publish: true,
            inputs,
            content: { kind: 'flashcards', cards: [{ front: 'ADP', back: 'Updated exercise' }] }
          });
          const latest = yield* materials.materialGenerationHistory({ requestId: request.id });

          expect(latest.items.map(({ prompt }) => prompt)).toEqual(['ADP']);
          const snapshot = { versions: [retained.version.id], limited: false };
          const captured = yield* materials.materialGenerationHistory({
            requestId: request.id,
            snapshot
          });

          expect(captured.items.map(({ prompt }) => prompt)).toEqual(['ATP']);
          yield* Effect.promise(() => acceptHistory(f, retained.id, 'comparison-retirement'));
          const retired = yield* materials.materialGenerationHistory({
            requestId: request.id,
            snapshot
          });

          expect(retired).toEqual({ items: [], limited: true });
          yield* materials.create({
            title: 'Large old deck',
            projectId: project.id,
            publish: true,
            inputs,
            content: {
              kind: 'flashcards',
              cards: Array.from({ length: 101 }, (_, index) => ({
                front: `Earlier exercise ${index}`,
                back: 'Answer'
              }))
            }
          });
          const bounded = yield* materials.materialGenerationHistory({ requestId: request.id });

          expect(bounded.items).toHaveLength(100);
          expect(bounded.limited).toBe(true);
          yield* materials.create({
            title: 'Long Unicode prompts',
            projectId: project.id,
            publish: true,
            inputs,
            content: {
              kind: 'flashcards',
              cards: Array.from({ length: 30 }, (_, index) => ({
                front: `${'学'.repeat(300)}${index}`,
                back: 'Answer'
              }))
            }
          });
          const bytes = yield* materials.materialGenerationHistory({ requestId: request.id });

          expect(
            new TextEncoder().encode(
              JSON.stringify(bytes.items.map(({ prompt, key }) => ({ prompt, key })))
            ).length
          ).toBeLessThan(24000);
          expect(bytes.limited).toBe(true);
          yield* materials.cancelMaterialGeneration({ requestId: request.id });
          const error = yield* Effect.flip(
            materials.materialGenerationHistory({ requestId: request.id })
          );

          expect(error.kind).toBe('cancelled');
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);
