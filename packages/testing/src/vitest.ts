import type { TestType as BrowserTestType } from 'playwright/test';
import {
  onTestFinished,
  test as nativeTest,
  vi,
  expectTypeOf,
  assert,
  describe,
  beforeAll,
  afterAll
} from 'vite-plus/test';
import type { TestAPI, TestContext, TestFunction, TestOptions } from 'vite-plus/test';

import { createAiMock } from './ai-mock.ts';
import { assertTestDefinition, classificationLabel } from './classification.ts';
import type { Characterization, Migration, Regression } from './classification.ts';
import { testPolicy } from './config.ts';
import { runTestEffect, pollUntil, observeUntil } from './effect.ts';
import { createMockScope } from './mock.ts';
import type { MockScope } from './mock.ts';
import { spawnScopedProcess, spawnTestProcessSync } from './process.ts';
import {
  temporaryDirectory as acquireDirectory,
  createTestResources as acquireResources
} from './resources.ts';

/** Vitest registers disposal immediately; scripts use the same subprocess with await using. */
const spawnTestProcess: typeof spawnScopedProcess = ((...args: any[]) => {
  const child = Reflect.apply(spawnScopedProcess, undefined, args);

  onTestFinished(() => child[Symbol.asyncDispose]());

  return child;
}) as typeof spawnScopedProcess;

const temporaryDirectory: typeof acquireDirectory = (...args) => {
  const pending = acquireDirectory(...args);

  onTestFinished(() =>
    pending.then(
      (directory) => directory[Symbol.asyncDispose](),
      () => undefined
    )
  );

  return pending;
};

const createTestResources: typeof acquireResources = (...args) => {
  const resources = acquireResources(...args);

  onTestFinished(() => resources.close());

  return resources;
};

type Options = Omit<TestOptions, 'only' | 'skip' | 'todo' | 'fails'> & {
  only?: never;
  skip?: never;
  todo?: never;
  fails?: never;
};

type Parameterized<Args extends unknown[]> = {
  (name: string, fn: (...args: Args) => void | Promise<void>, timeout?: number): void;
  (name: string, options: Options, fn: (...args: Args) => void | Promise<void>): void;
};

type Each = {
  <T extends unknown[] | [unknown]>(cases: readonly T[]): Parameterized<T>;
  <T extends readonly unknown[]>(cases: readonly T[]): Parameterized<[...T]>;
  <T>(cases: readonly T[]): Parameterized<[T]>;
};

type Registration<Fixtures = object> = {
  extend: TestAPI<Fixtures>['extend'];
  override: TestAPI<Fixtures>['override'];
  (name: string, fn: TestFunction<Fixtures>, timeout?: number): void;
  (name: string, options: Options, fn: TestFunction<Fixtures>): void;
  each: Each;
  for: <T>(cases: readonly T[]) => Parameterized<[T, TestContext & Fixtures]>;
  readonly concurrent: Registration<Fixtures>;
};

type Callable = (...args: any[]) => any;

type PublicVi = Omit<
  typeof vi,
  'mock' | 'doMock' | 'unmock' | 'doUnmock' | 'hoisted' | 'resetModules'
>;

const forbiddenViMethods = new Set<PropertyKey>([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'hoisted',
  'resetModules'
]);

const publicVi = new Proxy(vi, {
  get(target, property) {
    return forbiddenViMethods.has(property) ? undefined : Reflect.get(target, property, target);
  },
  has(target, property) {
    return !forbiddenViMethods.has(property) && Reflect.has(target, property);
  },
  ownKeys(target) {
    return Reflect.ownKeys(target).filter((property) => !forbiddenViMethods.has(property));
  },
  getOwnPropertyDescriptor(target, property) {
    return forbiddenViMethods.has(property)
      ? undefined
      : Reflect.getOwnPropertyDescriptor(target, property);
  }
});

const nativeRegistration = Symbol('native classified registration');

function callable(value: unknown): value is Callable {
  return typeof value === 'function';
}

/** Preserve native parameter inference while classifying every expanded test name. */
type FixturesOf<T> =
  T extends TestAPI<infer Fixtures>
    ? Fixtures
    : T extends Registration<infer Fixtures>
      ? Fixtures
      : object;

function registration<T extends Callable>(
  runner: T,
  category: string
): Registration<FixturesOf<T>> {
  const classified = function (this: unknown, ...args: unknown[]) {
    assertTestDefinition(args[0], args[1]);

    if (!callable(args[1]) && !callable(args[2]))
      throw new TypeError('Classified tests require a callback');

    return Reflect.apply(runner, this, [`[${category}] ${args[0]}`, ...args.slice(1)]);
  };

  Object.defineProperty(classified, nativeRegistration, { value: runner });

  for (const modifier of ['only', 'skip', 'todo', 'fails', 'skipIf', 'runIf'])
    Object.defineProperty(classified, modifier, {
      get() {
        throw new TypeError('Classified tests cannot be focused, skipped or inverted');
      }
    });

  for (const method of ['each', 'for', 'extend', 'override'])
    Object.defineProperty(classified, method, {
      value: (...args: unknown[]) => {
        const native: unknown = Reflect.get(runner, method);

        if (!callable(native))
          throw new TypeError(`Unsupported test registration method: ${method}`);

        const expanded: unknown = Reflect.apply(native, runner, args);

        if (!callable(expanded))
          throw new TypeError('Fixture and parameterized APIs must return a registration function');

        return registration(expanded, category);
      }
    });

  Object.defineProperty(classified, 'concurrent', {
    get() {
      const concurrent: unknown = Reflect.get(runner, 'concurrent');

      if (!callable(concurrent)) throw new TypeError('Concurrent test registration is unavailable');

      return registration(concurrent, category);
    }
  });

  return classified as Registration<FixturesOf<T>>;
}

type TestApi<Fixtures> = {
  readonly stable: Registration<Fixtures>;
  readonly regression: (metadata: Regression) => Registration<Fixtures>;
  readonly migration: (metadata: Migration) => Registration<Fixtures>;
  readonly characterization: (metadata: Characterization) => Registration<Fixtures>;
  readonly describe: typeof describe;
  readonly beforeAll: typeof beforeAll;
  readonly afterAll: typeof afterAll;
  readonly beforeEach: TestAPI<Fixtures>['beforeEach'];
  readonly afterEach: TestAPI<Fixtures>['afterEach'];
};

/** Classification and lazy fixture setup share one native runner for every test kind. */
export function createTestApi<T extends Callable>(runner: T): TestApi<FixturesOf<T>> {
  const underlying = Reflect.get(runner, nativeRegistration) as T | undefined;
  const native = underlying ?? runner;

  return {
    describe,
    beforeAll,
    afterAll,
    beforeEach: (Reflect.get(native, 'beforeEach') as TestAPI<FixturesOf<T>>['beforeEach']).bind(
      native
    ) as TestAPI<FixturesOf<T>>['beforeEach'],
    afterEach: (Reflect.get(native, 'afterEach') as TestAPI<FixturesOf<T>>['afterEach']).bind(
      native
    ) as TestAPI<FixturesOf<T>>['afterEach'],
    stable: registration(native, 'stable'),
    regression: (metadata: Regression) =>
      registration(native, classificationLabel('regression', metadata)),
    migration: (metadata: Migration) =>
      registration(native, classificationLabel('migration', metadata)),
    characterization: (metadata: Characterization) =>
      registration(native, classificationLabel('characterization', metadata))
  };
}

/** Use Vitest's polling implementation with the repository's shared async budget. */
const waitFor: typeof vi.waitFor = (callback: any, options?: any) =>
  vi.waitFor(
    callback,
    typeof options === 'number' ? options : { timeout: testPolicy.asyncTimeout, ...options }
  );

/** Bound event observations without bespoke sleep/race scaffolding in individual tests. */
async function withinTestDeadline<T>(event: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      event,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Test observation timed out')),
          testPolicy.asyncTimeout
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export { installTestApi } from './facade.ts';

const preparedNativeTest = nativeTest
  .extend('mock', ({ task: _task }, { onCleanup }) => {
    const scope = createMockScope();

    onCleanup(() => scope.close());

    return scope;
  })
  .extend('policy', () => testPolicy)
  .extend('assert', () => assert)
  .extend('expectTypeOf', () => expectTypeOf)
  .extend('vi', () => publicVi as PublicVi)
  .extend('spawnTestProcess', { scope: 'worker' }, () => spawnTestProcess)
  .extend('waitFor', () => waitFor)
  .extend('withinTestDeadline', () => withinTestDeadline)
  .extend('runTestEffect', () => runTestEffect)
  .extend('pollUntil', () => pollUntil)
  .extend('observeUntil', () => observeUntil)
  .extend('temporaryDirectory', () => temporaryDirectory)
  .extend('createTestResources', () => createTestResources)
  .extend('createAiMock', () => createAiMock)
  .extend('spawnTestProcessSync', () => spawnTestProcessSync);

/** Native Vitest runner with the shared unit fixture set and explicit namespace. */
export const test = { unit: createTestApi(preparedNativeTest) };

export declare namespace test {
  export type Mock = MockScope;

  export type Assert = TestAssert;

  export namespace unit {
    export type Context = TestContextOf<typeof test.unit>;
  }
}

/** The native fixture context augmented with this environment's lazy registered fixtures. */
export type TestContextOf<Runner> =
  Runner extends TestAPI<infer Fixtures>
    ? TestContext & Fixtures
    : Runner extends { readonly stable: Registration<infer Fixtures> }
      ? TestContext & Fixtures
      : Runner extends { readonly stable: infer Test }
        ? TestContextOf<Test>
        : Runner extends BrowserTestType<infer Fixtures, any>
          ? Fixtures
          : TestContext;

export type TestAssert = typeof assert;

export { createMockScope };
export type { MockScope } from './mock.ts';
