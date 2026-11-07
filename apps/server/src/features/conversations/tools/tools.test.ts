/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes schema-checked settings capabilities and their agent-facing usage          │
 * │ guides.                                                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reuses Settings service reads and writes with validated partial updates.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature services retain persistence policy; the agent runner provides dependencies and   │
 * │ tool execution.                                                                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defaultAgentRules } from '@study/contracts/settings/types';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Schema } from 'effect';
import { expect } from 'vite-plus/test';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { settingsTools } from './settings.ts';
import { subjectTools } from './subjects.ts';

const environment = { language: 'en', searchSources: () => Effect.succeed([]) };

testStable(
  'settings patches preserve unrelated preferences and reject values outside canonical bounds',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const before = yield* settingsTools.read_settings.execute({}, environment);
          const updated = yield* settingsTools.update_general_settings.execute(
            { appearance: 1 },
            environment
          );

          expect(updated).toStrictEqual({ ...before.general, appearance: 1 });
          yield* settingsTools.update_custom_instructions.execute(
            {
              documents: 'Include worked examples.'
            },
            environment
          );
          const after = yield* settingsTools.read_settings.execute({}, environment);

          expect(after.general).toStrictEqual(updated);
          expect(after.instructions).toStrictEqual({
            ...defaultAgentRules,
            documents: 'Include worked examples.'
          });
          expect(Schema.is(settingsTools.update_general_settings.input)({ zoomPercent: 999 })).toBe(
            false
          );
          expect(
            Schema.is(settingsTools.update_general_settings.input)({ appearance: 'dark' })
          ).toBe(false);
          expect(
            Schema.is(settingsTools.update_custom_instructions.input)({ replies: 'a'.repeat(8001) })
          ).toBe(false);
        }).pipe(Effect.provideService(Database, { store: context }))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'subject creation reuses exact names and branded IDs round-trip through JSON tool schemas',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const subject = yield* subjectTools.create_subject.execute(
            { name: '  Biology  ' },
            environment
          );
          const repeated = yield* subjectTools.create_subject.execute(
            { name: 'Biology' },
            environment
          );

          expect(repeated.id).toBe(subject.id);
          expect(
            (yield* subjectTools.list_subjects.execute({ limit: 100 }, environment)).items
          ).toHaveLength(1);
          const codec = Schema.toCodecJson(subjectTools.read_subject.input);
          const decoded = yield* Schema.decodeUnknownEffect(codec)({ id: String(subject.id) });

          expect(decoded.id).toBe(subject.id);
          expect(
            yield* subjectTools.set_subject_exam.execute(
              { id: decoded.id, examOn: '2027-01-20' },
              environment
            )
          ).toBe(true);
          expect((yield* subjectTools.read_subject.execute(decoded, environment)).examOn).toBe(
            '2027-01-20'
          );
          const encoded = yield* Schema.encodeUnknownEffect(
            Schema.toCodecJson(subjectTools.create_subject.output)
          )(subject);

          expect(JSON.stringify(encoded)).toContain(String(subject.id));
          // @ts-expect-error tool inputs retain canonical branded IDs
          subjectTools.read_subject.execute({ id: '1' }, environment);
        }).pipe(Effect.provideService(Database, { store: context }))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
