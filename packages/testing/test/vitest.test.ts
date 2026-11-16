import { test, createTestApi } from '@study/testing/vitest';

import { assertTestDefinition, classificationLabel } from '../src/classification.ts';

test.unit.stable(
  'Vitest registration preserves context and timeout options',
  { timeout: 2000 },
  ({ task, expect }) => {
    expect(task.name).toBe('[stable] Vitest registration preserves context and timeout options');
  }
);

test.unit.stable(
  'test body tools are native lazy fixtures',
  ({ assert: assertions, expectTypeOf, mock, policy, vi, waitFor, expect }) => {
    const assert: test.Assert = assertions;

    type Tools = Pick<
      test.unit.Context,
      'assert' | 'expect' | 'expectTypeOf' | 'mock' | 'policy' | 'vi' | 'waitFor'
    >;

    expectTypeOf<Tools>().toMatchTypeOf({
      assert,
      expect,
      expectTypeOf,
      mock,
      policy,
      vi,
      waitFor
    });
    assert.strictEqual(policy.asyncTimeout > 0, true);
    expect(typeof mock.fn).toBe('function');
    expect(typeof vi.fn).toBe('function');

    const fixtureMock = vi.fn(() => 'fixture');

    expect(fixtureMock()).toBe('fixture');

    for (const method of ['mock', 'doMock', 'unmock', 'doUnmock', 'hoisted', 'resetModules']) {
      expect(Reflect.get(vi, method)).toBeUndefined();
      expect(Reflect.has(vi, method)).toBe(false);
      expect(Reflect.ownKeys(vi)).not.toContain(method);
    }
  }
);

test.unit.stable(
  'typed assert fixture preserves assertion narrowing',
  ({ assert: assertions, expect }: test.unit.Context) => {
    const assert: test.Assert = assertions;
    const value = (): string | undefined => 'available';
    const candidate = value();

    assert.ok(candidate);
    expect(candidate.toUpperCase()).toBe('AVAILABLE');
  }
);

test.unit.stable.for([
  [1, 'one'],
  [2, 'two']
] as const)('parameterized registration preserves values: %s', ([value, label], { expect }) => {
  expect(label).toBe(value === 1 ? 'one' : 'two');
});

test.unit.regression({ regression: 'evidence_integrity' })(
  'regression label',
  ({ task, expect }) => {
    expect(task.name).toBe('[regression:evidence_integrity] regression label');
  }
);

test.unit.migration({ migration: 'source_upgrade', retention: 'permanent' })(
  'migration label',
  ({ task, expect }) => {
    expect(task.name).toBe('[migration:source_upgrade:permanent] migration label');
  }
);

test.unit.characterization({
  migration: 'source_upgrade',
  retention: 'temporary',
  removeWhen: 'Fixture completes'
})('characterization label', ({ task, expect }) => {
  expect(task.name).toBe('[characterization:source_upgrade:temporary] characterization label');
});

test.unit.stable(
  'JavaScript callers cannot bypass classification metadata or skip coverage',
  ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

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
      classificationLabel('characterization', {
        migration: 'source_upgrade',
        retention: 'permanent'
      })
    ).toThrow(TypeError);

    for (const key of ['skip', 'only', 'todo', 'fails', 'expectFailure'])
      expect(() => assertTestDefinition('hidden', { [key]: true })).toThrow(TypeError);

    assert.throws(() => assertTestDefinition('', () => {}), TypeError);
  }
);

const fixtureStable = test.unit.stable.extend('answer', { scope: 'worker' }, () => 42);

fixtureStable(
  'extended worker fixtures retain classification and values',
  ({ answer, task, assert: assertions }: test.unit.Context & { answer: number }) => {
    const assert: test.Assert = assertions;

    assert.strictEqual(answer, 42);
    assert.strictEqual(
      task.name,
      '[stable] extended worker fixtures retain classification and values'
    );
  }
);

test.unit.stable(
  'extended registrations reject skip and focus modifiers at runtime',
  ({ expect }) => {
    for (const modifier of ['skip', 'only', 'todo', 'fails'])
      expect(() => Reflect.get(fixtureStable, modifier)).toThrow('Classified tests');
  }
);

test.unit.stable.extend('answer', { scope: 'worker' }, () => 42).override('answer', () => 43)(
  'fixture overrides preserve their key, value and classification',
  ({ answer, task, assert: assertions }: test.unit.Context & { answer: number }) => {
    const assert: test.Assert = assertions;

    assert.strictEqual(answer, 43);
    assert.strictEqual(
      task.name,
      '[stable] fixture overrides preserve their key, value and classification'
    );
  }
);

test.unit.stable.for([{ value: 42 }])(
  'native for preserves values and classification',
  (item, { task, expect }) => {
    expect(item.value).toBe(42);
    expect(task.name).toBe('[stable] native for preserves values and classification');
  }
);

test.unit.stable.concurrent(
  'native concurrent retains classification',
  ({ task, assert: assertions }) => {
    const assert: test.Assert = assertions;

    assert.strictEqual(task.name, '[stable] native concurrent retains classification');
  }
);

fixtureStable.for([{ value: 2 }])(
  'extended native for retains fixtures',
  (item, { answer, task, assert: assertions }: test.unit.Context & { answer: number }) => {
    const assert: test.Assert = assertions;

    assert.strictEqual(item.value + answer, 44);
    assert.strictEqual(task.name, '[stable] extended native for retains fixtures');
  }
);

test.unit.stable('classified adapters expose only supported registration methods', ({ expect }) => {
  expect(Reflect.get(fixtureStable, 'beforeEach')).toBeUndefined();
  expect(Reflect.get(fixtureStable, 'futureNativeMethod')).toBeUndefined();

  for (const modifier of ['skip', 'only', 'todo', 'fails', 'skipIf', 'runIf'])
    expect(() => Reflect.get(fixtureStable.concurrent, modifier)).toThrow('Classified tests');
});

const prepared = createTestApi(
  test.unit.stable.extend('answer', ({ task: _task }, { onCleanup }) => {
    onCleanup(() => {
      released += 1;
    });
    acquired += 1;

    return 42;
  })
);

let acquired = 0;

let released = 0;

prepared.stable('unused setup stays lazy', ({ task, expect }) => {
  expect(task.name).toBe('[stable] unused setup stays lazy');
  expect(acquired).toBe(0);
});

prepared.regression({ regression: 'evidence_integrity' })(
  'classified setup is prepared automatically',
  ({ answer, task, expect }) => {
    expect(answer).toBe(42);
    expect(task.name).toBe(
      '[regression:evidence_integrity] classified setup is prepared automatically'
    );
  }
);

prepared.stable('automatic setup is released before the next case', ({ expect }) => {
  expect(acquired).toBe(1);
  expect(released).toBe(1);
});
