/** @file Compares saved model choices against provider catalogs. */
import { LlmProvider, modelTiers } from '@study/contracts';
import type { ModelTier, ModelUpdate, StudyError } from '@study/contracts';
import { getApiKeyProvider, recordModelUpdateFailure } from '@study/server';
import type { Database, makeApiKeyCatalog, makeChatGptCatalog } from '@study/server';
import { Effect } from 'effect';

export const makeModelCatalogRefresh = (
  model: (tier: ModelTier) => Effect.Effect<{ provider: string | 1; modelId: string }, StudyError>,
  save: (
    catalog: Readonly<Record<string, readonly string[]>>,
    notices: readonly ModelUpdate[]
  ) => Effect.Effect<void, StudyError, Database>
) =>
  Effect.fnUntraced(function* (
    providersSource: () => Effect.Effect<
      readonly { id: string; configured: boolean }[],
      StudyError
    >,
    chatGptModel: Effect.Success<ReturnType<typeof makeChatGptCatalog>>,
    apiKeyModel: Effect.Success<ReturnType<typeof makeApiKeyCatalog>>
  ) {
    const configured = yield* providersSource();
    const providers = yield* Effect.forEach(
      configured.filter((provider) => provider.configured),
      ({ id }) =>
        apiKeyModel(getApiKeyProvider(id)).pipe(
          Effect.map((catalog) => [id, catalog] as const),
          Effect.catch(() => recordModelUpdateFailure().pipe(Effect.as([id, undefined] as const)))
        )
    );
    const chat = yield* chatGptModel.pipe(
      Effect.catch((error) =>
        error.kind === 'auth'
          ? Effect.succeed({ models: [], recommend: () => undefined })
          : recordModelUpdateFailure()
      )
    );
    const catalogs = new Map<
      1 | string,
      {
        readonly models: readonly string[];
        recommend: (id: string, tier: ModelTier) => string | undefined;
      }
    >();

    if (chat) catalogs.set(LlmProvider.CHAT_GPT, chat);

    for (const [id, catalog] of providers) if (catalog) catalogs.set(id, catalog);

    const recommendations = yield* Effect.forEach(modelTiers, (tier) =>
      model(tier).pipe(
        Effect.map(({ provider, modelId }) => {
          const model = catalogs.get(provider)?.recommend(modelId, tier);

          return model && model !== modelId
            ? [{ tier, provider, model, previousModel: modelId }]
            : [];
        })
      )
    );

    yield* save(
      Object.fromEntries([...catalogs].map(([id, catalog]) => [String(id), catalog.models])),
      recommendations.flat()
    );
  });
