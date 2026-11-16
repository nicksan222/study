import { test } from '@study/testing';

import { sniff, viewerExtension } from '../src/sources/sniff.ts';

test.unit.stable(
  'detects signatures and preserves office formats stored in zip containers',
  ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      sniff('photo.bin', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ).toStrictEqual({ kind: 'image', mime: 'image/png' });
    assert.strictEqual(
      sniff('report.docx', Uint8Array.from([0x50, 0x4b, 0x03, 0x04])).kind,
      'document'
    );
    assert.strictEqual(viewerExtension('image', 'image/svg+xml'), null);
  }
);
