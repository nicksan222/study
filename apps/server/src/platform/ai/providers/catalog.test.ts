/** @file Exercises discovery, ordering and recommendation for registered API-key providers. */
import { test } from '@study/testing';
import { Effect } from 'effect';

import { fetchApiKeyCatalog } from './catalog.ts';

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

      const rows = { models: Object.fromEntries(models.map((entry) => [entry.id, entry])) };
      const branded = (id: string) => ({ models: { [id]: model(id, id, 1, '2026-11-02') } });

      return Response.json({
        anthropic: rows,
        google: rows,
        openrouter: rows,
        deepseek: rows,
        mistral: rows,
        groq: rows,
        xai: rows,
        cerebras: rows,
        togetherai: branded('together-model'),
        'fireworks-ai': branded('fireworks-model')
      });
    };
    const catalog = new Map(await Effect.runPromise(fetchApiKeyCatalog(fetch)));

    expect(catalog.size).toBe(10);
    expect(catalog.get('together')?.models).toEqual(['together-model']);
    expect(catalog.get('fireworks')?.models).toEqual(['fireworks-model']);

    for (const id of [
      'anthropic',
      'google',
      'openrouter',
      'deepseek',
      'mistral',
      'groq',
      'xai',
      'cerebras'
    ]) {
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
    model('oss-120b', 'gpt-oss', 1, '2026-10-01'),
    model('oss-next-20b', 'gpt-oss', 1, '2026-11-15'),
    model('oss-next-120b', 'gpt-oss', 1, '2026-11-17'),
    model('claude-haiku-5-9', 'claude-haiku', 1, '2026-11'),
    { ...model('claude-haiku-5-10', 'claude-haiku', 1, '2026-11-15'), canonical_model_id: ' ' },
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

  expect(available?.recommend('oss-20b', 'tiny')).toBe('oss-next-20b');
  expect(available?.recommend('oss-120b', 'smart')).toBe('oss-next-120b');
  expect(available?.recommend('oss-next-20b', 'tiny')).toBeUndefined();
  expect(available?.recommend('claude-haiku-5-9', 'tiny')).toBe('claude-haiku-5-10');
});

test.unit.stable(
  'keeps an unclassified size and follows a delisted model using saved identity',
  async ({ expect }) => {
    const original = [
      model('qwen-flash-old', 'qwen', 1, '2026-10-01'),
      model('opaque-a', 'opaque', 2, '2026-10-01')
    ];
    const next = [
      model('qwen-flash-next', 'qwen', 1, '2026-11-01'),
      model('unrelated-latest', 'unrelated', 1, '2026-11-02'),
      original[1]!,
      model('opaque-b', 'opaque', 2, '2026-11-15')
    ];
    const inspect = async (models: typeof original) =>
      new Map(
        await Effect.runPromise(
          fetchApiKeyCatalog(async () =>
            Response.json({
              togetherai: { models: Object.fromEntries(models.map((entry) => [entry.id, entry])) }
            })
          )
        )
      ).get('together');

    const saved = await inspect(original);
    const fresh = await inspect(next);

    expect(fresh?.recommend('qwen-flash-old', 'tiny', saved?.identities)).toBe('qwen-flash-next');
    expect(fresh?.recommend('opaque-a', 'medium')).toBeUndefined();
  }
);

test.unit.stable(
  'keeps regular Qwen Flash separate from Omni across family metadata changes',
  async ({ expect }) => {
    const rows = [
      model('qwen/qwen3.6-flash', 'qwen3.6', 1, '2026-04-27'),
      model('qwen/qwen3.8-flash', 'qwen', 1, '2026-08-01'),
      model('qwen/qwen3.8-omni-flash', 'qwen', 1, '2026-09-17')
    ];
    const available = new Map(
      await Effect.runPromise(
        fetchApiKeyCatalog(async () =>
          Response.json({
            openrouter: { models: Object.fromEntries(rows.map((entry) => [entry.id, entry])) }
          })
        )
      )
    ).get('openrouter');

    expect(available?.recommend(rows[0]!.id, 'tiny')).toBe(rows[1]!.id);
  }
);

test.unit.stable(
  'distinguishes a partially undecodable catalog from a verified empty result',
  async ({ expect }) => {
    const deprecated = { ...model('old', 'family', 1, '2026-01-01'), status: 'deprecated' };
    const broken = model('broken', 'family', 1, 'not-a-date');
    const catalog = new Map(
      await Effect.runPromise(
        fetchApiKeyCatalog(async () =>
          Response.json({
            'fireworks-ai': { models: { old: deprecated, broken } },
            togetherai: { models: { old: deprecated } }
          })
        )
      )
    );

    expect(catalog.has('fireworks')).toBe(false);
    expect(catalog.get('together')?.models).toEqual([]);
  }
);
