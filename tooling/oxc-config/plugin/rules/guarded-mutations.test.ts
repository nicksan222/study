import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('reports guarded-mutations', () => {
  const diagnostics = lintRule('guarded-mutations', {
    'src/bad.ts':
      "import type { Db } from '@study/db'; function f(db: Db) { db.orm.delete(items).run(); }"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('guards executed mutations and top-level SQL predicates', () => {
  const diagnostics = lintRule('guarded-mutations', {
    'src/bad.ts':
      "import type { Db } from '@study/db'; import { sql as q } from '@study/db'; function f(db: Db) { const b = db.orm.update(items).set({}); b.run(); db.orm.delete(items).where(undefined).run(); q`WITH c AS (SELECT * FROM x WHERE id = 1) DELETE FROM items`; q`UPDATE items SET x = 'WHERE' /* WHERE */`; }",
    'src/good.ts':
      "import type { Db } from '@study/db'; import * as d from '@study/db'; function f(db: Db, other) { db.orm.delete(items).where(eq(items.id, id)).run(); other.orm.delete(items).run(); d.sql`UPDATE items SET x = 1 WHERE id = 2`; function g(d) { d.sql`DELETE FROM x`; } }"
  });

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test('upserts stay targeted while trivial predicates and later unguarded statements fail', () => {
  const diagnostics = lintRule('guarded-mutations', {
    'src/domains/preferences/store.ts':
      "import { sql } from '@study/db'; sql`INSERT INTO prefs VALUES (1) ON CONFLICT(id) DO UPDATE SET value=1`; sql`DELETE FROM prefs WHERE 1=1`; sql`UPDATE prefs SET value=1 WHERE id=1; DELETE FROM prefs`;",
    'src/domains/projects/store.ts':
      "import { sql } from '@study/db'; import type { ServerContext } from '#server/runtime/context'; function f(ctx: ServerContext) { ctx.db.orm.delete(table).where(sql`1 = 1`).run(); ctx.db.orm.delete(table).where(sql`id=1`).run(); }"
  });

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test('unconditional OR branches fail while a false conjunct does not become a tautology', () => {
  const diagnostics = lintRule('guarded-mutations', {
    'src/domains/projects/store.ts':
      "import {sql} from '@study/db'; sql`DELETE FROM projects WHERE 1=1 OR id=2`; sql`DELETE FROM projects WHERE id=2 OR (TRUE)`; sql`DELETE FROM projects WHERE (1=1 OR id=2) AND active=1`; sql`DELETE FROM projects WHERE (1=1) OR (id=2)`;"
  });

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test('recognizes bound store resources while respecting shadowed names', () => {
  const diagnostics = lintRule('guarded-mutations', {
    'src/features/items/store/index.ts': `
      import { defineStore } from '#server/platform/definitions/define-store';
      import type { StoreResources } from '#server/platform/definitions/define-store';
      defineStore({ make: ({ db: database }) => { const alias = database; alias.orm.delete(items).run(); function nested(database) { database.orm.delete(items).run(); } return {}; } });
      function makeReads({ db }: StoreResources) { const alias = db; alias.orm.delete(items).run(); }
    `
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('recognizes a named make callback and resource object aliases', () => {
  const diagnostics = lintRule('guarded-mutations', {
    'src/features/items/store/index.ts': `
      import { defineStore } from '#server/platform/definitions/define-store';
      import type { StoreResources as Resources } from '#server/platform/definitions/define-store';
      const build = ({db}) => { db.orm.delete(items).run(); return {}; };
      defineStore({make: build});
      function makeReads(resources: Resources) { const db = resources.db; db.orm.delete(items).run(); }
    `
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('tracks contextual resource objects and destructured aliases into helpers', () => {
  const diagnostics = lintRule('guarded-mutations', {
    'src/features/items/store/index.ts': `import { defineStore } from '#server/platform/definitions/define-store'; defineStore({make: resources => { const {db: database} = resources; const alias = database; function helper() { alias.orm.delete(items).run(); } return {queries: {}, mutations: {}}; }});`
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('tracks aliased and namespace StoreResources helper parameters', () => {
  const diagnostics = lintRule('guarded-mutations', {
    'src/features/items/store/read.ts': `import type * as Store from '../../../platform/definitions/define-store'; type Resources = Store.StoreResources; function makeReads({db}: Resources) { db.orm.delete(items).run(); } function shadow(Store: {db: any}) { Store.db.orm.delete(items).run(); }`
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('tracks resources through an aliased store descriptor', () => {
  const diagnostics = lintRule('guarded-mutations', {
    'src/features/items/store/index.ts': `import {defineStore} from '#server/platform/definitions/define-store'; const descriptor = {make: ({db}) => { db.orm.delete(items).run(); return {queries: {}, mutations: {}}; }}; const alias = descriptor; defineStore(alias);`
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});
