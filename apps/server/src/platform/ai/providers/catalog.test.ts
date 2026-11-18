/** @file Exercises discovery, ordering and recommendation for registered API-key providers. */
import { test } from '@study/testing';
import { Effect } from 'effect';

import { fetchApiKeyCatalog } from './catalog.ts';
import { apiKeyProviders } from './registry.ts';

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
  'discovers every registered provider in a single fetch, orders releases and excludes Astra',
  async ({ expect }) => {
    const models = [
      model('small', 'small', 1, '2026-11-01'),
      model('medium', 'medium', 2, '2026-11-01'),
      model('older-large', 'large', 3, '2026-10-01'),
      model('newest-large', 'large', 3, '2026-11-02'),
      {
        ...model('opaque-alias', 'large', 3, '2026-11-03'),
        canonical_model_id: 'openai/gpt-6.2-astra'
      }
    ];
    let requests = 0;
    const fetch = async (input: RequestInfo | URL) => {
      requests++;
      expect(String(input)).toBe('https://models.dev/api.json');

      return Response.json(
        Object.fromEntries(
          apiKeyProviders.map(({ catalogId }) => [
            catalogId,
            { models: Object.fromEntries(models.map((entry) => [entry.id, entry])) }
          ])
        )
      );
    };
    const catalog = new Map(await Effect.runPromise(fetchApiKeyCatalog(fetch)));

    for (const { id } of apiKeyProviders) {
      const entry = catalog.get(id);

      expect(entry?.models).toEqual(['newest-large', 'medium', 'small', 'older-large']);
      expect(entry?.recommend(undefined, 'tiny')).toBe('small');
      expect(entry?.recommend(undefined, 'medium')).toBe('medium');
      expect(entry?.recommend(undefined, 'smart')).toBe('newest-large');
    }

    expect(requests).toBe(1);
    await Effect.runPromise(fetchApiKeyCatalog(fetch));
    expect(requests).toBe(2);
  }
);

test.unit.stable('suggests a newer release from the same family and size', async ({ expect }) => {
  const models = [
    model('oss-20b', 'gpt-oss', 1, '2026-10-01'),
    model('oss-120b', 'gpt-oss', 4, '2026-10-01'),
    model('new-small', 'gpt-oss', 1, '2026-11-15'),
    model('new-large', 'gpt-oss', 4, '2026-11-17'),
    model('haiku', 'claude-haiku', 1, '2026-10-01'),
    model('haiku-next', 'claude-haiku', 1, '2026-11-15'),
    model('opus-next', 'claude-opus', 4, '2026-11-17')
  ];
  const catalog = await Effect.runPromise(
    fetchApiKeyCatalog(async () =>
      Response.json({
        groq: { models: Object.fromEntries(models.map((entry) => [entry.id, entry])) }
      })
    )
  );
  const available = new Map(catalog).get('groq');

  expect(available?.recommend('oss-20b', 'tiny')).toBe('new-small');
  expect(available?.recommend('oss-120b', 'smart')).toBe('new-large');
  expect(available?.recommend('new-small', 'tiny')).toBeUndefined();
  expect(available?.recommend('haiku', 'tiny')).toBe('haiku-next');
});
