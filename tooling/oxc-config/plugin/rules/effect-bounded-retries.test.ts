import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Bound retries with a finite times count or a bounded Schedule.recurs; use a bounded helper for opaque schedules.';

test('reports unsafe server lifecycle syntax and permits bounded operations', () => {
  const diagnostics = lintRule('effect-bounded-retries', {
    'src/workers/unsafe.ts': "import { Effect as E } from 'effect'; E.retry(work, policy);",
    'src/workers/safe.ts':
      "import { Effect as E, Schedule as S } from 'effect'; E.retry(work, { times: 3 }); E.retry(work, S.recurs(4));",
    'src/workers/unsafe.test.ts': "import { Effect as E } from 'effect'; E.retry(work, policy);",
    'client/browser.ts': "import { Effect as E } from 'effect'; E.retry(work, policy);"
  });

  assertDiagnostics('effect-bounded-retries', diagnostics, [['src/workers/unsafe.ts', message]]);
});

test('tracks named and namespace aliases and rejects infinite policies', () => {
  const diagnostics = lintRule('effect-bounded-retries', {
    'src/workers/example.ts':
      "import { retry as again } from 'effect/Effect'; import * as S from 'effect/Schedule'; again(work, S.forever); again({ schedule: S.exponential('1 second') });"
  });

  assertDiagnostics('effect-bounded-retries', diagnostics, [
    ['src/workers/example.ts', message],
    ['src/workers/example.ts', message]
  ]);
});

test('accepts options and v4 intersection schedules', () => {
  const diagnostics = lintRule('effect-bounded-retries', {
    'src/workers/example.ts':
      "import { Effect as E, Schedule as S } from 'effect'; E.retry(work, { schedule: S.recurs(2) }); E.retry(work, S.max([S.exponential('1 second'), S.recurs(3)])); E.retry(work, S.min([S.recurs(1), S.recurs(2)]));"
  });

  assertDiagnostics('effect-bounded-retries', diagnostics, []);
});

test('does not prove runtime schedules or union with an unbounded branch', () => {
  const diagnostics = lintRule('effect-bounded-retries', {
    'src/workers/example.ts':
      "import { Effect as E, Schedule as S } from 'effect'; E.retry(work, S.recurs(limit)); E.retry(work, S.min([S.forever, S.recurs(2)]));"
  });

  assertDiagnostics('effect-bounded-retries', diagnostics, [
    ['src/workers/example.ts', message],
    ['src/workers/example.ts', message]
  ]);
});

test('ignores shadowed and unrelated retry methods', () => {
  const diagnostics = lintRule('effect-bounded-retries', {
    'src/workers/example.ts':
      "import { Effect as E } from 'effect'; function f(E) { E.retry(work, policy); } other.retry(work, policy);"
  });

  assertDiagnostics('effect-bounded-retries', diagnostics, []);
});

test('does not assume an opaque schedule transformation preserves its bound', () => {
  const diagnostics = lintRule('effect-bounded-retries', {
    'src/workers/opaque.ts':
      "import { Effect as E, Schedule as S } from 'effect'; E.retry(work, S.recurs(2).pipe(transform)); E.retry(work, S.recurs(2).pipe(S.union(S.forever)));"
  });

  assertDiagnostics('effect-bounded-retries', diagnostics, [
    ['src/workers/opaque.ts', message],
    ['src/workers/opaque.ts', message]
  ]);
});
