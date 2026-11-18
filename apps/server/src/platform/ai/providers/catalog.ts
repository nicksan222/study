/** @file Updates API-key provider model tiers from public model metadata. */
import { modelIdSchema } from '@study/contracts';
import type { ModelTier } from '@study/contracts';
import { Effect, Option, Schema } from 'effect';

import type { FetchOptions } from '#server/platform/http/index';
import { streamingFetch } from '#server/platform/http/index';

import { allowsAiModel } from './model-policy.ts';
import { apiKeyProviders } from './registry.ts';

const providersSchema = Schema.Record(
  Schema.String,
  Schema.Struct({ models: Schema.Record(Schema.String, Schema.Unknown) })
);

const modelSchema = Schema.Struct({
  id: modelIdSchema,
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

function byRelease(models: readonly CatalogModel[]) {
  return models.toSorted(
    (a, b) => b.release_date.localeCompare(a.release_date) || a.id.localeCompare(b.id)
  );
}

function inPriceBand(models: readonly CatalogModel[], tier: ModelTier) {
  const prices = [...new Set(models.map(({ cost }) => cost.output))].sort((a, b) => a - b);
  const band = priceBand[tier];
  const lower = Math.floor((band * prices.length) / 3);
  const upper = Math.max(lower + 1, Math.floor(((band + 1) * prices.length) / 3));
  const bandPrices = new Set(prices.slice(lower, upper));

  return models.filter(({ cost }) => bandPrices.has(cost.output));
}

const catalogIdentitySchema = Schema.Struct({
  id: modelIdSchema,
  canonical: modelIdSchema,
  family: Schema.optionalKey(Schema.String),
  releaseDate: Schema.String
});

export const catalogIdentitiesSchema = Schema.Record(
  Schema.String,
  Schema.Array(catalogIdentitySchema)
);

export type CatalogIdentities = typeof catalogIdentitiesSchema.Type;

type ModelIdentity = typeof catalogIdentitySchema.Type;

const modelId = Schema.is(modelIdSchema);

function identity(model: CatalogModel): ModelIdentity {
  return {
    id: model.id,
    canonical: modelId(model.canonical_model_id) ? model.canonical_model_id : model.id,
    ...(model.family ? { family: model.family } : {}),
    releaseDate: model.release_date
  };
}

function variant(value: ModelIdentity) {
  return (
    value.canonical
      .toLowerCase()
      .match(
        /(?:^|[-_/.])(?:\d+(?:\.\d+)?b|haiku|sonnet|opus|flash|lite|pro|mini|nano|small|medium|large|ultra|turbo|preview|instruct|thinking)(?=$|[-_/.])/g
      ) ?? []
  )
    .map((part) => part.replace(/^[-_/.]/, ''))
    .sort()
    .join('/');
}

function version(value: ModelIdentity) {
  const parts = /^(.*?)(\d{1,3}(?:[.-]\d{1,3})+)(?![0-9a-z])(.*)$/i.exec(value.canonical);

  return parts
    ? { stem: JSON.stringify([parts[1], parts[3]]), numbers: parts[2]!.split(/[.-]/).map(Number) }
    : undefined;
}

function versionOrder(a: ModelIdentity, b: ModelIdentity) {
  const left = version(a);
  const right = version(b);

  if (!left || !right || left.stem !== right.stem) return 0;

  for (const [index, number] of left.numbers.entries()) {
    const difference = number - (right.numbers[index] ?? 0);

    if (difference) return difference;
  }

  return -Number(right.numbers.slice(left.numbers.length).some(Boolean));
}

function releaseOrder(a: ModelIdentity, b: ModelIdentity) {
  const length = Math.min(a.releaseDate.length, b.releaseDate.length);

  return (
    a.releaseDate.slice(0, length).localeCompare(b.releaseDate.slice(0, length)) ||
    versionOrder(a, b)
  );
}

function sameVariant(a: ModelIdentity, b: ModelIdentity) {
  if (!a.family || a.family !== b.family || a.canonical === b.canonical) return false;

  const size = variant(b);

  return size ? variant(a) === size : versionOrder(a, b) !== 0;
}

function latestUnambiguous(models: readonly ModelIdentity[]) {
  const [latest, ...others] = models.toSorted((a, b) => releaseOrder(b, a));

  return latest &&
    others.every((other) => other.canonical === latest.canonical || releaseOrder(latest, other) > 0)
    ? latest.id
    : undefined;
}

function recommended(
  available: readonly CatalogModel[],
  current: ModelIdentity | undefined,
  tier: ModelTier
) {
  if (current) {
    const newer = latestUnambiguous(
      available
        .map(identity)
        .filter((model) => sameVariant(model, current) && releaseOrder(model, current) > 0)
    );

    if (newer) return newer;

    if (available.some((model) => model.id === current.id)) return undefined;
  }

  return latestUnambiguous(inPriceBand(available, tier).map(identity));
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

export const fetchApiKeyCatalog = (request?: FetchOptions['fetch']) =>
  fetchCatalog(request).pipe(
    Effect.map((catalog) =>
      apiKeyProviders.flatMap((provider) => {
        const models = catalog(provider.catalogId);

        if (!models?.length) return [];

        const available = byRelease(models.filter(eligible));

        return [
          [
            provider.id,
            {
              models: available.map(({ id }) => id),
              identities: models.map(identity),
              recommend: (
                id: string | undefined,
                tier: ModelTier,
                previous: readonly ModelIdentity[] = []
              ) => {
                const current = models.find((model) => model.id === id);
                const anchor = current
                  ? identity(current)
                  : previous.find((model) => model.id === id);

                return recommended(available, anchor, tier);
              }
            }
          ] as const
        ];
      })
    )
  );
