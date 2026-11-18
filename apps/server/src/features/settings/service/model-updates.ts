/** @file Offers catalog updates without changing the saved selection until accepted. */
import { StudyError } from '@study/contracts';
import type { LlmSettings, ModelUpdate } from '@study/contracts';
import { transaction, useStore } from '@study/server';
import { Effect } from 'effect';

import { SettingsStore } from '#server/features/settings/store/index';
import { ModelUpdatesStore } from '#server/features/settings/store/model-updates';

import { llmSettings, selectedModel } from './models.ts';

function same(a: ModelUpdate, b: ModelUpdate) {
  return (
    a.tier === b.tier &&
    a.provider === b.provider &&
    a.previousModel === b.previousModel &&
    a.model === b.model
  );
}

function stillSelected(settings: LlmSettings, notice: ModelUpdate) {
  const current = selectedModel(settings, notice.tier);

  return current.provider === notice.provider && current.modelId === notice.previousModel;
}

export function* modelUpdateOperations() {
  const models = yield* useStore(ModelUpdatesStore);
  const preferences = yield* useStore(SettingsStore);

  return {
    modelCatalog: () =>
      models
        .snapshot(undefined)
        .pipe(Effect.map(({ catalog, recommendations }) => ({ models: catalog, recommendations }))),
    modelUpdates: Effect.fnUntraced(function* () {
      const { recommendations, dismissed } = yield* models.snapshot(undefined);
      const settings = llmSettings(yield* preferences.preference('llm'));

      return recommendations.filter(
        (notice) =>
          stillSelected(settings, notice) && !dismissed.some((entry) => same(entry, notice))
      );
    }),
    refreshModelCatalog: (
      catalog: Readonly<Record<string, readonly string[]>>,
      recommendations: readonly ModelUpdate[]
    ) =>
      transaction((tx) => {
        const records = tx.store(ModelUpdatesStore);
        const previous = records.snapshot(undefined);
        const discovered = Object.fromEntries(
          Object.entries(catalog).filter(
            ([provider, ids]) => ids.length || provider in previous.catalog
          )
        );
        const next = {
          catalog: { ...previous.catalog, ...discovered },
          recommendations: [
            ...previous.recommendations.filter((entry) => !(String(entry.provider) in catalog)),
            ...recommendations
          ],
          dismissed: previous.dismissed
        };

        if (JSON.stringify(previous) !== JSON.stringify(next)) records.save(next);
      }),
    updateModel: (notice: ModelUpdate, apply: boolean) =>
      transaction((tx) => {
        const models = tx.store(ModelUpdatesStore);
        const snapshot = models.snapshot(undefined);
        const preferences = tx.store(SettingsStore);
        const settings = llmSettings(preferences.preference('llm'));
        const current = selectedModel(settings, notice.tier);

        if (apply && current.provider === notice.provider && current.modelId === notice.model)
          return {};

        if (
          !snapshot.recommendations.some((entry) => same(entry, notice)) ||
          !stillSelected(settings, notice) ||
          snapshot.dismissed.some((entry) => same(entry, notice)) ||
          !snapshot.catalog[String(notice.provider)]?.includes(notice.model)
        ) {
          if (apply) throw new StudyError('invalid_input', 'Model recommendation has changed');

          return {};
        }

        if (apply) {
          preferences.saveLlmSettings({
            ...settings,
            [notice.tier]: { provider: notice.provider, model: notice.model }
          });
        } else {
          models.save({
            ...snapshot,
            dismissed: [...snapshot.dismissed.filter((entry) => entry.tier !== notice.tier), notice]
          });
        }

        return {};
      })
  };
}
