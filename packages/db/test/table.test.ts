import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { integer, text, blob, primaryKey } from '../src/schema-builder.ts';
import * as schema from '../src/schema.ts';
import { collectSchemaRegistry, defineTable } from '../src/table.ts';

testStable('schema registry discovers every declared table and all searchable entities', () => {
  const registry = collectSchemaRegistry(schema);

  assert.strictEqual(registry.tables.length, Object.keys(schema).length);
  expect(registry.entities.map(({ metadata }) => metadata.kind).sort()).toStrictEqual([
    'document',
    'material',
    'message',
    'passage',
    'project',
    'question',
    'session',
    'source'
  ]);
});

testStable(
  'new entities and contributors are discovered without a separate registration list',
  () => {
    const notes = defineTable({
      role: 'entity',
      projection: 'columns',
      scope: { type: 'global' },
      visibility: 'all',
      kind: 'note',
      description: 'Personal notes',
      textColumns: ['body']
    })('notes', { id: integer().primaryKey(), body: text().notNull() });
    const tags = defineTable({ role: 'contributes', entity: 'note' })('note_tags', {
      note_id: integer().notNull(),
      label: text().notNull()
    });
    const registry = collectSchemaRegistry({ notes, tags });

    assert.strictEqual(registry.entities[0]?.table, notes);
    expect(registry.tables.map(({ name }) => name)).toStrictEqual(['note_tags', 'notes']);
    assert.strictEqual(registry.entities[0]?.metadata.kind, 'note');
  }
);

testStable(
  'registry rejects missing policies, duplicate entity identities and orphan contributors',
  () => {
    const first = defineTable({
      role: 'entity',
      projection: 'feature',
      kind: 'note',
      description: 'Notes'
    })('notes', {
      id: integer()
    });
    const second = defineTable({
      role: 'entity',
      projection: 'feature',
      kind: 'note',
      description: 'Other notes'
    })('other_notes', { id: integer() });
    const orphan = defineTable({ role: 'contributes', entity: 'missing' })('tags', {
      id: integer()
    });

    assert.throws(() => collectSchemaRegistry({ first, second }), TypeError);
    assert.throws(() => collectSchemaRegistry({ orphan }), TypeError);
    const raw = Object.create(first);

    assert.throws(() => collectSchemaRegistry({ raw }), TypeError);
    assert.throws(
      () =>
        defineTable({
          role: 'entity',
          projection: 'feature',
          kind: 'missing-id',
          description: 'Missing identity'
        })('bad_identity', { body: text() }),
      TypeError
    );
    assert.throws(
      () => defineTable({ role: 'internal', reason: ' ' })('internal', { id: integer() }),
      TypeError
    );
    assert.throws(
      () =>
        defineTable({
          role: 'entity',
          projection: 'feature',
          kind: 'note',
          description: 'Notes',
          textColumns: ['missing']
        })('broken', { id: integer() }),
      TypeError
    );
  }
);

testStable('automatic entity declarations require explicit scope and visibility policies', () => {
  const base = {
    role: 'entity',
    kind: 'note',
    description: 'Saved notes',
    projection: 'columns',
    textColumns: ['body'],
    scope: { type: 'global' },
    visibility: 'all'
  };
  const columns = () => ({
    id: integer().primaryKey(),
    body: text().notNull(),
    project_id: integer(),
    archived_at: integer(),
    deleted_at: integer(),
    status: text()
  });
  const declare = (metadata: unknown) =>
    Reflect.apply(defineTable, undefined, [metadata])('policy_notes', columns());

  for (const override of [
    { projection: undefined },
    { scope: undefined },
    { visibility: undefined },
    { textColumns: [] },
    { scope: { type: 'project', column: 'missing' } },
    { scope: { type: 'project', column: 'body' } },
    { visibility: {} },
    { visibility: { archivedColumn: undefined } },
    { visibility: { archivedColumn: 'missing' } },
    { visibility: { archivedColumn: 'body' } },
    { visibility: { deletedColumn: 'missing' } },
    { visibility: { publishedColumn: 'status' } },
    { visibility: { publishedValue: 'published' } },
    { visibility: { publishedColumn: 'project_id', publishedValue: 'published' } }
  ])
    assert.throws(() => declare({ ...base, ...override }), TypeError);

  const notes = declare({
    ...base,
    scope: { type: 'project', column: 'project_id' },
    visibility: {
      archivedColumn: 'archived_at',
      deletedColumn: 'deleted_at',
      publishedColumn: 'status',
      publishedValue: 'published'
    }
  });
  const registry = collectSchemaRegistry({ notes });

  expect(registry.entities[0]?.metadata).toMatchObject({
    projection: 'columns',
    scope: { type: 'project', column: 'project_id' },
    visibility: { publishedColumn: 'status', publishedValue: 'published' }
  });
});

testStable('automatic entity identity must be a single text or integer primary key', () => {
  const policy = {
    role: 'entity',
    projection: 'columns',
    kind: 'note',
    description: 'Saved notes',
    textColumns: ['body'],
    scope: { type: 'global' },
    visibility: 'all'
  } as const;
  const define = defineTable(policy);

  assert.throws(() => define('ordinary_id', { id: integer().notNull(), body: text() }), TypeError);
  assert.throws(
    () =>
      define(
        'composite_id',
        { id: integer().notNull(), tenant: integer().notNull(), body: text() },
        (table) => [primaryKey({ columns: [table.id, table.tenant] })]
      ),
    TypeError
  );
  assert.throws(() => define('blob_id', { id: blob().primaryKey(), body: text() }), TypeError);

  const inline = define('inline_id', { id: integer().primaryKey(), body: text() });
  const tableKey = define('table_id', { id: text().notNull(), body: text() }, (table) => [
    primaryKey({ columns: [table.id] })
  ]);
  const customKey = defineTable({ ...policy, idColumn: 'slug' })('custom_id', {
    slug: text({ enum: ['one', 'two'] }).primaryKey(),
    body: text()
  });

  expect(collectSchemaRegistry({ inline }).entities[0]?.table).toBe(inline);
  expect(collectSchemaRegistry({ tableKey }).entities[0]?.table).toBe(tableKey);
  expect(collectSchemaRegistry({ customKey }).entities[0]?.table).toBe(customKey);
});
