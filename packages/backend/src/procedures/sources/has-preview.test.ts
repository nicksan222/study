import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';
test('hasPreview identifies previewable kinds and supported image MIME types', async (t) => {
  const f = await fixture(t);

  assert.equal(
    (
      await f.caller.sources.hasPreview({
        kind: 'text'
      })
    ).value,
    true
  );
  assert.equal(
    (
      await f.caller.sources.hasPreview({
        kind: 'image',
        mime: 'image/png'
      })
    ).value,
    true
  );
  assert.equal(
    (
      await f.caller.sources.hasPreview({
        kind: 'image',
        mime: 'image/svg+xml'
      })
    ).value,
    false
  );
});
