import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('reports the prohibited pattern', () => {
  const diagnostics = lintRule(
    'effect-lazy-boundary',
    { 'src/domain.ts': "import { Effect } from 'effect'; Effect.sync(async () => 1);" },
    false
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('checks imported Effect aliases, lazy IO, mapped promises and shadowing', () => {
  const diagnostics = lintRule('effect-lazy-boundary', {
    'src/a.ts':
      "import * as E from 'effect/Effect'; const alias = E; alias.sync(() => JSON.parse(text)); alias.succeed(Date.now()); Promise.all(items.map(async x => x)); function f(E: any, Promise: any) { E.sync(async () => 1); Promise.all(items.map(async x => x)); } alias.sync(() => 1); Promise.all([Promise.resolve(1)]);"
  });

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test('recognizes fs and Promise aliases and async try object while respecting resource path', () => {
  const diagnostics = lintRule('effect-lazy-boundary', {
    'src/a.ts':
      "import { Effect } from 'effect'; import { readFileSync as read } from 'node:fs'; const readAlias = read; const all = Promise.all; const task = () => Promise.resolve(1); Effect.sync(() => readAlias('x')); Effect.try({ try: async () => 1, catch: e => e }); all(items.map(task));",
    'src/ai/runtime/resourceAnything.ts':
      "import { Effect } from 'effect'; Effect.uninterruptible(work);"
  });

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test('deferred nested functions remain lazy and eager filesystem calls do not', () => {
  const diagnostics = lintRule('effect-lazy-boundary', {
    'src/a.ts':
      "import {Effect} from 'effect'; import {readFileSync} from 'node:fs'; Effect.sync(() => () => JSON.parse(text)); Effect.sync(() => { function deferred() { return Promise.resolve(1); } return deferred; }); Effect.succeed(readFileSync(path)); Effect.sync(() => { JSON.parse(text); return 1; });"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('rejects recognized database execution during store construction but allows deferred operations', () => {
  const diagnostics = lintRule('effect-lazy-boundary', {
    'src/features/a/store/index.ts': `import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; defineStore({make: ({db}) => { const alias = db; alias.orm.select().from(items).get(); db.orm.update(items).set({x: 1}).where(eq(items.id, 1)).run(); const helper = () => db.orm.select().from(items).all(); unrelated.run(); return {queries: {read: storeQuery({run: input => db.orm.select().from(items).get()})}, mutations: {}}; }});`
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('direct SQL execution stays deferred until a store operation runs', () => {
  const diagnostics = lintRule('effect-lazy-boundary', {
    'src/features/a/store/index.ts': `import { defineStore, storeQuery } from '#server/platform/definitions/define-store'; import { sql } from '@study/db'; defineStore({make: ({db}) => { const orm = db.orm; orm.get(sql\`SELECT 1\`); db.orm.run(sql\`DELETE FROM items WHERE id=1\`); db.orm.all(sql\`SELECT 1\`); const deferred = () => db.orm.get(sql\`SELECT 1\`); unrelated.get(sql\`SELECT 1\`); return {queries: {item: storeQuery({run: input => db.orm.get(sql\`SELECT 1\`)})}, mutations: {}}; }});`
  });

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});
