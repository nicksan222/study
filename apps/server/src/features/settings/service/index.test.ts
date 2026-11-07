/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks settings defaults, updates, model validation, and transactional rollback    │
 * │ against SQLite.                                                                          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises settings defaults, updates, model selection and rollback use SQLite.         │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { quizSettingsSchema } from '@study/contracts/settings/schemas';
import {
  defaultQuizSettings,
  defaultAgentRules,
  defaultWorkspacePreferences,
  Appearance,
  Language,
  LlmModel,
  LlmProvider
} from '@study/contracts/settings/types';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

testStable('settings defaults, updates, model selection and rollback use SQLite', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Settings.layer.pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;

        expect(yield* settings.quizSettings()).toStrictEqual(defaultQuizSettings);
        const quiz = {
          ...defaultQuizSettings,
          questionCount: 3,
          questionOrder: 'shuffle' as const,
          shuffleChoices: false,
          questionKind: 'open' as const,
          practice: { matching: { questionCount: 4, difficulty: 'challenging' as const } }
        };

        yield* settings.saveQuizSettings(quiz);
        expect(yield* settings.quizSettings()).toStrictEqual(quiz);
        assert.strictEqual(
          (yield* Effect.flip(settings.saveQuizSettings({ ...quiz, questionCount: 0 }))).kind,
          'invalid_input'
        );
        expect(yield* settings.quizSettings()).toStrictEqual(quiz);
        const invalidPractice = yield* Effect.flip(
          settings.saveQuizSettings({
            ...quiz,
            practice: { matching: { questionCount: 11, difficulty: 'easy' } }
          })
        );

        expect(invalidPractice.kind).toBe('invalid_input');
        expect(yield* settings.quizSettings()).toStrictEqual(quiz);

        expect(yield* settings.appSettings()).toStrictEqual({
          language: Language.ENGLISH,
          appearance: Appearance.DARK,
          zoomPercent: 100,
          onboarded: false
        });
        expect(yield* settings.sidebarSettings()).toStrictEqual({ settledDocumentThreshold: 1 });
        yield* settings.saveSidebarSettings({ settledDocumentThreshold: 3 });
        expect(yield* settings.sidebarSettings()).toStrictEqual({ settledDocumentThreshold: 3 });
        const invalidSidebar = yield* Effect.flip(
          settings.saveSidebarSettings({ settledDocumentThreshold: 0 })
        );

        assert.ok(invalidSidebar.kind === 'invalid_input');
        expect(yield* settings.sidebarSettings()).toStrictEqual({ settledDocumentThreshold: 3 });
        expect(yield* settings.materialSettings()).toStrictEqual({ sift: true });
        expect(yield* settings.reviewSettings()).toStrictEqual({ newCardsPerDay: 20 });
        assert.strictEqual(yield* settings.language(), 'english');
        assert.strictEqual(yield* settings.model('tiny'), 'gpt-6-luna');
        assert.strictEqual(yield* settings.model('medium'), 'gpt-6.1-sol');
        assert.strictEqual(yield* settings.model('smart'), 'gpt-6-astra');
        const app = {
          language: Language.ITALIAN,
          appearance: Appearance.LIGHT,
          zoomPercent: 125,
          onboarded: true
        };

        yield* settings.saveAppSettings(app);
        expect(yield* settings.appSettings()).toStrictEqual(app);
        assert.strictEqual(yield* settings.language(), 'italian');
        yield* settings.saveAppSettings({ ...app, appearance: Appearance.SYSTEM });
        assert.strictEqual((yield* settings.appSettings()).appearance, Appearance.SYSTEM);
        yield* settings.saveAppSettings(app);
        const llm = {
          tiny: { provider: LlmProvider.CHAT_GPT, model: LlmModel.GPT6_ASTRA },
          medium: { provider: LlmProvider.CHAT_GPT },
          smart: { provider: LlmProvider.CHAT_GPT }
        };

        yield* settings.saveLlmSettings(llm);
        expect(yield* settings.llmSettings()).toStrictEqual({
          ...llm,
          medium: { ...llm.medium, model: undefined },
          smart: { ...llm.smart, model: undefined }
        });
        assert.strictEqual(yield* settings.model('tiny'), 'gpt-6-astra');
        yield* settings.saveMaterialSettings({ sift: false });
        yield* settings.saveReviewSettings({ newCardsPerDay: 42 });
        expect(yield* settings.materialSettings()).toStrictEqual({ sift: false });
        expect(yield* settings.reviewSettings()).toStrictEqual({ newCardsPerDay: 42 });
        const invalid = yield* Effect.flip(settings.saveAppSettings({ ...app, zoomPercent: 10 }));

        assert.ok(invalid.kind === 'invalid_input');
        expect(yield* settings.appSettings()).toStrictEqual(app);
        context.db.orm.run(
          sql`CREATE TRIGGER reject_app BEFORE INSERT ON preferences WHEN NEW.scope = 'app' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
        );
        yield* Effect.flip(settings.saveAppSettings({ ...app, zoomPercent: 150 }));
        expect(yield* settings.appSettings()).toStrictEqual(app);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable(
  'appearance controls persist bounded preferences independently of app settings',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Settings.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;

          expect(yield* settings.appearancePreferences()).toStrictEqual({
            contrast: 100,
            glassOpacity: 80,
            animationDurationMs: 150
          });
          yield* settings.saveAppearancePreferences({
            contrast: 115,
            glassOpacity: 90,
            animationDurationMs: 0
          });
          expect(yield* settings.appearancePreferences()).toStrictEqual({
            contrast: 115,
            glassOpacity: 90,
            animationDurationMs: 0
          });
          const invalid = yield* Effect.flip(
            settings.saveAppearancePreferences({
              contrast: 999,
              glassOpacity: 90,
              animationDurationMs: 0
            })
          );

          assert.ok(invalid.kind === 'invalid_input');
          assert.strictEqual((yield* settings.appearancePreferences()).contrast, 115);
          assert.strictEqual((yield* settings.appSettings()).zoomPercent, 100);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'concurrency settings persist and reject invalid limits without changing saved capacity',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Settings.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;

          expect(yield* settings.concurrencySettings()).toStrictEqual({
            maxConcurrentAi: 2,
            maxQueuedAi: 16
          });
          yield* settings.saveConcurrencySettings({ maxConcurrentAi: 8, maxQueuedAi: 0 });
          expect(yield* settings.concurrencySettings()).toStrictEqual({
            maxConcurrentAi: 8,
            maxQueuedAi: 0
          });

          for (const invalid of [
            { maxConcurrentAi: 0, maxQueuedAi: 16 },
            { maxConcurrentAi: 9, maxQueuedAi: 16 },
            { maxConcurrentAi: 1.5, maxQueuedAi: 16 },
            { maxConcurrentAi: 2, maxQueuedAi: -1 },
            { maxConcurrentAi: 2, maxQueuedAi: 65 }
          ])
            assert.ok(
              (yield* Effect.flip(settings.saveConcurrencySettings(invalid))).kind ===
                'invalid_input'
            );

          expect(yield* settings.concurrencySettings()).toStrictEqual({
            maxConcurrentAi: 8,
            maxQueuedAi: 0
          });
          assert.strictEqual((yield* settings.appSettings()).zoomPercent, 100);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'workspace preferences persist in SQLite, merge new defaults and reject invalid updates',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Settings.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;

          expect(yield* settings.workspacePreferences()).toStrictEqual(defaultWorkspacePreferences);
          const saved = {
            ...defaultWorkspacePreferences,
            autosaveIntervalSeconds: 8,
            defaultAiDetail: 'detailed' as const,
            spellcheck: false,
            autoTitleSessions: true
          };

          yield* settings.saveWorkspacePreferences(saved);
          expect(yield* settings.workspacePreferences()).toStrictEqual(saved);

          for (const invalid of [
            { ...saved, autosaveIntervalSeconds: 0 },
            { ...saved, autosaveIntervalSeconds: 31 },
            { ...saved, autosaveIntervalSeconds: 1.5 },
            { ...saved, editorFontSize: 13 },
            { ...saved, readerFontSize: 25 }
          ])
            assert.ok(
              (yield* Effect.flip(settings.saveWorkspacePreferences(invalid))).kind ===
                'invalid_input'
            );

          expect(yield* settings.workspacePreferences()).toStrictEqual(saved);
          context.db.orm.run(
            sql`DELETE FROM preferences WHERE scope = 'workspace' AND key = 'spellcheck'`
          );
          expect(yield* settings.workspacePreferences()).toStrictEqual({
            ...saved,
            spellcheck: true
          });
          context.db.orm.run(
            sql`UPDATE preferences SET value = '999' WHERE scope = 'workspace' AND key = 'editorFontSize'`
          );
          expect(yield* settings.workspacePreferences()).toStrictEqual(defaultWorkspacePreferences);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable('older quiz preferences receive generation defaults during decoding', () => {
  const previous = {
    questionCount: 3,
    questionOrder: 'source',
    shuffleChoices: true,
    questionKind: 'choice'
  };

  expect(Schema.decodeUnknownSync(quizSettingsSchema)(previous)).toEqual({
    ...previous,
    choiceCount: 4,
    difficulty: 'balanced'
  });
});

testStable(
  'agent rules persist, merge missing fields and reject oversized updates atomically',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Settings.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;

          expect(yield* settings.agentRules()).toStrictEqual(defaultAgentRules);
          const rules = {
            ...defaultAgentRules,
            documents: 'Use descriptive headings.',
            titles: 'Use Italian titles.'
          };

          yield* settings.saveAgentRules(rules);
          expect(yield* settings.agentRules()).toStrictEqual(rules);
          expect(
            (yield* Effect.flip(settings.saveAgentRules({ ...rules, documents: 'x'.repeat(8001) })))
              .kind
          ).toBe('invalid_input');
          expect(yield* settings.agentRules()).toStrictEqual(rules);
          context.db.orm.run(
            sql`DELETE FROM preferences WHERE scope = 'agent-rules' AND key = 'quizzes'`
          );
          expect(yield* settings.agentRules()).toStrictEqual(rules);
          yield* settings.saveAgentRules(defaultAgentRules);
          expect(yield* settings.agentRules()).toStrictEqual(defaultAgentRules);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
