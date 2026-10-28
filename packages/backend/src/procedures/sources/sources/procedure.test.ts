import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Schema } from 'effect';

import { createNote as dbCreateNote } from '#backend/procedures/sources/operations/create-note';
import { sourceSchema } from '#backend/shared/sources/schemas';
import type { Source } from '#backend/shared/sources/schemas';
import { createBackendTest } from '#testing/backend-test';

test('sources lists persisted sources in newest first order', async (t) => {
  const f = await createBackendTest(t);

  dbCreateNote(f.store, 'first', 'a');
  dbCreateNote(f.store, 'second', 'b');
  const listed = await f.caller.sources.sources({});

  assert.deepEqual(
    listed.items.map((item) => item.name),
    ['second', 'first']
  );

  const mutableSources: Source[] = listed.items;

  mutableSources.push(mutableSources[0]!);
  mutableSources.pop();

  const sha256: Uint8Array<ArrayBuffer> = listed.items[0]!.sha256;

  assert.ok(sha256.buffer instanceof ArrayBuffer);
  assert.equal(
    Schema.is(sourceSchema)({
      ...listed.items[0]!,
      sha256: new Uint8Array(new SharedArrayBuffer(1))
    }),
    false
  );
});
