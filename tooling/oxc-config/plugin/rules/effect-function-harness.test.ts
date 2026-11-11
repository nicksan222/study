import { testStable } from '@study/testing/vitest';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Use Effect.fnUntraced for generator-backed functions instead of an arrow wrapping Effect.gen.';

testStable(
  'feature generator functions use the native function harness without extra wrappers',
  async () => {
    assertDiagnostics(
      'effect-function-harness',
      await lintRule('effect-function-harness', {
        'src/features/notes/service/bad.ts':
          "import {Effect as E} from 'effect'; export const run = (value: string) => E.gen(function* () { yield* task; return value; });",
        'src/features/notes/service/good.ts':
          "import {Effect} from 'effect'; export const run = Effect.fnUntraced(function* (value: string) { yield* task; return value; }); const plain = Effect.gen(function* () { yield* task; }); const piped = () => Effect.gen(function* () { yield* task; }).pipe(transform); const delegated = () => Effect.gen(named); function f(Effect: any) { return () => Effect.gen(function* () { yield* task; }); }"
      }),
      [['src/features/notes/service/bad.ts', message]]
    );
  }
);
