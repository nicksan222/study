/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Provides typed semantic retrieval and registry integration for local application   │
 * │ content.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves entity identities and keeps retrieval bounded and scoped.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature projections own visibility while injected embedding capabilities provide local   │
 * │ inference.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { integer, text, defineTable } from '@study/db/schema-builder';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';

import { makeRegistryStore } from './registry.ts';

const custom = defineTable({
  role: 'entity',
  projection: 'feature',
  kind: 'custom',
  description: 'Custom feature content'
})('custom', { id: integer().primaryKey() });

testStable('feature projections are validated against the actual supplied participants', () => {
  expect(() => makeRegistryStore({ schema: { custom }, featureKinds: new Set() })).toThrow(
    'Missing feature projection'
  );
  const registry = makeRegistryStore({ schema: { custom }, featureKinds: new Set(['custom']) });

  expect(registry.catalog.map((entry) => entry.kind)).toStrictEqual(['custom']);
});

const notes = defineTable({
  role: 'entity',
  projection: 'columns',
  kind: 'note',
  description: 'Saved notes',
  scope: { type: 'global' },
  visibility: 'all',
  textColumns: ['body']
})('test_registry_notes', { id: integer().primaryKey(), body: text().notNull() });

testStable(
  'automatic projection pages share bounded lookahead and require an entity kind',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());

    try {
      context.db.exec(
        'CREATE TABLE test_registry_notes(id INTEGER PRIMARY KEY,body TEXT NOT NULL)'
      );
      context.db.orm
        .insert(notes)
        .values([
          { id: 1, body: 'Physics' },
          { id: 2, body: 'Biology' }
        ])
        .run();
      const registry = makeRegistryStore({ schema: { notes }, featureKinds: new Set() });
      const page = (offset: number, kind?: string) =>
        transaction((tx) =>
          tx.store(registry.store).searchProjectionPages({ offset, limit: 1, kind })
        ).pipe(Effect.provideService(Database, { store: context }));

      expect(await Effect.runPromise(page(0, 'note'))).toMatchObject({
        items: [{ title: 'Physics' }],
        next: 1
      });
      expect(await Effect.runPromise(page(1, 'note'))).toMatchObject({
        items: [{ title: 'Biology' }],
        next: null
      });
      const missingKind = await Effect.runPromise(Effect.result(page(0)));

      expect(missingKind._tag).toBe('Failure');

      if (missingKind._tag === 'Failure') expect(missingKind.failure.kind).toBe('invalid_input');
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
