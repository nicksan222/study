/** @file Offers catalog updates without changing the saved selection until accepted. */
import { modelTiers, StudyError } from '@study/contracts';
import type { LlmSettings, ModelSuggestions, ModelUpdate } from '@study/contracts';
import type { CatalogIdentities } from '@study/server';
import { ModelUpdateNotices, transaction, useStore } from '@study/server';
import { Effect } from 'effect';

import { SettingsStore } from '#server/features/settings/store/index';
import { accountCatalog, ModelUpdatesStore } from '#server/features/settings/store/model-updates';

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

function newlySuggested(
  settings: LlmSettings,
  previous: Readonly<Record<string, readonly string[]>>,
  suggestions: ModelSuggestions
) {
  return modelTiers.flatMap((tier) => {
    const { provider, modelId } = selectedModel(settings, tier);
    const known = previous[String(provider)];
    const model = suggestions[String(provider)]?.[tier];

    return known?.length && model && modelId && !known.includes(model) && model !== modelId
      ? [{ tier, provider, model, previousModel: modelId }]
      : [];
  });
}

function retainSelectedIdentities(
  settings: LlmSettings,
  previous: CatalogIdentities,
  incoming: CatalogIdentities
) {
  const merged = { ...previous, ...incoming };

  for (const tier of modelTiers) {
    const { provider, modelId } = selectedModel(settings, tier);
    const key = String(provider);
    const current = merged[key];

    if (!modelId || !current || current.some(({ id }) => id === modelId)) continue;

    const saved = previous[key]?.find(({ id }) => id === modelId);

    if (saved) merged[key] = [...current, saved];
  }

  return merged;
}

export function* modelUpdateOperations(account: () => string | null | undefined) {
  const models = yield* useStore(ModelUpdatesStore);
  const preferences = yield* useStore(SettingsStore);
  const showNotices = yield* ModelUpdateNotices;

  return {
    catalogIdentities: () =>
      models.snapshot(undefined).pipe(Effect.map((state) => state.identities ?? {})),
    modelCatalog: Effect.fnUntraced(function* () {
      const { catalog, recommendations, suggestions } = accountCatalog(
        yield* models.snapshot(undefined),
        account()
      );
      const settings = llmSettings(yield* preferences.preference('llm'));

      return {
        models: catalog,
        suggestions: suggestions ?? {},
        recommendations: recommendations.filter((notice) => stillSelected(settings, notice))
      };
    }),
    modelUpdates: Effect.fnUntraced(function* () {
      if (!showNotices) return [];

      const { recommendations, dismissed } = accountCatalog(
        yield* models.snapshot(undefined),
        account()
      );
      const settings = llmSettings(yield* preferences.preference('llm'));

      return recommendations.filter(
        (notice) =>
          stillSelected(settings, notice) && !dismissed.some((entry) => same(entry, notice))
      );
    }),
    refreshModelCatalog: (
      catalog: Readonly<Record<string, readonly string[]>>,
      recommendations: readonly ModelUpdate[],
      suggestions?: ModelSuggestions,
      identities?: CatalogIdentities,
      chatAccount = account()
    ) =>
      transaction((tx) => {
        const records = tx.store(ModelUpdatesStore);
        const stored = records.snapshot(undefined);
        const previous = accountCatalog(stored, chatAccount);
        const settings = llmSettings(tx.store(SettingsStore).preference('llm'));
        const candidates = [
          ...recommendations,
          ...newlySuggested(settings, previous.catalog, suggestions ?? {}).filter(
            (entry) => !recommendations.some(({ tier }) => tier === entry.tier)
          )
        ];
        const discovered = Object.fromEntries(
          Object.entries(catalog).filter(
            ([provider, ids]) => ids.length || provider in previous.catalog
          )
        );
        const next = {
          catalog: { ...previous.catalog, ...discovered },
          ...(chatAccount === undefined ? {} : { chatAccount }),
          recommendations: [
            ...previous.recommendations.filter(
              (entry) =>
                stillSelected(settings, entry) &&
                !candidates.some(({ tier }) => tier === entry.tier) &&
                (catalog[String(entry.provider)]?.includes(entry.model) ?? true)
            ),
            ...candidates
          ],
          dismissed: previous.dismissed,
          ...(identities
            ? {
                identities: retainSelectedIdentities(
                  settings,
                  previous.identities ?? {},
                  identities
                )
              }
            : previous.identities
              ? { identities: previous.identities }
              : {}),
          ...(suggestions || previous.suggestions
            ? { suggestions: { ...previous.suggestions, ...suggestions } }
            : {})
        };

        if (JSON.stringify(stored) !== JSON.stringify(next)) records.save(next);
      }),
    updateModel: (notice: ModelUpdate, apply: boolean) =>
      transaction((tx) => {
        const models = tx.store(ModelUpdatesStore);
        const stored = models.snapshot(undefined);
        const snapshot = accountCatalog(stored, account());
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
            ...stored,
            dismissed: [...stored.dismissed, notice]
          });
        }

        return {};
      })
  };
}
