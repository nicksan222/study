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

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  defaultWorkspacePreferences,
  Appearance,
  Language,
  LlmModel,
  LlmProvider
} from '@study/contracts/settings/types';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';

import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

test('settings defaults, updates, model selection and rollback use SQLite', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Settings.layer.pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;

        assert.deepEqual(yield* settings.appSettings(), {
          language: Language.ENGLISH,
          appearance: Appearance.DARK,
          zoomPercent: 100,
          onboarded: false
        });
        assert.deepEqual(yield* settings.sidebarSettings(), { settledDocumentThreshold: 1 });
        yield* settings.saveSidebarSettings({ settledDocumentThreshold: 3 });
        assert.deepEqual(yield* settings.sidebarSettings(), { settledDocumentThreshold: 3 });
        const invalidSidebar = yield* Effect.flip(
          settings.saveSidebarSettings({ settledDocumentThreshold: 0 })
        );

        assert.equal(invalidSidebar.kind, 'invalid_input');
        assert.deepEqual(yield* settings.sidebarSettings(), { settledDocumentThreshold: 3 });
        assert.deepEqual(yield* settings.materialSettings(), { sift: true });
        assert.deepEqual(yield* settings.reviewSettings(), { newCardsPerDay: 20 });
        assert.equal(yield* settings.language(), 'english');
        assert.equal(yield* settings.model('tiny'), 'gpt-6-luna');
        assert.equal(yield* settings.model('medium'), 'gpt-6.1-sol');
        assert.equal(yield* settings.model('smart'), 'gpt-6-astra');
        const app = {
          language: Language.ITALIAN,
          appearance: Appearance.LIGHT,
          zoomPercent: 125,
          onboarded: true
        };

        yield* settings.saveAppSettings(app);
        assert.deepEqual(yield* settings.appSettings(), app);
        assert.equal(yield* settings.language(), 'italian');
        yield* settings.saveAppSettings({ ...app, appearance: Appearance.SYSTEM });
        assert.equal((yield* settings.appSettings()).appearance, Appearance.SYSTEM);
        yield* settings.saveAppSettings(app);
        const llm = {
          tiny: { provider: LlmProvider.CHAT_GPT, model: LlmModel.GPT6_ASTRA },
          medium: { provider: LlmProvider.CHAT_GPT },
          smart: { provider: LlmProvider.CHAT_GPT }
        };

        yield* settings.saveLlmSettings(llm);
        assert.deepEqual(yield* settings.llmSettings(), {
          ...llm,
          medium: { ...llm.medium, model: undefined },
          smart: { ...llm.smart, model: undefined }
        });
        assert.equal(yield* settings.model('tiny'), 'gpt-6-astra');
        yield* settings.saveMaterialSettings({ sift: false });
        yield* settings.saveReviewSettings({ newCardsPerDay: 42 });
        assert.deepEqual(yield* settings.materialSettings(), { sift: false });
        assert.deepEqual(yield* settings.reviewSettings(), { newCardsPerDay: 42 });
        const invalid = yield* Effect.flip(settings.saveAppSettings({ ...app, zoomPercent: 10 }));

        assert.equal(invalid.kind, 'invalid_input');
        assert.deepEqual(yield* settings.appSettings(), app);
        context.db.orm.run(
          sql`CREATE TRIGGER reject_app BEFORE INSERT ON preferences WHEN NEW.scope = 'app' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
        );
        yield* Effect.flip(settings.saveAppSettings({ ...app, zoomPercent: 150 }));
        assert.deepEqual(yield* settings.appSettings(), app);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('appearance controls persist bounded preferences independently of app settings', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Settings.layer.pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;

        assert.deepEqual(yield* settings.appearancePreferences(), {
          contrast: 100,
          glassOpacity: 80,
          animationDurationMs: 150
        });
        yield* settings.saveAppearancePreferences({
          contrast: 115,
          glassOpacity: 90,
          animationDurationMs: 0
        });
        assert.deepEqual(yield* settings.appearancePreferences(), {
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

        assert.equal(invalid.kind, 'invalid_input');
        assert.equal((yield* settings.appearancePreferences()).contrast, 115);
        assert.equal((yield* settings.appSettings()).zoomPercent, 100);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('concurrency settings persist and reject invalid limits without changing saved capacity', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Settings.layer.pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;

        assert.deepEqual(yield* settings.concurrencySettings(), {
          maxConcurrentAi: 2,
          maxQueuedAi: 16
        });
        yield* settings.saveConcurrencySettings({ maxConcurrentAi: 8, maxQueuedAi: 0 });
        assert.deepEqual(yield* settings.concurrencySettings(), {
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
          assert.equal(
            (yield* Effect.flip(settings.saveConcurrencySettings(invalid))).kind,
            'invalid_input'
          );

        assert.deepEqual(yield* settings.concurrencySettings(), {
          maxConcurrentAi: 8,
          maxQueuedAi: 0
        });
        assert.equal((yield* settings.appSettings()).zoomPercent, 100);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('workspace preferences persist in SQLite, merge new defaults and reject invalid updates', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Settings.layer.pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;

        assert.deepEqual(yield* settings.workspacePreferences(), defaultWorkspacePreferences);
        const saved = {
          ...defaultWorkspacePreferences,
          autosaveIntervalSeconds: 8,
          defaultAiDetail: 'detailed' as const,
          spellcheck: false,
          autoTitleSessions: true
        };

        yield* settings.saveWorkspacePreferences(saved);
        assert.deepEqual(yield* settings.workspacePreferences(), saved);

        for (const invalid of [
          { ...saved, autosaveIntervalSeconds: 0 },
          { ...saved, autosaveIntervalSeconds: 31 },
          { ...saved, autosaveIntervalSeconds: 1.5 },
          { ...saved, editorFontSize: 13 },
          { ...saved, readerFontSize: 25 }
        ])
          assert.equal(
            (yield* Effect.flip(settings.saveWorkspacePreferences(invalid))).kind,
            'invalid_input'
          );

        assert.deepEqual(yield* settings.workspacePreferences(), saved);
        context.db.orm.run(
          sql`DELETE FROM preferences WHERE scope = 'workspace' AND key = 'spellcheck'`
        );
        assert.deepEqual(yield* settings.workspacePreferences(), { ...saved, spellcheck: true });
        context.db.orm.run(
          sql`UPDATE preferences SET value = '999' WHERE scope = 'workspace' AND key = 'editorFontSize'`
        );
        assert.deepEqual(yield* settings.workspacePreferences(), defaultWorkspacePreferences);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
