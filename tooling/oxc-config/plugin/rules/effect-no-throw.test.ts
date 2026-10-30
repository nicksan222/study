import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Yield a typed failure instead of throwing StudyError inside an Effect generator.';

test('reports misuse and accepts scoped alternatives', () => {
  assertDiagnostics(
    'effect-no-throw',
    lintRule('effect-no-throw', {
      'src/procedures/bad.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.gen(function* () { throw new StudyError('bad'); });",
      'src/procedures/good.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; function f() { throw new StudyError('bad'); } E.gen(function* () { throw new Error('defect'); });",
      'src/procedures/example.test.ts':
        "import { Effect as E } from 'effect'; import { StudyError } from '@study/server/shared/errors'; E.gen(function* () { throw new StudyError('bad'); });"
    }),
    [['src/procedures/bad.ts', message]]
  );
});

test('limits domain throw checks to the nearest imported Effect generator', () => {
  assertDiagnostics(
    'effect-no-throw',
    lintRule('effect-no-throw', {
      'src/procedures/generators.ts':
        "import * as E from 'effect/Effect'; import {StudyError as Failure} from '@study/server/shared/errors'; E.fn('task')(function* () { throw new Failure('bad'); }); E.gen(function* () { function nested() { throw new Failure('ordinary'); } }); function f(E: any) { E.gen(function* () { throw new Failure('ordinary'); }); } E.gen(function* () { class Failure {} throw new Failure(); });"
    }),
    [['src/procedures/generators.ts', message]]
  );
});

test('canonical server error imports retain typed Effect failure enforcement', () => {
  const diagnostics = lintRule('effect-no-throw', {
    'src/bad.ts':
      "import { Effect } from 'effect'; import { StudyError } from '#server/shared/errors/index'; const operation = Effect.gen(function* () { throw new StudyError('internal', 'bad'); });"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('public contracts error imports preserve the same typed Effect failure boundary', () => {
  const diagnostics = lintRule('effect-no-throw', {
    'src/domains/projects/service.ts':
      "import {Effect} from 'effect'; import {StudyError} from '@study/contracts/errors'; Effect.gen(function* () { throw new StudyError('internal', 'bad'); });"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('enforces the Effect contract in browser operations', () => {
  const diagnostics = lintRule(
    'effect-no-throw',
    {
      'apps/web/src/features/example/page.logic.ts':
        "import { Effect } from 'effect'; import { StudyError } from '@study/contracts/errors'; export const task = Effect.gen(function* () { throw new StudyError('internal', 'bad'); });",
      'apps/web/src/features/example/page.logic.test.ts':
        "import { Effect } from 'effect'; import { StudyError } from '@study/contracts/errors'; export const task = Effect.gen(function* () { throw new StudyError('internal', 'bad'); });"
    },
    true
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});
