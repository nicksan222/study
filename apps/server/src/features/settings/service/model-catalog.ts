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
import type { ChatGptSession, Database } from '@study/server';
import { Effect } from 'effect';

import { selectedModel } from './models.ts';

export const makeModelCatalogRefresh = (
  settings: () => Effect.Effect<LlmSettings, StudyError>,
  save: (
    catalog: Readonly<Record<string, readonly string[]>>,
    notices: readonly ModelUpdate[],
    suggestions: ModelSuggestions
  ) => Effect.Effect<void, StudyError, Database>
) =>
  Effect.fnUntraced(function* ({ manager, request }: ChatGptSession['Service']) {
    const inspectChat = yield* makeChatGptCatalog(manager, request);
    const [providers, chat] = yield* Effect.all(
      [
        fetchApiKeyCatalog(request).pipe(
          Effect.catch(() => recordModelUpdateFailure().pipe(Effect.as([])))
        ),
        inspectChat.pipe(
          Effect.catch((error) =>
            error.kind === 'auth'
              ? Effect.succeed({ models: [], recommend: () => undefined })
              : recordModelUpdateFailure()
          )
        )
      ],
      { concurrency: 'unbounded' }
    );
    const catalogs = new Map<
      1 | string,
      {
        readonly models: readonly string[];
        recommend: (id: string | undefined, tier: ModelTier) => string | undefined;
      }
    >(providers);

    if (chat) catalogs.set(LlmProvider.CHAT_GPT, chat);

    const saved = yield* settings();
    const recommendations = modelTiers.flatMap((tier) => {
      const { provider, modelId } = selectedModel(saved, tier);
      const model = catalogs.get(provider)?.recommend(modelId, tier);

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
      suggestions
    );
  });
