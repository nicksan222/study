import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { sniff, viewerExtension } from '../src/sources/sniff.ts';

test('detects signatures and preserves office formats stored in zip containers', () => {
  assert.deepEqual(
    sniff('photo.bin', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    { kind: 'image', mime: 'image/png' }
  );
  assert.equal(sniff('report.docx', Uint8Array.from([0x50, 0x4b, 0x03, 0x04])).kind, 'document');
  assert.equal(viewerExtension('image', 'image/svg+xml'), null);
});
