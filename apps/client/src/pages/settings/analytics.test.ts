import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { diagnosticEntries } from './analytics';

testStable('keeps continuation lines with the event they describe', () => {
  expect(
    diagnosticEntries(
      '2026-01-01T00:00:00Z ERROR panic\n  backtrace\n2026-01-01T00:00:01Z INFO ready\n'
    )
  ).toEqual([
    '2026-01-01T00:00:00Z ERROR panic\n  backtrace\n',
    '2026-01-01T00:00:01Z INFO ready\n'
  ]);
  expect(diagnosticEntries('')).toEqual([]);
});
