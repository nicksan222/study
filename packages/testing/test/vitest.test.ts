import {
  testStable,
  testRegression,
  testMigration,
  testCharacterization
} from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { assertTestDefinition, classificationLabel } from '../src/classification.ts';

testStable(
  'Vitest registration preserves context and timeout options',
  { timeout: 2000 },
  (context) => {
    expect(context.task.name).toBe(
      '[stable] Vitest registration preserves context and timeout options'
    );
  }
);

testStable.each([
  [1, 'one'],
  [2, 'two']
] as const)('parameterized registration preserves values: %s', (value, label) => {
  expect(label).toBe(value === 1 ? 'one' : 'two');
});

testRegression({ regression: 'evidence_integrity' })('regression label', (context) => {
  expect(context.task.name).toBe('[regression:evidence_integrity] regression label');
});

testMigration({ migration: 'source_upgrade', retention: 'permanent' })(
  'migration label',
  (context) => {
    expect(context.task.name).toBe('[migration:source_upgrade:permanent] migration label');
  }
);

testCharacterization({
  migration: 'source_upgrade',
  retention: 'temporary',
  removeWhen: 'Fixture completes'
})('characterization label', (context) => {
  expect(context.task.name).toBe(
    '[characterization:source_upgrade:temporary] characterization label'
  );
});

testStable('JavaScript callers cannot bypass classification metadata or skip coverage', () => {
  expect(() => classificationLabel('regression', { regression: 'unknown' })).toThrow(TypeError);
  expect(() =>
    classificationLabel('migration', { migration: 'source_upgrade', retention: 'temporary' })
  ).toThrow(TypeError);
  expect(() =>
    classificationLabel('migration', {
      migration: 'source_upgrade',
      retention: 'permanent',
      removeWhen: 'Later'
    })
  ).toThrow(TypeError);
  expect(() =>
    classificationLabel('characterization', { migration: 'source_upgrade', retention: 'permanent' })
  ).toThrow(TypeError);

  for (const key of ['skip', 'only', 'todo', 'fails', 'expectFailure'])
    expect(() => assertTestDefinition('hidden', { [key]: true })).toThrow(TypeError);

  assert.throws(() => assertTestDefinition('', () => {}), TypeError);
});

const fixtureStable = testStable.extend('answer', { scope: 'worker' }, () => 42);

fixtureStable('extended worker fixtures retain classification and values', ({ answer, task }) => {
  assert.strictEqual(answer, 42);
  assert.strictEqual(
    task.name,
    '[stable] extended worker fixtures retain classification and values'
  );
});

testStable('extended registrations reject skip and focus modifiers at runtime', () => {
  for (const modifier of ['skip', 'only', 'todo', 'fails'])
    expect(() => Reflect.get(fixtureStable, modifier)).toThrow('Classified tests');
});
