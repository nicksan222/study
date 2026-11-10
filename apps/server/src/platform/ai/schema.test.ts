/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies provider schemas preserve canonical rich document validation.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks nested objects and nullable optional fields.                                    │
 * │ - Keeps dictionary schemas unchanged during adaptation.                                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses canonical Effect schemas without performing provider network requests.              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { pageTransformOutputSchema } from '@study/contracts/ai/page-transform';
import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert } from 'vite-plus/test';

import { standardSchema } from '#server/platform/ai/schema';

testStable(
  'page output uses closed, required object fields without changing nullable content',
  async () => {
    const adapter = standardSchema(pageTransformOutputSchema);
    const document = adapter['~standard'].jsonSchema.input({ target: 'draft-07' });
    let objects = 0;

    function inspect(value: unknown) {
      if (Array.isArray(value)) {
        value.forEach(inspect);
      } else if (value !== null && typeof value === 'object') {
        if ('type' in value && value.type === 'object' && 'properties' in value) {
          objects++;
          assert.ok('additionalProperties' in value && value.additionalProperties === false);
          assert.ok('required' in value);
          assert.ok(value.properties !== null && typeof value.properties === 'object');
          assert.deepEqual(value.required, Object.keys(value.properties));
        }

        Object.values(value).forEach(inspect);
      }
    }

    inspect(document);
    assert.ok(objects > 10);
    const output = {
      blocks: [
        {
          type: 'paragraph',
          inlines: [{ type: 'link', text: 'Source', href: 'https://example.com', marks: null }]
        }
      ],
      notes: [{ kind: 'limit', explanation: 'Captured material only', blockOrdinals: [] }]
    };

    assert.ok(Schema.is(pageTransformOutputSchema)(output));
    assert.deepEqual(await adapter['~standard'].validate(output), { value: output });
    assert.ok('issues' in (await adapter['~standard'].validate({ ...output, blocks: [] })));
  }
);

testStable('encoded optional placeholders and genuine nullable values remain valid', async () => {
  const domain = Schema.Struct({
    optional: Schema.optional(Schema.String),
    nullable: Schema.NullOr(Schema.String)
  });
  const codec = Schema.toCodecJson(domain);
  const adapter = standardSchema(Schema.toEncoded(codec));
  const value = { optional: null, nullable: null };

  assert.deepEqual(await adapter['~standard'].validate(value), { value });
  assert.deepEqual(Schema.decodeUnknownSync(codec)(value), { optional: undefined, nullable: null });
});

testStable('dictionary value schemas retain their meaning', () => {
  const dictionary = Schema.Record(Schema.String, Schema.String);
  const adapter = standardSchema(dictionary);
  const document = adapter['~standard'].jsonSchema.input({ target: 'draft-07' });

  assert.deepEqual(document.additionalProperties, { type: 'string' });
  assert.ok(!('required' in document));
});
