import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Consume Effect computations with yield*, return, or an approved runtime boundary.';

test('reports misuse and accepts scoped alternatives', () => {
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
test('resolves imported namespaces, named imports, const aliases and shadowing', () => {
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

test('checks known Effect values and pipelines without guessing arbitrary service returns', () => {
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
});

test('recognizes canonical Effect constants through imported aliases', () => {
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

test('void and await do not execute Effects but terminal runtime pipelines do', () => {
  const diagnostics = lintRule('effect-no-discarded', {
    'src/bad.ts':
      "import { Effect } from 'effect'; void Effect.sync(() => work()); async function operation() { await Effect.sync(() => work()); }",
    'src/runtime/main.ts':
      "import { Effect } from 'effect'; Effect.sync(() => work()).pipe(Effect.runSync); void Effect.sync(() => work()).pipe(Effect.runPromise);"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});
