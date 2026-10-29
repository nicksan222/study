import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Handle or propagate Effect failures explicitly instead of silently discarding them.';

test('reports misuse and accepts scoped alternatives', () => {
  assertDiagnostics(
    'effect-no-swallowed-failures',
    lintRule('effect-no-swallowed-failures', {
      'src/procedures/bad.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.ignore(E.fail('bad')); E.catch(() => E.void); E.catchCause(() => E.succeed(null));",
      'src/procedures/good.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.catchTag('Missing', () => E.succeed(null)); E.catch(error => E.fail(error));",
      'src/procedures/example.test.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.ignore(E.fail('bad')); E.catch(() => E.void); E.catchCause(() => E.succeed(null));"
    }),
    [
      ['src/procedures/bad.ts', message],
      ['src/procedures/bad.ts', message],
      ['src/procedures/bad.ts', message]
    ]
  );
});
test('resolves imported namespaces, named imports, const aliases and shadowing', () => {
  assertDiagnostics(
    'effect-no-swallowed-failures',
    lintRule('effect-no-swallowed-failures', {
      'src/procedures/aliases.ts':
        "import * as E from 'effect/Effect'; import { ignore as operation } from 'effect/Effect'; const alias = E; alias.ignore(E.void); operation(E.void); function f(E: any, operation: any) { E.ignore(E.void); operation(E.void); }"
    }),
    [
      ['src/procedures/aliases.ts', message],
      ['src/procedures/aliases.ts', message]
    ]
  );
});

test('rejects silent statement blocks and allows explicit propagation and tagged recovery', () => {
  assertDiagnostics(
    'effect-no-swallowed-failures',
    lintRule('effect-no-swallowed-failures', {
      'src/procedures/catches.ts':
        "import {Effect as E} from 'effect'; E.catch(error => { const ignored = error; return E.void; }); E.catchCause(() => {}); E.catch(error => { log(error); return E.fail(error); }); E.catch(error => { log(error); throw error; }); E.catchTag('Missing', () => E.succeed(null));"
    }),
    [
      ['src/procedures/catches.ts', message],
      ['src/procedures/catches.ts', message]
    ]
  );
});
