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

import { integer, defineTable } from '@study/db/schema-builder';
import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

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
