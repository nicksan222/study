/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Supports scoped semantic retrieval through canonical contracts and real            │
 * │ integration checks.                                                                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves canonical identities and validates bounded search capability behavior.       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature projections own content visibility and runtime registration remains an explicit  │
 * │ caller decision.                                                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { projectIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { Effect, Schema } from 'effect';
import { expect } from 'vite-plus/test';

import { makeSearchTools } from './search-tool.ts';
import { adaptTool } from './tool-adapter.ts';

testStable(
  'agent adapter serializes canonical bigint identities without losing precision',
  async () => {
    const id = Schema.decodeUnknownSync(projectIdSchema)(9007199254740993n);
    const tools = makeSearchTools(
      {
        catalog: () => Effect.succeed([]),
        search: () =>
          Effect.succeed([
            {
              target: { type: 'project', id },
              title: 'Planets',
              text: 'Orbital science',
              distance: 0.1
            }
          ])
      },
      { type: 'all' }
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const span = yield* Effect.currentSpan;
        const adapted = adaptTool(
          tools.search,
          { language: 'en', searchSources: () => Effect.succeed([]) },
          span,
          {},
          context
        );
        const result = yield* Effect.promise(async () =>
          adapted.execute!({ query: 'orbit' }, { toolCallId: 'search-1', messages: [] })
        );

        expect(JSON.parse(JSON.stringify(result))).toMatchObject([
          { target: { type: 'project', id: '9007199254740993' } }
        ]);
      }).pipe(Effect.withSpan('agent-search-test'))
    );
  }
);
