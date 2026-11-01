import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Use Effect.flatten instead of an identity flatMap callback.';

test('prefers native flatten for pure identity callbacks', () => {
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

test('keeps callback shadowing and return bindings distinct', () => {
  assertDiagnostics(
    'effect-native-combinators',
    lintRule('effect-native-combinators', {
      'src/good.ts':
        "import {flatMap} from 'effect/Effect'; const outside = task; flatMap(x => outside); flatMap(function x(value) { return x; });"
    }),
    []
  );
});
