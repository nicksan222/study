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

test.unit.stable(
  'page output uses closed, required object fields without changing nullable content',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const adapter = standardSchema(pageTransformOutputSchema);
    const document = adapter['~standard'].jsonSchema.input({ target: 'draft-07' });
    let objects = 0;

    function inspect({ assert: assertions }: Pick<test.unit.Context, 'assert'>, value: unknown) {
      const assert: test.Assert = assertions;

      if (Array.isArray(value)) {
        value.forEach((arg0) => inspect({ assert }, arg0));
      } else if (value !== null && typeof value === 'object') {
        if ('type' in value && value.type === 'object' && 'properties' in value) {
          objects++;
          assert.ok('additionalProperties' in value && value.additionalProperties === false);
          assert.ok('required' in value);
          assert.ok(value.properties !== null && typeof value.properties === 'object');
          assert.deepEqual(value.required, Object.keys(value.properties));
        }

        Object.values(value).forEach((arg0) => inspect({ assert }, arg0));
      }
    }

    inspect({ assert }, document);
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

test.unit.stable(
  'encoded optional placeholders and genuine nullable values remain valid',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const domain = Schema.Struct({
      optional: Schema.optional(Schema.String),
      nullable: Schema.NullOr(Schema.String)
    });
    const codec = Schema.toCodecJson(domain);
    const adapter = standardSchema(Schema.toEncoded(codec));
    const value = { optional: null, nullable: null };

    assert.deepEqual(await adapter['~standard'].validate(value), { value });
    assert.deepEqual(Schema.decodeUnknownSync(codec)(value), {
      optional: undefined,
      nullable: null
    });
  }
);

test.unit.stable('dictionary value schemas retain their meaning', ({ assert: assertions }) => {
  const assert: test.Assert = assertions;

  const dictionary = Schema.Record(Schema.String, Schema.String);
  const adapter = standardSchema(dictionary);
  const document = adapter['~standard'].jsonSchema.input({ target: 'draft-07' });

  assert.deepEqual(document.additionalProperties, { type: 'string' });
  assert.ok(!('required' in document));
});
