import { test, createTestApi } from '@study/testing/vitest';

import { assertTestDefinition, classificationLabel } from '../src/classification.ts';

test.stable(
  'Vitest registration preserves context and timeout options',
  { timeout: 2000 },
  (context) => {
    test
      .expect(context.task.name)
      .toBe('[stable] Vitest registration preserves context and timeout options');
  }
);

test.stable.each([
  [1, 'one'],
  [2, 'two']
] as const)('parameterized registration preserves values: %s', (value, label) => {
  test.expect(label).toBe(value === 1 ? 'one' : 'two');
});

test.regression({ regression: 'evidence_integrity' })('regression label', (context) => {
  test.expect(context.task.name).toBe('[regression:evidence_integrity] regression label');
});

test.migration({ migration: 'source_upgrade', retention: 'permanent' })(
  'migration label',
  (context) => {
    test.expect(context.task.name).toBe('[migration:source_upgrade:permanent] migration label');
  }
);

test.characterization({
  migration: 'source_upgrade',
  retention: 'temporary',
  removeWhen: 'Fixture completes'
})('characterization label', (context) => {
  test
    .expect(context.task.name)
    .toBe('[characterization:source_upgrade:temporary] characterization label');
});

test.stable('JavaScript callers cannot bypass classification metadata or skip coverage', () => {
  test
    .expect(() => classificationLabel('regression', { regression: 'unknown' }))
    .toThrow(TypeError);
  test
    .expect(() =>
      classificationLabel('migration', { migration: 'source_upgrade', retention: 'temporary' })
    )
    .toThrow(TypeError);
  test
    .expect(() =>
      classificationLabel('migration', {
        migration: 'source_upgrade',
        retention: 'permanent',
        removeWhen: 'Later'
      })
    )
    .toThrow(TypeError);
  test
    .expect(() =>
      classificationLabel('characterization', {
        migration: 'source_upgrade',
        retention: 'permanent'
      })
    )
    .toThrow(TypeError);

  for (const key of ['skip', 'only', 'todo', 'fails', 'expectFailure'])
    test.expect(() => assertTestDefinition('hidden', { [key]: true })).toThrow(TypeError);

  test.assert.throws(() => assertTestDefinition('', () => {}), TypeError);
});

const fixtureStable = test.stable.extend('answer', { scope: 'worker' }, () => 42);

fixtureStable('extended worker fixtures retain classification and values', ({ answer, task }) => {
  test.assert.strictEqual(answer, 42);
  test.assert.strictEqual(
    task.name,
    '[stable] extended worker fixtures retain classification and values'
  );
});

test.stable('extended registrations reject skip and focus modifiers at runtime', () => {
  for (const modifier of ['skip', 'only', 'todo', 'fails'])
    test.expect(() => Reflect.get(fixtureStable, modifier)).toThrow('Classified tests');
});

test.stable.extend('answer', { scope: 'worker' }, () => 42).override('answer', () => 43)(
  'fixture overrides preserve their key, value and classification',
  ({ answer, task }) => {
    test.assert.strictEqual(answer, 43);
    test.assert.strictEqual(
      task.name,
      '[stable] fixture overrides preserve their key, value and classification'
    );
  }
);

test.stable.for([{ value: 42 }])(
  'native for preserves values and classification',
  (item, context) => {
    test.expect(item.value).toBe(42);
    test.expect(context.task.name).toBe('[stable] native for preserves values and classification');
  }
);

test.stable.concurrent('native concurrent retains classification', (context) => {
  test.assert.strictEqual(context.task.name, '[stable] native concurrent retains classification');
});

fixtureStable.for([{ value: 2 }])(
  'extended native for retains fixtures',
  (item, { answer, task }) => {
    test.assert.strictEqual(item.value + answer, 44);
    test.assert.strictEqual(task.name, '[stable] extended native for retains fixtures');
  }
);

test.stable('classified adapters expose only supported registration methods', () => {
  test.expect(Reflect.get(fixtureStable, 'beforeEach')).toBeUndefined();
  test.expect(Reflect.get(fixtureStable, 'futureNativeMethod')).toBeUndefined();

  for (const modifier of ['skip', 'only', 'todo', 'fails', 'skipIf', 'runIf'])
    test.expect(() => Reflect.get(fixtureStable.concurrent, modifier)).toThrow('Classified tests');
});

const prepared = createTestApi(
  test.stable.extend('answer', ({ task: _task }, { onCleanup }) => {
    onCleanup(() => {
      released += 1;
    });
    acquired += 1;

    return 42;
  })
);

let acquired = 0;

let released = 0;

prepared.stable('unused setup stays lazy', ({ task }) => {
  test.expect(task.name).toBe('[stable] unused setup stays lazy');
  test.expect(acquired).toBe(0);
});

prepared.regression({ regression: 'evidence_integrity' })(
  'classified setup is prepared automatically',
  ({ answer, task }) => {
    test.expect(answer).toBe(42);
    test
      .expect(task.name)
      .toBe('[regression:evidence_integrity] classified setup is prepared automatically');
  }
);

prepared.stable('automatic setup is released before the next case', () => {
  test.expect(acquired).toBe(1);
  test.expect(released).toBe(1);
});
