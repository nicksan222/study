import { testStable } from '@study/testing/vitest';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Read native clocks only in platform/time; consume testable time elsewhere.';

testStable(
  'recognizes native clocks and aliases while permitting parsing, owner, tests and shadowing',
  async () => {
    assertDiagnostics(
      'native-clock',
      await lintRule('native-clock', {
        'src/features/a/service.ts':
          'const D = Date; const now = D.now; now(); new D(); performance.now(); new Date(0); function f(Date: any, performance: any) { Date.now(); new Date(); performance.now(); }',
        'src/platform/time/index.ts': 'Date.now(); new Date(); performance.now();',
        'src/features/a/service.test.ts': 'Date.now();'
      }),
      [
        ['src/features/a/service.ts', message],
        ['src/features/a/service.ts', message],
        ['src/features/a/service.ts', message]
      ]
    );
  }
);
testStable('recognizes node clock imports and destructured clock methods', async () => {
  assertDiagnostics(
    'native-clock',
    await lintRule('native-clock', {
      'src/platform/worker.ts':
        "import { performance as perf } from 'node:perf_hooks'; import * as process from 'node:process'; const { now } = Date; now(); perf.now(); process.hrtime.bigint(); function f(perf: any) { perf.now(); }"
    }),
    [
      ['src/platform/worker.ts', message],
      ['src/platform/worker.ts', message],
      ['src/platform/worker.ts', message]
    ]
  );
});

testStable(
  'Date function calls read the clock even with arguments, while shadows remain legal',
  async () => {
    assertDiagnostics(
      'native-clock',
      await lintRule('native-clock', {
        'src/features/a/service.ts': `
        Date();
        const current = Date;
        current(0);
        const { Date: ClockDate } = globalThis;
        ClockDate();
        Date.parse('2026-01-01');
        function local(Date) { Date(); }
      `
      }),
      [
        ['src/features/a/service.ts', message],
        ['src/features/a/service.ts', message],
        ['src/features/a/service.ts', message]
      ]
    );
  }
);

testStable('managed artifact timestamps use the injected native clock', async () => {
  assertDiagnostics(
    'native-clock',
    await lintRule('native-clock', {
      'src/platform/database/backups.ts':
        'const current = Date.now; current(); clock.currentTimeMillisUnsafe();'
    }),
    [['src/platform/database/backups.ts', message]]
  );
});
