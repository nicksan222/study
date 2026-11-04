import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

testStable('reports the prohibited pattern', () => {
  const diagnostics = lintRule(
    'effect-lazy-boundary',
    { 'src/domain.ts': "import { Effect } from 'effect'; Effect.sync(async () => 1);" },
    false
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('checks imported Effect aliases, lazy IO, mapped promises and shadowing', () => {
  const diagnostics = lintRule('effect-lazy-boundary', {
    'src/a.ts':
      "import * as E from 'effect/Effect'; const alias = E; alias.sync(() => JSON.parse(text)); alias.succeed(Date.now()); Promise.all(items.map(async x => x)); function f(E: any, Promise: any) { E.sync(async () => 1); Promise.all(items.map(async x => x)); } alias.sync(() => 1); Promise.all([Promise.resolve(1)]);"
  });

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

testStable(
  'recognizes fs and Promise aliases and async try object while respecting resource path',
  () => {
    const diagnostics = lintRule('effect-lazy-boundary', {
      'src/a.ts':
        "import { Effect } from 'effect'; import { readFileSync as read } from 'node:fs'; const readAlias = read; const all = Promise.all; const task = () => Promise.resolve(1); Effect.sync(() => readAlias('x')); Effect.try({ try: async () => 1, catch: e => e }); all(items.map(task));",
      'src/ai/runtime/resourceAnything.ts':
        "import { Effect } from 'effect'; Effect.uninterruptible(work);"
    });

    assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

testStable('deferred nested functions remain lazy and eager filesystem calls do not', () => {
  const diagnostics = lintRule('effect-lazy-boundary', {
    'src/a.ts':
      "import {Effect} from 'effect'; import {readFileSync} from 'node:fs'; Effect.sync(() => () => JSON.parse(text)); Effect.sync(() => { function deferred() { return Promise.resolve(1); } return deferred; }); Effect.succeed(readFileSync(path)); Effect.sync(() => { JSON.parse(text); return 1; });"
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable(
  'rejects recognized database execution during store construction but allows deferred operations',
  () => {
    const diagnostics = lintRule('effect-lazy-boundary', {
      'src/features/a/store/index.ts': `import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; defineStore({make: ({db}) => { const alias = db; alias.orm.select().from(items).get(); db.orm.update(items).set({x: 1}).where(eq(items.id, 1)).run(); const helper = () => db.orm.select().from(items).all(); unrelated.run(); return {queries: {read: storeQuery({run: input => db.orm.select().from(items).get()})}, mutations: {}}; }});`
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

testStable('direct SQL execution stays deferred until a store operation runs', () => {
  const diagnostics = lintRule('effect-lazy-boundary', {
    'src/features/a/store/index.ts': `import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; import { sql } from '@study/db'; defineStore({make: ({db}) => { const orm = db.orm; orm.get(sql\`SELECT 1\`); db.orm.run(sql\`DELETE FROM items WHERE id=1\`); db.orm.all(sql\`SELECT 1\`); const deferred = () => db.orm.get(sql\`SELECT 1\`); unrelated.get(sql\`SELECT 1\`); return {queries: {item: storeQuery({run: input => db.orm.get(sql\`SELECT 1\`)})}, mutations: {}}; }});`
  });

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

const message = 'Keep Effect work lazy, synchronous where required, bounded and interruptible.';

testStable('keeps throwing schema codecs out of infallible Effect constructors', () => {
  assertDiagnostics(
    'effect-lazy-boundary',
    lintRule('effect-lazy-boundary', {
      'src/bad.ts':
        "import {Effect as E, Schema as S} from 'effect'; E.sync(() => S.decodeUnknownSync(schema)(input)); E.succeed(S.encodeSync(schema)(input)); const decode = S.decodeUnknownSync(schema); E.sync(() => decode(input));",
      'src/good.ts':
        "import {Effect as E, Schema as S} from 'effect'; const decode = S.decodeUnknownSync(schema); E.try({try: () => decode(input), catch: error => error}); E.sync(() => S.decodeUnknownEffect(schema)(input)); E.sync(() => S.decodeUnknownSync(schema)); function f(S: any) { return E.sync(() => S.decodeUnknownSync(schema)(input)); }"
    }),
    [
      ['src/bad.ts', message],
      ['src/bad.ts', message],
      ['src/bad.ts', message]
    ]
  );
});
