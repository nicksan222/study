import { quizSettingsSchema } from '@study/contracts';
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
import {
  defaultQuizSettings,
  defaultAgentRules,
  defaultWorkspacePreferences,
  Appearance,
  Language,
  LlmModel,
  LlmProvider
} from '@study/contracts';
import { sql } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer, Schema } from 'effect';

import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

test.stable(
  'settings defaults, updates, model selection and rollback use SQLite',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Settings.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;

          test.expect(yield* settings.quizSettings()).toStrictEqual(defaultQuizSettings);
          const quiz = {
            ...defaultQuizSettings,
            questionCount: 3,
            questionOrder: 'shuffle' as const,
            shuffleChoices: false,
            questionKind: 'open' as const,
            practice: { matching: { questionCount: 4, difficulty: 'challenging' as const } }
          };

          yield* settings.saveQuizSettings(quiz);
          test.expect(yield* settings.quizSettings()).toStrictEqual(quiz);
          test.assert.strictEqual(
            (yield* Effect.flip(settings.saveQuizSettings({ ...quiz, questionCount: 0 }))).kind,
            'invalid_input'
          );
          test.expect(yield* settings.quizSettings()).toStrictEqual(quiz);
          const invalidPractice = yield* Effect.flip(
            settings.saveQuizSettings({
              ...quiz,
              practice: { matching: { questionCount: 11, difficulty: 'easy' } }
            })
          );

          test.expect(invalidPractice.kind).toBe('invalid_input');
          test.expect(yield* settings.quizSettings()).toStrictEqual(quiz);

          test.expect(yield* settings.appSettings()).toStrictEqual({
            language: Language.ENGLISH,
            appearance: Appearance.DARK,
            zoomPercent: 100,
            onboarded: false
          });
          test.expect(yield* settings.sidebarSettings()).toStrictEqual({ settledPageThreshold: 1 });
          yield* settings.saveSidebarSettings({ settledPageThreshold: 3 });
          test.expect(yield* settings.sidebarSettings()).toStrictEqual({ settledPageThreshold: 3 });
          const invalidSidebar = yield* Effect.flip(
            settings.saveSidebarSettings({ settledPageThreshold: 0 })
          );

          test.assert.ok(invalidSidebar.kind === 'invalid_input');
          test.expect(yield* settings.sidebarSettings()).toStrictEqual({ settledPageThreshold: 3 });
          test.expect(yield* settings.materialSettings()).toStrictEqual({ sift: true });
          test.expect(yield* settings.reviewSettings()).toStrictEqual({ newCardsPerDay: 20 });
          test.assert.strictEqual(yield* settings.language(), 'english');
          test
            .expect(yield* settings.model('tiny'))
            .toStrictEqual({ provider: 1, modelId: 'gpt-6-luna' });
          test.expect(yield* settings.model('medium')).toStrictEqual({
            provider: 1,
            modelId: 'gpt-6.1-sol'
          });
          test.expect(yield* settings.model('smart')).toStrictEqual({
            provider: 1,
            modelId: 'gpt-6-astra'
          });
          const app = {
            language: Language.ITALIAN,
            appearance: Appearance.LIGHT,
            zoomPercent: 125,
            onboarded: true
          };

          yield* settings.saveAppSettings(app);
          test.expect(yield* settings.appSettings()).toStrictEqual(app);
          test.assert.strictEqual(yield* settings.language(), 'italian');
          yield* settings.saveAppSettings({ ...app, appearance: Appearance.SYSTEM });
          test.assert.strictEqual((yield* settings.appSettings()).appearance, Appearance.SYSTEM);
          yield* settings.saveAppSettings(app);
          const llm = {
            tiny: { provider: LlmProvider.CHAT_GPT, model: LlmModel.GPT6_ASTRA },
            medium: { provider: LlmProvider.CHAT_GPT },
            smart: { provider: LlmProvider.CHAT_GPT }
          };

          yield* settings.saveLlmSettings(llm);
          test.expect(yield* settings.llmSettings()).toStrictEqual(llm);
          test.expect(yield* settings.model('tiny')).toStrictEqual({
            provider: 1,
            modelId: 'gpt-6-astra'
          });
          yield* settings.saveMaterialSettings({ sift: false });
          yield* settings.saveReviewSettings({ newCardsPerDay: 42 });
          test.expect(yield* settings.materialSettings()).toStrictEqual({ sift: false });
          test.expect(yield* settings.reviewSettings()).toStrictEqual({ newCardsPerDay: 42 });
          const invalid = yield* Effect.flip(settings.saveAppSettings({ ...app, zoomPercent: 10 }));

          test.assert.ok(invalid.kind === 'invalid_input');
          test.expect(yield* settings.appSettings()).toStrictEqual(app);
          context.db.orm.run(
            sql`CREATE TRIGGER reject_app BEFORE INSERT ON preferences WHEN NEW.scope = 'app' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
          );
          yield* Effect.flip(settings.saveAppSettings({ ...app, zoomPercent: 150 }));
          test.expect(yield* settings.appSettings()).toStrictEqual(app);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'appearance controls persist bounded preferences independently of app settings',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Settings.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;

          test.expect(yield* settings.appearancePreferences()).toStrictEqual({
            contrast: 100,
            glassOpacity: 80,
            animationDurationMs: 150
          });
          yield* settings.saveAppearancePreferences({
            contrast: 115,
            glassOpacity: 90,
            animationDurationMs: 0
          });
          test.expect(yield* settings.appearancePreferences()).toStrictEqual({
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

          test.assert.ok(invalid.kind === 'invalid_input');
          test.assert.strictEqual((yield* settings.appearancePreferences()).contrast, 115);
          test.assert.strictEqual((yield* settings.appSettings()).zoomPercent, 100);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'concurrency settings persist and reject invalid limits without changing saved capacity',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Settings.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;

          test.expect(yield* settings.concurrencySettings()).toStrictEqual({
            maxConcurrentAi: 2,
            maxQueuedAi: 16
          });
          yield* settings.saveConcurrencySettings({ maxConcurrentAi: 8, maxQueuedAi: 0 });
          test.expect(yield* settings.concurrencySettings()).toStrictEqual({
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
            test.assert.ok(
              (yield* Effect.flip(settings.saveConcurrencySettings(invalid))).kind ===
                'invalid_input'
            );

          test.expect(yield* settings.concurrencySettings()).toStrictEqual({
            maxConcurrentAi: 8,
            maxQueuedAi: 0
          });
          test.assert.strictEqual((yield* settings.appSettings()).zoomPercent, 100);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'workspace preferences persist in SQLite, merge new defaults and reject invalid updates',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Settings.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;

          test
            .expect(yield* settings.workspacePreferences())
            .toStrictEqual(defaultWorkspacePreferences);
          const saved = {
            ...defaultWorkspacePreferences,
            autosaveIntervalSeconds: 8,
            defaultAiDetail: 'detailed' as const,
            spellcheck: false,
            autoTitleNotes: true
          };

          yield* settings.saveWorkspacePreferences(saved);
          test.expect(yield* settings.workspacePreferences()).toStrictEqual(saved);

          for (const invalid of [
            { ...saved, autosaveIntervalSeconds: 0 },
            { ...saved, autosaveIntervalSeconds: 31 },
            { ...saved, autosaveIntervalSeconds: 1.5 },
            { ...saved, editorFontSize: 13 },
            { ...saved, readerFontSize: 25 }
          ])
            test.assert.ok(
              (yield* Effect.flip(settings.saveWorkspacePreferences(invalid))).kind ===
                'invalid_input'
            );

          test.expect(yield* settings.workspacePreferences()).toStrictEqual(saved);
          context.db.orm.run(
            sql`DELETE FROM preferences WHERE scope = 'workspace' AND key = 'spellcheck'`
          );
          test.expect(yield* settings.workspacePreferences()).toStrictEqual({
            ...saved,
            spellcheck: true
          });
          context.db.orm.run(
            sql`UPDATE preferences SET value = '999' WHERE scope = 'workspace' AND key = 'editorFontSize'`
          );
          test
            .expect(yield* settings.workspacePreferences())
            .toStrictEqual(defaultWorkspacePreferences);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable('older quiz preferences receive generation defaults during decoding', () => {
  const previous = {
    questionCount: 3,
    questionOrder: 'source',
    shuffleChoices: true,
    questionKind: 'choice'
  };

  test.expect(Schema.decodeUnknownSync(quizSettingsSchema)(previous)).toEqual({
    ...previous,
    choiceCount: 4,
    difficulty: 'balanced'
  });
});

test.stable(
  'agent rules persist, merge missing fields and reject oversized updates atomically',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Settings.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;

          test.expect(yield* settings.agentRules()).toStrictEqual(defaultAgentRules);
          const rules = {
            ...defaultAgentRules,
            pages: 'Use descriptive headings.',
            titles: 'Use Italian titles.'
          };

          yield* settings.saveAgentRules(rules);
          test.expect(yield* settings.agentRules()).toStrictEqual(rules);
          test
            .expect(
              (yield* Effect.flip(settings.saveAgentRules({ ...rules, pages: 'x'.repeat(8001) })))
                .kind
            )
            .toBe('invalid_input');
          test.expect(yield* settings.agentRules()).toStrictEqual(rules);
          context.db.orm.run(
            sql`DELETE FROM preferences WHERE scope = 'agent-rules' AND key = 'quizzes'`
          );
          test.expect(yield* settings.agentRules()).toStrictEqual(rules);
          yield* settings.saveAgentRules(defaultAgentRules);
          test.expect(yield* settings.agentRules()).toStrictEqual(defaultAgentRules);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'registered provider models round-trip and reject undeclared model IDs',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Settings.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const settings = yield* Settings;
          const selection = {
            tiny: { provider: 'deepseek' },
            medium: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
            smart: { provider: 1 as const }
          };

          yield* settings.saveLlmSettings(selection);
          test.expect(yield* settings.llmSettings()).toStrictEqual(selection);
          test.expect(yield* settings.model('tiny')).toStrictEqual({
            provider: 'deepseek',
            modelId: 'deepseek-flash'
          });
          test.expect(yield* settings.model('medium')).toStrictEqual({
            provider: 'anthropic',
            modelId: 'claude-sonnet-5-5'
          });
          const invalid = yield* Effect.flip(
            settings.saveLlmSettings({ ...selection, tiny: { provider: 'unknown' } })
          );

          test.expect(invalid.kind).toBe('invalid_input');
          const invalidModel = yield* Effect.flip(
            settings.saveLlmSettings({
              ...selection,
              medium: { provider: 'anthropic', model: 'undeclared-model' }
            })
          );

          test.expect(invalidModel.kind).toBe('invalid_input');
          test.expect(yield* settings.llmSettings()).toStrictEqual(selection);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
