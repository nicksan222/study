import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { createNote as dbCreateNote } from './create-note.ts';
test('exportSourceToFile writes the source bytes to the requested destination', async (t) => {
  const f = await fixture(t);
  const source = dbCreateNote(f.store, 'n', 'export me');
  const path = join(f.dir, 'export.txt');
  const result = await f.caller.sources.exportSourceToFile({
    sourceId: source.id,
    destination: path
  });

  assert.equal(result.value, 9n);
  assert.equal(readFileSync(path, 'utf8'), 'export me');
  await assert.rejects(
    f.caller.sources.exportSourceToFile({
      sourceId: source.id,
      destination: ''
    }),
    {
      kind: 'invalid_input'
    }
  );
});
