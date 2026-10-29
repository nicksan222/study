import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServerTest } from '#testing/server-test';
test('hasPreview identifies previewable kinds and supported image MIME types', async (t) => {
  const client = (await createServerTest(t)).caller;

  assert.equal(
    (
      await client.sources.hasPreview({
        kind: 'text'
      })
    ).value,
    true
  );
  assert.equal(
    (
      await client.sources.hasPreview({
        kind: 'image',
        mime: 'image/png'
      })
    ).value,
    true
  );
  assert.equal(
    (
      await client.sources.hasPreview({
        kind: 'image',
        mime: 'image/svg+xml'
      })
    ).value,
    false
  );
});
