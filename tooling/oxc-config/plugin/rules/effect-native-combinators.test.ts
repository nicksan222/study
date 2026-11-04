import { testStable } from '@study/testing/node';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Use Effect.flatten instead of an identity flatMap callback.';

testStable('prefers native flatten for pure identity callbacks', () => {
  assertDiagnostics(
    'effect-native-combinators',
    lintRule('effect-native-combinators', {
      'src/bad.ts':
        "import {Effect as E} from 'effect'; E.flatMap(x => x); E.flatMap(task, function(x) { return x; }); const identity = x => x; E.flatMap(identity);",
      'src/good.ts':
        "import {Effect as E} from 'effect'; E.flatten(task); E.flatMap(x => transform(x)); E.flatMap(x => { log(x); return x; }); E.flatMap(async x => x); E.flatMap((x = fallback()) => x); function f(E: any) { E.flatMap(x => x); }"
    }),
    [
      ['src/bad.ts', message],
      ['src/bad.ts', message],
      ['src/bad.ts', message]
    ]
  );
});

testStable('keeps callback shadowing and return bindings distinct', () => {
  assertDiagnostics(
    'effect-native-combinators',
    lintRule('effect-native-combinators', {
      'src/good.ts':
        "import {flatMap} from 'effect/Effect'; const outside = task; flatMap(x => outside); flatMap(function x(value) { return x; });"
    }),
    []
  );
});

testStable('uses asVoid for pure output discard without removing callback work', () => {
  const discard = 'Use Effect.asVoid instead of a no-op output mapping.';

  assertDiagnostics(
    'effect-native-combinators',
    lintRule('effect-native-combinators', {
      'src/bad.ts':
        "import {Effect as E} from 'effect'; E.map(task, () => undefined); E.map(() => {}); E.map(function(value) { return; }); E.as(undefined); E.as(task, undefined);",
      'src/good.ts':
        "import {Effect as E} from 'effect'; E.asVoid(task); E.map(value => { log(value); }); E.map(() => null); E.map(async () => undefined); E.map((value = work()) => undefined); E.map(({value}) => undefined); function f(undefined: number) { E.map(() => undefined); E.as(undefined); }"
    }),
    Array.from({ length: 5 }, (): [string, string] => ['src/bad.ts', discard])
  );
});
