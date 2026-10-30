import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Run Effects and construct ManagedRuntime only at approved server runtime boundaries.';

test('reports misuse and accepts scoped alternatives', () => {
  assertDiagnostics(
    'effect-runtime-boundary',
    lintRule('effect-runtime-boundary', {
      'src/procedures/bad.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.runPromise(E.void);",
      'src/procedures/good.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; export const task = E.succeed(1); function f(E: any) { E.runPromise(1); }",
      'src/procedures/example.test.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.runPromise(E.void);"
    }),
    [['src/procedures/bad.ts', message]]
  );
});
test('resolves imported namespaces, named imports, const aliases and shadowing', () => {
  assertDiagnostics(
    'effect-runtime-boundary',
    lintRule('effect-runtime-boundary', {
      'src/procedures/aliases.ts':
        "import * as E from 'effect/Effect'; import { runSync as operation } from 'effect/Effect'; const alias = E; alias.runSync(E.void); operation(E.void); function f(E: any, operation: any) { E.runSync(E.void); operation(E.void); }"
    }),
    [
      ['src/procedures/aliases.ts', message],
      ['src/procedures/aliases.ts', message]
    ]
  );
});

test('permits runtime adapters and tests but checks domain fixtures', () => {
  const code =
    "import { Effect as E, ManagedRuntime as M } from 'effect'; E.runPromise(E.void); M.make(layer);";

  assertDiagnostics(
    'effect-runtime-boundary',
    lintRule('effect-runtime-boundary', {
      'src/runtime/main.ts': code,
      'test/testing/runtime.ts': code,
      'src/procedures/fixtures/runtime.ts': code
    }),
    [
      ['src/procedures/fixtures/runtime.ts', message],
      ['src/procedures/fixtures/runtime.ts', message]
    ]
  );
});

test('requires the durable worker to use scoped fibers rather than execute a detached runtime', () => {
  assertDiagnostics(
    'effect-runtime-boundary',
    lintRule('effect-runtime-boundary', {
      'src/runtime/workers.ts':
        "import {Effect, Fiber} from 'effect'; const fiber = Effect.runFork(task); await Effect.runPromise(Fiber.interrupt(fiber));"
    }),
    [
      ['src/runtime/workers.ts', message],
      ['src/runtime/workers.ts', message]
    ]
  );
});

test('target architecture limits execution and runtime construction to their explicit owners', () => {
  const diagnostics = lintRule('effect-runtime-boundary', {
    'src/runtime/request.ts': "import { Effect } from 'effect'; Effect.runPromise(task);",
    'src/runtime/layers.ts': "import { ManagedRuntime } from 'effect'; ManagedRuntime.make(layer);",
    'src/platform/ai/tool-adapter.ts': "import { Effect } from 'effect'; Effect.runPromise(tool);",
    'src/domains/jobs/runner.ts': "import { Effect } from 'effect'; Effect.runFork(poll);",
    'src/runtime/service.ts': "import { ManagedRuntime } from 'effect'; ManagedRuntime.make(layer);"
  });

  assertDiagnostics('effect-runtime-boundary', diagnostics, [
    ['src/runtime/request.ts', message],
    ['src/domains/jobs/runner.ts', message],
    ['src/runtime/service.ts', message]
  ]);
});

test('context-taking runners stay at the scoped callback or synchronous observation bridge', () => {
  const diagnostics = lintRule('effect-runtime-boundary', {
    'src/domains/jobs/service.ts':
      "import {Effect} from 'effect'; Effect.runSyncWith(context)(task); Effect.runPromiseWith(context)(task);",
    'src/platform/observability/index.ts':
      "import {Effect} from 'effect'; Effect.runSyncWith(context)(task); Effect.runPromise(task);",
    'src/runtime/request.ts': "import {Effect} from 'effect'; Effect.runSyncWith(context)(task);"
  });

  assertDiagnostics('effect-runtime-boundary', diagnostics, [
    ['src/domains/jobs/service.ts', message],
    ['src/domains/jobs/service.ts', message],
    ['src/platform/observability/index.ts', message],
    ['src/runtime/request.ts', message]
  ]);
});

test('the scoped AI callback bridge is canonical and retired paths cannot execute Effects', () => {
  const diagnostics = lintRule('effect-runtime-boundary', {
    'src/platform/ai/tool-adapter.ts':
      "import {Effect} from 'effect'; Effect.runPromiseExit(check);",
    'src/ai/runtime/tool-adapter.ts': "import {Effect} from 'effect'; Effect.runPromiseExit(check);"
  });

  assertDiagnostics('effect-runtime-boundary', diagnostics, [
    ['src/ai/runtime/tool-adapter.ts', message]
  ]);
});

test('only the exported HTTP Promise bridge can execute an HTTP Effect', () => {
  const diagnostics = lintRule('effect-runtime-boundary', {
    'src/platform/http/index.ts': `
      import { Effect as E } from 'effect';
      export function runHttpPromise(task) {
        const pending = E.runPromise(task);
        E.runSync(task);
        return pending;
      }
      function elsewhere(task) { return E.runPromise(task); }
    `,
    'src/platform/http/other.ts': `
      import { Effect } from 'effect';
      export function runHttpPromise(task) { return Effect.runPromise(task); }
    `
  });

  assertDiagnostics('effect-runtime-boundary', diagnostics, [
    ['src/platform/http/index.ts', message],
    ['src/platform/http/index.ts', message],
    ['src/platform/http/other.ts', message]
  ]);
});
