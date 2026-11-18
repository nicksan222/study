/** @file Exercises consent-based tier recommendations for registered API-key providers. */
import { test } from '@study/testing';
import { Effect } from 'effect';

import { makeApiKeyCatalog } from './catalog.ts';
import { apiKeyProviders, getApiKeyProvider } from './registry.ts';

function model(id: string, family: string, price: number, date: string) {
  return {
    id,
    family,
    name: id,
    release_date: date,
    cost: { output: price },
    tool_call: true,
    modalities: { output: ['text'] }
  };
}

test.unit.stable(
  'suggests updated models per provider and excludes Astra aliases',
  async ({ expect }) => {
    const providers = Object.fromEntries(
      apiKeyProviders.map((provider) => {
        const models = [
          model('new-small', 'new-small', 1, '2026-11-01'),
          model('new-medium', 'new-medium', 2, '2026-11-01'),
          model('older-bigger', 'new-large', 3, '2026-10-01'),
          model('newest-bigger', 'new-large', 3, '2026-11-02'),
          {
            ...model('opaque-alias', 'new-large', 3, '2026-11-03'),
            canonical_model_id: 'openai/gpt-6.2-astra'
          }
        ];

        return [
          provider.catalogId,
          { models: Object.fromEntries(models.map((entry) => [entry.id, entry])) }
        ];
      })
    );
    let requests = 0;
    const catalog = await Effect.runPromise(
      makeApiKeyCatalog(async (input) => {
        requests++;
        expect(String(input)).toBe('https://models.dev/api.json');

        return Response.json(providers);
      })
    );

    for (const provider of apiKeyProviders) {
      const available = await Effect.runPromise(catalog(provider));

      expect(available?.models).not.toContain('opaque-alias');
      expect(available?.recommend(provider.defaults.smart, 'smart')).toBe('newest-bigger');
    }

    expect(requests).toBe(1);
    const openrouter = getApiKeyProvider('openrouter');

    const open = await Effect.runPromise(catalog(openrouter));

    expect(open?.recommend(openrouter.defaults.tiny, 'tiny')).toBe('new-small');
    expect(open?.recommend(openrouter.defaults.medium, 'medium')).toBe('new-medium');
  }
);

test.unit.stable(
  'follows a preferred family without switching to another size',
  async ({ expect }) => {
    const provider = getApiKeyProvider('groq');
    const models = [
      model(provider.defaults.tiny, 'gpt-oss', 1, '2026-10-01'),
      model(provider.defaults.smart, 'gpt-oss', 4, '2026-10-01'),
      model('new-small', 'gpt-oss', 1, '2026-11-15'),
      model('new-large', 'gpt-oss', 4, '2026-11-17')
    ];
    const catalog = await Effect.runPromise(
      makeApiKeyCatalog(async () =>
        Response.json({
          groq: { models: Object.fromEntries(models.map((entry) => [entry.id, entry])) }
        })
      )
    );

    const available = await Effect.runPromise(catalog(provider));

    expect(available?.recommend(provider.defaults.tiny, 'tiny')).toBe('new-small');
    expect(available?.recommend(provider.defaults.smart, 'smart')).toBe('new-large');
    expect(available?.recommend('new-small', 'tiny')).toBeUndefined();
  }
);

test.unit.stable('refuses a provider catalog with only restricted models', async ({ expect }) => {
  const provider = getApiKeyProvider('openrouter');
  const astra = model('openai/gpt-6.2-astra', 'gpt-astra', 4, '2026-11-18');
  const catalog = await Effect.runPromise(
    makeApiKeyCatalog(async () => Response.json({ openrouter: { models: { [astra.id]: astra } } }))
  );

  const available = await Effect.runPromise(catalog(provider));

  expect(available?.models).toEqual([]);
  expect(available?.recommend(provider.defaults.smart, 'smart')).toBeUndefined();
});
