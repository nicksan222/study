import { defaultAgentRules } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies durable suggestions against real persistence and native RPC.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises combined evidence, checkpoint reuse, model selection and stale results.      │
 * │ - Checks note deletion scrubbing and authentication failures through live RPC.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use temporary SQLite databases and typed model fixtures; no external model is      │
 * │ called.                                                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { sql } from '@study/db';
import {
  agentsLayer,
  ServerContext,
  Database,
  normalizeError,
  WorkflowConfiguration,
  workflowEngineLayer,
  dispatchPending
} from '@study/server';
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';
import type { Context } from 'effect';

import { titleAgent } from '#server/features/notes/agents/title';
import { Notes } from '#server/features/notes/service/index';
import { suggestTransformField } from '#server/features/notes/service/transform-suggestion';
import { Pages } from '#server/features/pages/index';
import { Settings } from '#server/features/settings/index';
import { deletionDocument } from '#testing/material-deletion';
import { withTestPublication } from '#testing/publication';

import { transformSuggestionRegistration } from './transform-suggestion.ts';

test.server.stable(
  'transform suggestions use saved combined context, tiny models, checkpoint results and reject changed evidence',
  async ({ resources: location, createAiMock, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const context = new ServerContext(await location.openDb());
    let calls = 0;
    const tiers: string[] = [];
    using mock = createAiMock();
    const domain = () =>
      Layer.mergeAll(Notes.layer, Settings.layer, Pages.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const services = ({
      assert: assertions,
      expect
    }: Pick<test.server.Context, 'assert' | 'expect'>) => {
      const assert: test.Assert = assertions;

      return Layer.mergeAll(
        domain(),
        Layer.succeed(Database, { store: context }),
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
        agentsLayer({
          model: (tier, call) => {
            tiers.push(tier);
            assert.ok(
              'instructions' in call.definition && typeof call.definition.instructions === 'string'
            );
            expect(call.definition.instructions).toContain('Italian');
            expect(call.definition.instructions).toContain(
              tiers.length === 2 ? 'transformation instructions' : 'Write a concise Page title'
            );

            calls++;

            return mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError));
          },
          language: Effect.succeed('en'),
          rules: Effect.succeed(defaultAgentRules),
          searchSources: () => Effect.succeed([])
        }),
        workflowEngineLayer(context)
      );
    };
    const run = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | Database
        | Context.Service.Identifier<typeof Pages>
        | Context.Service.Identifier<typeof Notes>
        | Context.Service.Identifier<typeof Settings>
      >
    ) => Effect.runPromise(effect.pipe(Effect.provide(domain())));

    try {
      const first = await run(Effect.flatMap(Notes, (c) => c.createNote({ title: 'Cells' })));
      const second = await run(Effect.flatMap(Notes, (c) => c.createNote({ title: 'Plants' })));
      const source = await run(
        Effect.flatMap(Pages, (docs) =>
          docs.create({
            title: 'Cell reference',
            inputs: [],
            citations: [],
            createKey: crypto.randomUUID(),
            document: deletionDocument('Chromosomes carry genetic information.')
          })
        )
      );

      await run(
        Effect.flatMap(Pages, (docs) => docs.attach({ noteId: second.id, pageId: source.id }))
      );
      const message = await run(
        Effect.flatMap(Notes, (c) =>
          c.postMessage({ noteId: first.id, text: 'Mitosis produces two daughter cells.' })
        )
      );

      await run(
        Effect.flatMap(Notes, (c) =>
          c.postMessage({ noteId: second.id, text: 'Chloroplasts capture light.' })
        )
      );
      const execute = (
        { assert: assertions, expect }: Pick<test.server.Context, 'assert' | 'expect'>,
        field: 'title' | 'instruction',
        intentKey: string,
        noteId = first.id,
        additionalNoteIds = [second.id]
      ) => {
        const assert: test.Assert = assertions;

        return Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              return yield* suggestTransformField({
                noteId,
                additionalNoteIds,
                intentKey,
                field,
                language: 'italian'
              });
            }).pipe(
              Effect.provide(
                transformSuggestionRegistration.layer.pipe(
                  Layer.provideMerge(services({ assert, expect }))
                )
              )
            )
          )
        );
      };
      const empty = await run(Effect.flatMap(Notes, (c) => c.createNote({ title: 'Empty' })));

      await expect(
        execute({ assert, expect }, 'title', 'empty', empty.id, [])
      ).rejects.toMatchObject({
        kind: 'invalid_input'
      });
      const input = (text = 'Mitosis produces two daughter cells.') => ({
        prompt: JSON.stringify({
          notes: ['Plants'],
          messages: [
            { role: 'user', text },
            { role: 'user', text: 'Chloroplasts capture light.' }
          ],
          sources: [
            { name: 'Cell reference', passages: ['Chromosomes carry genetic information.'] }
          ]
        })
      });

      mock.next(titleAgent, { input: input(), output: 'Cell Biology' });
      assert.strictEqual(calls, 0);
      assert.strictEqual(await execute({ assert, expect }, 'title', 'title-one'), 'Cell Biology');
      assert.strictEqual(
        await Effect.runPromise(
          dispatchPending(context, transformSuggestionRegistration.triggers, Date.now()).pipe(
            Effect.provide(workflowEngineLayer(context))
          )
        ),
        1
      );
      assert.strictEqual(await execute({ assert, expect }, 'title', 'title-one'), 'Cell Biology');
      assert.strictEqual(calls, 1);
      assert.deepEqual(tiers, ['tiny']);
      assert.strictEqual(
        (await run(Effect.flatMap(Notes, (c) => c.note(first.id)))).title,
        'Cells'
      );
      const output = 'Explain how cells divide and compare their structures.';

      mock.next(titleAgent, { input: input(), output });
      assert.strictEqual(
        await execute({ assert, expect }, 'instruction', 'instruction-one'),
        output
      );
      assert.strictEqual(calls, 2);
      const stalePlan = mock.next(titleAgent, { input: input(), output, hold: true });
      const staleExecution = execute({ assert, expect }, 'title', 'stale');
      const staleResult = staleExecution.catch((error: unknown) => error);

      await stalePlan.called;
      await run(
        Effect.flatMap(Notes, (c) =>
          c.editMessage({ messageId: message.id, text: 'The saved material changed.' })
        )
      );
      stalePlan.release();
      expect(await staleResult).toMatchObject({ kind: 'invalid_input' });
      mock.next(titleAgent, {
        input: input('The saved material changed.'),
        output: '🌱'.repeat(101)
      });
      await expect(execute({ assert, expect }, 'title', 'too-long')).rejects.toMatchObject({
        kind: 'transient'
      });
      const owned = context.db.orm.all<{ execution_id: string }>(sql`
        SELECT execution_id FROM workflow_executions WHERE workflow_tag = 'transform-suggestion/v1'
          AND json_extract(payload, '$.event.noteId') = ${String(first.id)}
      `);

      assert.strictEqual(owned.length, 4);
      const deletion = await run(Effect.flatMap(Notes, (c) => c.deleteNote(second.id)));

      await run(
        Effect.flatMap(Notes, (c) =>
          withTestPublication(
            context,
            c.finishNoteDeletion({ noteId: second.id, attempt: deletion.attempt })
          )
        )
      );

      for (const row of owned) {
        const retained = context.db.orm.get<{ result: string | null }>(sql`
          SELECT result FROM workflow_executions WHERE execution_id = ${row.execution_id}
        `);

        assert.ok(retained);
        assert.strictEqual(retained.result, null);
      }
    } finally {
      context.close();
    }
  }
);

test.server.stable(
  'live suggestion RPC uses the worker engine and returns sign-in errors without hanging',
  async ({ rpc, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const note = await rpc.runPromise(rpc.client['notes.createNote']({ title: 'Biology' }));

    await rpc.runPromise(
      rpc.client['notes.postMessage']({
        noteId: note.id,
        text: 'Cells divide.'
      })
    );
    const error = await rpc.runPromise(
      Effect.flip(
        rpc.client['notes.suggestTransformField']({
          noteId: note.id,
          intentKey: crypto.randomUUID(),
          field: 'title',
          language: 'english'
        })
      )
    );

    assert.ok('kind' in error);
    assert.strictEqual(error.kind, 'auth');
  }
);
