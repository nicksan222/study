import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { listSources as dbListSources } from './sources.ts';
test('uploadSource sniffs and persists uploaded text', async (t) => {
  const f = await fixture(t);
  const source = await f.caller.sources.uploadSource({
    name: 'upload.txt',
    bytes: new TextEncoder().encode('upload body')
  });

  assert.equal(source.name, 'upload.txt');
  assert.equal(source.kind, 'text');
  assert.equal(dbListSources(f.store).find((item) => item.name === source.name)?.sizeBytes, 11n);

  for (const input of [
    {
      name: 'empty.txt',
      bytes: new Uint8Array()
    },
    {
      name: ' ',
      bytes: new Uint8Array([1])
    }
  ])
    await assert.rejects(f.caller.sources.uploadSource(input), {
      kind: 'invalid_input'
    });

  assert.equal(dbListSources(f.store).length, 1);
});
