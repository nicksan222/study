import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Appearance, Language, LlmModel, LlmProvider } from '@study/contracts/settings/types';
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
