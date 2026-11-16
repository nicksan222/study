import { pageTransformOutputSchema } from '@study/contracts';
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
import { test } from '@study/testing';
import { Schema } from 'effect';

import { standardSchema } from '#server/platform/ai/schema';

test.stable(
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
          test.assert.ok('additionalProperties' in value && value.additionalProperties === false);
          test.assert.ok('required' in value);
          test.assert.ok(value.properties !== null && typeof value.properties === 'object');
          test.assert.deepEqual(value.required, Object.keys(value.properties));
        }

        Object.values(value).forEach(inspect);
      }
    }

    inspect(document);
    test.assert.ok(objects > 10);
    const output = {
      blocks: [
        {
          type: 'paragraph',
          inlines: [{ type: 'link', text: 'Source', href: 'https://example.com', marks: null }]
        }
      ],
      notes: [{ kind: 'limit', explanation: 'Captured material only', blockOrdinals: [] }]
    };

    test.assert.ok(Schema.is(pageTransformOutputSchema)(output));
    test.assert.deepEqual(await adapter['~standard'].validate(output), { value: output });
    test.assert.ok('issues' in (await adapter['~standard'].validate({ ...output, blocks: [] })));
  }
);

test.stable('encoded optional placeholders and genuine nullable values remain valid', async () => {
  const domain = Schema.Struct({
    optional: Schema.optional(Schema.String),
    nullable: Schema.NullOr(Schema.String)
  });
  const codec = Schema.toCodecJson(domain);
  const adapter = standardSchema(Schema.toEncoded(codec));
  const value = { optional: null, nullable: null };

  test.assert.deepEqual(await adapter['~standard'].validate(value), { value });
  test.assert.deepEqual(Schema.decodeUnknownSync(codec)(value), {
    optional: undefined,
    nullable: null
  });
});

test.stable('dictionary value schemas retain their meaning', () => {
  const dictionary = Schema.Record(Schema.String, Schema.String);
  const adapter = standardSchema(dictionary);
  const document = adapter['~standard'].jsonSchema.input({ target: 'draft-07' });

  test.assert.deepEqual(document.additionalProperties, { type: 'string' });
  test.assert.ok(!('required' in document));
});
