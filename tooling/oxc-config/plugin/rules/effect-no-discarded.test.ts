import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Consume Effect computations with yield*, return, or an approved runtime boundary.';

testStable('reports misuse and accepts scoped alternatives', () => {
  assertDiagnostics(
    'effect-no-discarded',
    lintRule('effect-no-discarded', {
      'src/procedures/bad.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.succeed(1); const task = E.fn(function* () { return 1; }); task();",
      'src/procedures/good.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; const task = E.gen(function* () { return 1; }); function f(E: any) { E.succeed(1); } E.runSync(task);",
      'src/procedures/example.test.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.succeed(1); const task = E.fn(function* () { return 1; }); task();"
    }),
    [
      ['src/procedures/bad.ts', message],
      ['src/procedures/bad.ts', message]
    ]
  );
});
testStable('resolves imported namespaces, named imports, const aliases and shadowing', () => {
  assertDiagnostics(
    'effect-no-discarded',
    lintRule('effect-no-discarded', {
      'src/procedures/aliases.ts':
        "import * as E from 'effect/Effect'; import { succeed as operation } from 'effect/Effect'; const alias = E; alias.succeed(1); operation(1); function f(E: any, operation: any) { E.succeed(1); operation(1); }"
    }),
    [
      ['src/procedures/aliases.ts', message],
      ['src/procedures/aliases.ts', message]
    ]
  );
});

testStable(
  'checks known Effect values and pipelines without guessing arbitrary service returns',
  () => {
    assertDiagnostics(
      'effect-no-discarded',
      lintRule('effect-no-discarded', {
        'src/procedures/values.ts':
          "import {Effect as E} from 'effect'; const task = E.gen(function* () { return 1; }); task; E.succeed(1).pipe(E.map(x => x)); unknownService.operation(); const fn = E.fn('named')(function* () { return 1; }); fn();"
      }),
      [
        ['src/procedures/values.ts', message],
        ['src/procedures/values.ts', message],
        ['src/procedures/values.ts', message]
      ]
    );
  }
);

testStable('recognizes canonical Effect constants through imported aliases', () => {
  assertDiagnostics(
    'effect-no-discarded',
    lintRule('effect-no-discarded', {
      'src/procedures/constants.ts':
        "import * as E from 'effect/Effect'; import {void as done} from 'effect/Effect'; E.void; done;"
    }),
    [
      ['src/procedures/constants.ts', message],
      ['src/procedures/constants.ts', message]
    ]
  );
});

testStable('void and await do not execute Effects but terminal runtime pipelines do', () => {
  const diagnostics = lintRule('effect-no-discarded', {
    'src/bad.ts':
      "import { Effect } from 'effect'; void Effect.sync(() => work()); async function operation() { await Effect.sync(() => work()); }",
    'src/runtime/main.ts':
      "import { Effect } from 'effect'; Effect.sync(() => work()).pipe(Effect.runSync); void Effect.sync(() => work()).pipe(Effect.runPromise);"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

testStable('enforces the Effect contract in browser operations', () => {
  const diagnostics = lintRule(
    'effect-no-discarded',
    {
      'apps/web/src/features/example/page.logic.ts':
        "import { Effect } from 'effect'; Effect.succeed(1);",
      'apps/web/src/features/example/page.logic.test.ts':
        "import { Effect } from 'effect'; Effect.succeed(1);"
    },
    true
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('consumes v4 constructors, scheduler values and untraced operations', () => {
  const diagnostics = lintRule('effect-no-discarded', {
    'src/bad.ts':
      "import {Effect as E} from 'effect'; E.flatten(task); E.asVoid(task); E.andThen(task, next); E.callback(resume => resume(E.void)); E.forkIn(task, scope); E.yieldNow; const run = E.fnUntraced(function* () { return 1; }); run(); E.fnUntracedEager(function* () { return 1; })();",
    'src/good.ts':
      "import {Effect as E} from 'effect'; const task = E.flatten(other); const run = E.fnUntraced(function* () { yield* E.yieldNow; return yield* task; }); function f(E: any) { E.flatten(task); }"
  });

  assertDiagnostics(
    'effect-no-discarded',
    diagnostics,
    Array.from({ length: 8 }, (): [string, string] => ['src/bad.ts', message])
  );
});

testStable('recognizes applied data-last v4 computations', () => {
  assertDiagnostics(
    'effect-no-discarded',
    lintRule('effect-no-discarded', {
      'src/bad.ts':
        "import {Effect as E} from 'effect'; E.forkIn(scope)(task); E.andThen(next)(task);",
      'src/good.ts': "import {Effect as E} from 'effect'; const task = E.andThen(next)(previous);"
    }),
    [
      ['src/bad.ts', message],
      ['src/bad.ts', message]
    ]
  );
});

testStable('permits functions with terminal transformations that change the return type', () => {
  assertDiagnostics(
    'effect-no-discarded',
    lintRule('effect-no-discarded', {
      'src/runtime/main.ts':
        "import {Effect as E} from 'effect'; const run = E.fnUntraced(function* () { return 7; }, E.runSync); run(); E.fnUntracedEager(function* () { return 8; }, E.runSync)(); const traced = E.fn('run')(function* () { return 9; }, E.runSync); traced();"
    }),
    []
  );
});
