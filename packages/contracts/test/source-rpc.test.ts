import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Schema } from 'effect';

import { sourcePageInputSchema, sourceProcessingSchema } from '../src/sources/rpc.ts';
import { sourceSchema } from '../src/sources/schemas.ts';

test('source pages require a bounded limit and preserve 64-bit cursors', () => {
  const decode = Schema.decodeUnknownSync(sourcePageInputSchema);

  assert.deepEqual(decode({ limit: 20, before: 9007199254740993n }), {
    limit: 20,
    before: 9007199254740993n
  });

  for (const limit of [0, -1, 101, 1.5, Infinity]) {
    assert.throws(() => decode({ limit }));
  }

  assert.throws(() => decode({}));
  assert.throws(() => decode({ limit: 1, before: 0n }));
});

test('source processing identities survive the native JSON codec', () => {
  const codec = Schema.toCodecJson(sourceProcessingSchema);
  const value = {
    sourceId: Schema.decodeUnknownSync(sourceProcessingSchema.fields.sourceId)(9007199254740993n),
    revision: 2,
    requestId: 'ingest-2',
    documentId: null
  };
  const encoded = Schema.encodeSync(codec)(value);

  assert.deepEqual(Schema.decodeUnknownSync(codec)(JSON.parse(JSON.stringify(encoded))), value);
  const decode = Schema.decodeUnknownSync(sourceProcessingSchema);

  assert.throws(() => decode({ ...value, revision: 0 }));
  assert.throws(() => decode({ ...value, requestId: '' }));
});

test('canonical source bytes and large IDs have native wire codecs', () => {
  const codec = Schema.toCodecJson(sourceSchema);
  const source = Schema.decodeUnknownSync(sourceSchema)({
    id: 9007199254740993n,
    name: 'notes.txt',
    kind: 'text',
    mime: 'text/plain',
    origin: 'import',
    projectId: null,
    projectName: null,
    sizeBytes: 4n,
    sha256: new Uint8Array(32).fill(128),
    uri: null,
    createdAt: 1n
  });

  const wire = JSON.parse(JSON.stringify(Schema.encodeSync(codec)(source)));

  assert.deepEqual(Schema.decodeUnknownSync(codec)(wire), source);
});
