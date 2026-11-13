import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Yield a typed failure instead of throwing StudyError inside an Effect generator.';

testStable('reports misuse and accepts scoped alternatives', async () => {
  assertDiagnostics(
    'effect-no-throw',
    await lintRule('effect-no-throw', {
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

testStable('limits domain throw checks to the nearest imported Effect generator', async () => {
  assertDiagnostics(
    'effect-no-throw',
    await lintRule('effect-no-throw', {
      'src/procedures/generators.ts':
        "import * as E from 'effect/Effect'; import {StudyError as Failure} from '@study/server/shared/errors'; E.fn('task')(function* () { throw new Failure('bad'); }); E.gen(function* () { function nested() { throw new Failure('ordinary'); } }); function f(E: any) { E.gen(function* () { throw new Failure('ordinary'); }); } E.gen(function* () { class Failure {} throw new Failure(); });"
    }),
    [['src/procedures/generators.ts', message]]
  );
});

testStable('canonical server error imports retain typed Effect failure enforcement', async () => {
  const diagnostics = await lintRule('effect-no-throw', {
    'src/bad.ts':
      "import { Effect } from 'effect'; import { StudyError } from '#server/shared/errors/index'; const operation = Effect.gen(function* () { throw new StudyError('internal', 'bad'); });"
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable(
  'public contracts error imports preserve the same typed Effect failure boundary',
  async () => {
    const diagnostics = await lintRule('effect-no-throw', {
      'src/domains/projects/service.ts':
        "import {Effect} from 'effect'; import {StudyError} from '@study/contracts/errors'; Effect.gen(function* () { throw new StudyError('internal', 'bad'); });"
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

testStable('enforces the Effect contract in browser operations', async () => {
  const diagnostics = await lintRule(
    'effect-no-throw',
    {
      'apps/client/src/features/example/page.logic.ts':
        "import { Effect } from 'effect'; import { StudyError } from '@study/contracts/errors'; export const task = Effect.gen(function* () { throw new StudyError('internal', 'bad'); });",
      'apps/client/src/features/example/page.logic.test.ts':
        "import { Effect } from 'effect'; import { StudyError } from '@study/contracts/errors'; export const task = Effect.gen(function* () { throw new StudyError('internal', 'bad'); });"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('keeps typed failures in native untraced generators', async () => {
  assertDiagnostics(
    'effect-no-throw',
    await lintRule('effect-no-throw', {
      'src/bad.ts':
        "import {Effect as E} from 'effect'; import {StudyError as Failure} from '@study/contracts/errors'; E.fnUntraced(function* () { throw new Failure('internal', 'bad'); }); E.fnUntracedEager(function* () { throw new Failure('internal', 'bad'); });",
      'src/good.ts':
        "import {Effect as E} from 'effect'; import {StudyError} from '@study/contracts/errors'; E.fnUntraced(function* () { yield* E.fail(new StudyError('internal', 'bad')); }); E.fnUntraced(function* () { function nested() { throw new StudyError('internal', 'sync'); } throw new Error('defect'); }); function f(E: any) { E.fnUntraced(function* () { throw new StudyError('internal', 'sync'); }); }"
    }),
    [
      ['src/bad.ts', message],
      ['src/bad.ts', message]
    ]
  );
});
