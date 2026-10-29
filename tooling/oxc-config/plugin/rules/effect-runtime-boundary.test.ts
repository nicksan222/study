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
      'src/runtime/server.ts': code,
      'src/runtime/service.ts': code,
      'src/runtime/trpc.ts': code,
      'src/client.ts': code,
      'test/testing/runtime.ts': code,
      'src/procedures/fixtures/runtime.ts': code
    }),
    [
      ['src/procedures/fixtures/runtime.ts', message],
      ['src/procedures/fixtures/runtime.ts', message]
    ]
  );
});

test('permits the durable worker owner to join its scheduler fiber', () => {
  assertDiagnostics(
    'effect-runtime-boundary',
    lintRule('effect-runtime-boundary', {
      'src/runtime/workers.ts':
        "import {Effect, Fiber} from 'effect'; const fiber = Effect.runFork(task); await Effect.runPromise(Fiber.interrupt(fiber));"
    }),
    []
  );
});
