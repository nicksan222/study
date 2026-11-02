/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks that lifecycle diagnostics preserve the standard TAP output stream.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps test stdout and the TAP plan available alongside execution diagnostics.          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses public Node reporter events; CLI loading is covered by automatic fixture tests.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { TestEvent } from 'node:test/reporters';

import progress from '#testing/progress';

test('progress reporting preserves test output and the TAP plan', async () => {
  const events: TestEvent[] = [
    {
      type: 'test:stdout',
      data: { file: 'fixture.test.ts', message: 'retained fixture output\n' }
    },
    { type: 'test:plan', data: { nesting: 0, count: 0 } }
  ];

  let output = '';

  for await (const chunk of progress(Readable.from(events))) output += chunk;

  assert.match(output, /TAP version 13/);
  assert.match(output, /retained fixture output/);
  assert.match(output, /1\.\.0/);
});
