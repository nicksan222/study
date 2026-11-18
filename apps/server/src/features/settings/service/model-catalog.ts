/** @file Compares saved model choices against a fresh provider catalog. */
import { LlmProvider, modelTiers } from '@study/contracts';
import type {
  LlmSettings,
  ModelTier,
  ModelSuggestions,
  ModelUpdate,
  StudyError
} from '@study/contracts';
import { fetchApiKeyCatalog, makeChatGptCatalog, recordModelUpdateFailure } from '@study/server';
import type { CatalogIdentities, ChatGptSession, Database } from '@study/server';
import { Effect, Result } from 'effect';

import { selectedModel } from './models.ts';

export const makeModelCatalogRefresh = (
  settings: () => Effect.Effect<LlmSettings, StudyError>,
  identities: () => Effect.Effect<CatalogIdentities, StudyError>,
  save: (
    catalog: Readonly<Record<string, readonly string[]>>,
    notices: readonly ModelUpdate[],
    suggestions: ModelSuggestions,
    identities: CatalogIdentities,
    chatAccount: string | null
  ) => Effect.Effect<void, StudyError, Database>
) =>
  Effect.fnUntraced(function* ({ manager, request }: ChatGptSession['Service']) {
    const startedAccount = manager.catalogAccount();
    const inspectChat = yield* makeChatGptCatalog(manager, request);
    const [apiResult, chatResult] = yield* Effect.all(
      [Effect.result(fetchApiKeyCatalog(request)), Effect.result(inspectChat)],
      { concurrency: 'unbounded' }
    );
    const providers = Result.isSuccess(apiResult) ? apiResult.success : [];
    const chat = Result.isSuccess(chatResult) ? chatResult.success : undefined;

    if (Result.isFailure(apiResult)) yield* recordModelUpdateFailure();

    if (Result.isFailure(chatResult) && startedAccount) yield* recordModelUpdateFailure();

    const catalogs = new Map<
      1 | string,
      {
        readonly models: readonly string[];
        recommend: (
          id: string | undefined,
          tier: ModelTier,
          previous?: CatalogIdentities[string]
        ) => string | undefined;
      }
    >(providers);

    const saved = yield* settings();
    const previous = yield* identities();

    const currentAccount = manager.catalogAccount();

    const matchingChat =
      currentAccount !== startedAccount || chat?.signal.aborted ? undefined : chat;

    if (matchingChat) catalogs.set(LlmProvider.CHAT_GPT, matchingChat);

    const recommendations = modelTiers.flatMap((tier) => {
      const { provider, modelId } = selectedModel(saved, tier);
      const model = catalogs.get(provider)?.recommend(modelId, tier, previous[String(provider)]);

      return model && model !== modelId
        ? [{ tier, provider, model, ...(modelId === undefined ? {} : { previousModel: modelId }) }]
        : [];
    });

    const suggestions = Object.fromEntries(
      [...providers].map(([provider, catalog]) => [
        provider,
        Object.fromEntries(
          modelTiers.flatMap((tier) => {
            const id = catalog.recommend(undefined, tier);

            return id ? [[tier, id]] : [];
          })
        )
      ])
    );

    yield* save(
      Object.fromEntries([...catalogs].map(([id, catalog]) => [String(id), catalog.models])),
      recommendations,
      suggestions,
      Object.fromEntries(providers.map(([id, catalog]) => [id, catalog.identities])),
      currentAccount
    );

    return {
      apiAvailable: Result.isSuccess(apiResult),
      chatAvailable: !currentAccount || !!matchingChat
    };
  });
