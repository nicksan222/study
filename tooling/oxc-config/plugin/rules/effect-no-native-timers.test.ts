import { test } from '@study/testing';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Use Effect.sleep or a scoped Effect schedule instead of native timers in application operations.';

test.unit.stable(
  'uses Effect scheduling instead of native server timers',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-no-native-timers', {
      'src/workers/unsafe.ts': 'setTimeout(work, 100);',
      'src/workers/safe.ts': 'function f(setTimeout) { setTimeout(work, 100); }',
      'src/workers/unsafe.test.ts': 'setTimeout(work, 100);',
      'client/browser.ts': 'setTimeout(work, 100);'
    });

    assertDiagnostics({ assert, expect }, 'effect-no-native-timers', diagnostics, [
      ['src/workers/unsafe.ts', message]
    ]);
  }
);

test.unit.stable(
  'rejects imported timers and global aliases',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-no-native-timers', {
      'src/workers/example.ts': String.raw`import { setTimeout as later } from "node:timers";
const tick = globalThis.setInterval;
tick(work, 10);`
    });

    assertDiagnostics({ assert, expect }, 'effect-no-native-timers', diagnostics, [
      ['src/workers/example.ts', message],
      ['src/workers/example.ts', message]
    ]);
  }
);

test.unit.stable(
  'permits the native callback transport adapter',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-no-native-timers', {
      'src/runtime/server.ts': "import { setTimeout } from 'node:timers'; setTimeout(work, 1);"
    });

    assertDiagnostics({ assert, expect }, 'effect-no-native-timers', diagnostics, []);
  }
);

test.unit.stable(
  'ignores unrelated methods and shadowed globals',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-no-native-timers', {
      'src/workers/example.ts': String.raw`function f(globalThis) {
  globalThis.setTimeout(work, 1);
}
const other = { setTimeout() {} };
other.setTimeout();`
    });

    assertDiagnostics({ assert, expect }, 'effect-no-native-timers', diagnostics, []);
  }
);

test.unit.stable(
  'rejects native abort deadlines while preserving cancellation composition',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-no-native-timers', {
      'src/platform/ai/providers/example.ts': `
      AbortSignal.timeout(1000);
      const deadline = globalThis.AbortSignal.timeout;
      deadline(1000);
      const { timeout: expire } = AbortSignal;
      expire(1000);
      AbortSignal.any([signal]);
      function local(AbortSignal) { AbortSignal.timeout(1000); }
      const transport = { timeout(ms) {} };
      transport.timeout(1000);
    `
    });

    assertDiagnostics({ assert, expect }, 'effect-no-native-timers', diagnostics, [
      ['src/platform/ai/providers/example.ts', message],
      ['src/platform/ai/providers/example.ts', message],
      ['src/platform/ai/providers/example.ts', message]
    ]);
  }
);

test.unit.stable(
  'uses Effect scheduling instead of native browser timers',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'effect-no-native-timers',
      {
        'apps/client/src/features/example/page.logic.ts':
          'export const task = setTimeout(() => {}, 10);',
        'apps/client/src/features/example/page.logic.test.ts':
          'export const task = setTimeout(() => {}, 10);'
      },
      true
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'allows a debounce timeout owned by a React hook effect',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lintRule(
        { assert },
        'effect-no-native-timers',
        {
          'apps/client/src/app/shell/use-sidebar.ts': `
      import { useEffect as effect } from 'react';
      effect(() => {
        const timer = setTimeout(updateSearch, 200);
        return () => clearTimeout(timer);
      }, [query]);
    `
        },
        true
      )
    ).toStrictEqual([]);
  }
);
