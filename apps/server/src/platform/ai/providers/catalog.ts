/** @file Updates API-key provider model tiers from public model metadata. */
import type { ModelTier } from '@study/contracts';
import { Cache, Effect, Exit, Option, Schema } from 'effect';

import type { FetchOptions } from '#server/platform/http/index';
import { streamingFetch } from '#server/platform/http/index';

import type { ApiKeyProvider } from './definition.ts';
import { allowsAiModel } from './model-policy.ts';

const providersSchema = Schema.Record(
  Schema.String,
  Schema.Struct({ models: Schema.Record(Schema.String, Schema.Unknown) })
);

const modelSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^\S+$/), Schema.isMaxLength(200)),
  name: Schema.String,
  family: Schema.optional(Schema.String),
  canonical_model_id: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  release_date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}(?:-\d{2})?$/)),
  tool_call: Schema.Boolean,
  structured_output: Schema.optional(Schema.Boolean),
  modalities: Schema.Struct({ output: Schema.Array(Schema.String) }),
  cost: Schema.Struct({ output: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)) })
});

const decodeModel = Schema.decodeUnknownOption(modelSchema);

type CatalogModel = typeof modelSchema.Type;

const priceBand = { tiny: 0, medium: 1, smart: 2 } as const;

function eligible(model: CatalogModel) {
  return (
    allowsAiModel(model.id, model.name, model.family, model.canonical_model_id) &&
    !['alpha', 'beta', 'deprecated'].includes(model.status ?? '') &&
    model.tool_call &&
    model.structured_output !== false &&
    model.modalities.output.includes('text')
  );
}

function newest(models: readonly CatalogModel[]) {
  return models.toSorted(
    (a, b) => b.release_date.localeCompare(a.release_date) || a.id.localeCompare(b.id)
  )[0];
}

function inPriceBand(models: readonly CatalogModel[], tier: ModelTier) {
  const prices = [...new Set(models.map(({ cost }) => cost.output))].sort((a, b) => a - b);
  const band = priceBand[tier];
  const lower = Math.floor((band * prices.length) / 3);
  const upper = Math.max(lower + 1, Math.floor(((band + 1) * prices.length) / 3));
  const bandPrices = new Set(prices.slice(lower, upper));

  return models.filter(({ cost }) => bandPrices.has(cost.output));
}

function preferredFamily(
  models: readonly CatalogModel[],
  anchor: CatalogModel | undefined,
  tierAnchors: readonly CatalogModel[]
) {
  if (!anchor?.family) return [];

  const family = anchor.family;
  const competingSizes = tierAnchors.filter(
    (other) => other.family === family && other.cost.output !== anchor.cost.output
  );

  // A family can contain multiple sizes, such as GPT-OSS 20B and 120B.
  return models.filter((model) => {
    const distance = (other: CatalogModel) =>
      Math.abs(Math.log1p(model.cost.output) - Math.log1p(other.cost.output));

    return (
      model.family === family &&
      competingSizes.every((other) => distance(anchor) <= distance(other))
    );
  });
}

function indexCatalog(catalog: typeof providersSchema.Type) {
  const providers = new Map<string, readonly CatalogModel[]>();

  return (id: string) => {
    const entries = catalog[id]?.models;

    if (!entries) return undefined;

    const cached = providers.get(id);

    if (cached) return cached;

    const models = Object.values(entries).flatMap((entry) => Option.toArray(decodeModel(entry)));

    providers.set(id, models);

    return models;
  };
}

function fetchCatalog(request?: FetchOptions['fetch']) {
  return Effect.tryPromise(async (signal) => {
    const response = await streamingFetch(
      'https://models.dev/api.json',
      { signal, headers: { accept: 'application/json' } },
      { fetch: request, timeoutMs: 8_000, maxBytes: 16 * 1024 * 1024 }
    );

    if (!response.ok) {
      await response.body?.cancel();

      throw new Error('Model catalog unavailable');
    }

    return response.json() as Promise<unknown>;
  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(providersSchema)), Effect.map(indexCatalog));
}

export const makeApiKeyCatalog = (request?: FetchOptions['fetch']) =>
  Effect.gen(function* () {
    const cache = yield* Cache.makeWith(() => fetchCatalog(request), {
      capacity: 1,
      timeToLive: (result) => (Exit.isSuccess(result) ? '15 minutes' : '1 minute')
    });

    return (provider: ApiKeyProvider) =>
      Cache.get(cache, null).pipe(
        Effect.map((catalog) => {
          const models = catalog(provider.catalogId);

          if (!models) return undefined;

          const available = models.filter(eligible);
          const defaults = new Set(Object.values(provider.defaults));
          const anchors = models.filter((model) => defaults.has(model.id));

          return {
            models: available.map(({ id }) => id).sort(),
            recommend: (id: string, tier: ModelTier) => {
              const current = models.find((model) => model.id === id);

              if (!current) return newest(inPriceBand(available, tier))?.id;

              const newer = preferredFamily(available, current, [...anchors, current]).filter(
                (model) =>
                  model.release_date > current.release_date &&
                  (model.canonical_model_id ?? model.id) !== (current.canonical_model_id ?? id)
              );

              return newest(newer)?.id;
            }
          };
        })
      );
  });
