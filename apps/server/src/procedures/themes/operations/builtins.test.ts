import assert from 'node:assert/strict';
import { test } from 'node:test';

import { themes } from '@study/db/schema';
import { parseTheme } from '@study/theme';

import { createServerTest } from '#testing/server-test';
test('migrations install six valid protected palettes and reopening preserves changes', async (t) => {
  const f = await createServerTest(t);
  const rows = f.store.db.orm.select().from(themes).all();

  assert.deepEqual(rows.map((x) => x.id).sort(), [
    'ember',
    'grove',
    'iris',
    'ocean',
    't3-chat',
    't3-code'
  ]);

  for (const row of rows) {
    assert.equal(row.builtin, true);
    assert.deepEqual(parseTheme(JSON.stringify(row.definition)), row.definition);
    assert.ok(row.definition.light?.primary);
    assert.ok(row.definition.dark?.primary);
  }

  await assert.rejects(f.caller.themes.delete({ id: 't3-code' }));
  await assert.rejects(
    f.caller.themes.save({
      json: JSON.stringify(rows.find((row) => row.id === 't3-code')!.definition)
    })
  );
  const { ServerContext } = await import('#server/runtime/context');
  const { find } = await import('./library.ts');
  const reopened = ServerContext.open(f.store.db.path);

  try {
    assert.deepEqual(
      find(reopened, 't3-code'),
      rows.find((row) => row.id === 't3-code')!.definition
    );
  } finally {
    reopened.close();
  }
});

test('migration upserts its palette and runtime reopen does not reseed it', async (t) => {
  const f = await createServerTest(t);
  const { eq, sql } = await import('@study/db');
  const { readFileSync, readdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const folder = fileURLToPath(new URL('../drizzle/', import.meta.resolve('@study/db')));
  const migration = readdirSync(folder).find((name) => name.endsWith('_theme-t3-code'))!;
  const statement = readFileSync(`${folder}/${migration}/migration.sql`, 'utf8');
  const original = f.store.db.orm.select().from(themes).where(eq(themes.id, 't3-code')).get()!;
  const modified = { ...original.definition, name: 'Modified' };

  f.store.db.orm
    .update(themes)
    .set({ definition: modified, builtin: false })
    .where(eq(themes.id, 't3-code'))
    .run();
  const { ServerContext } = await import('#server/runtime/context');
  const reopened = ServerContext.open(f.store.db.path);

  try {
    assert.equal(
      reopened.db.orm.select().from(themes).where(eq(themes.id, 't3-code')).get()?.definition.name,
      'Modified'
    );
  } finally {
    reopened.close();
  }

  f.store.db.orm.run(sql.raw(statement));
  f.store.db.orm.run(sql.raw(statement));
  assert.deepEqual(
    f.store.db.orm.select().from(themes).where(eq(themes.id, 't3-code')).get(),
    original
  );
});
