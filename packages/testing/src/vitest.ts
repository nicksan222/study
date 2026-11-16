import {
  onTestFinished,
  test as nativeTest,
  vi,
  expect,
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
  (name: string, fn: TestFunction<Fixtures>, timeout?: number): void;
  (name: string, options: Options, fn: TestFunction<Fixtures>): void;
  each: Each;
  for: <T>(cases: readonly T[]) => Parameterized<[T, TestContext & Fixtures]>;
  readonly concurrent: Registration<Fixtures>;
};

type Callable = (...args: any[]) => any;

const nativeRegistration = Symbol('native classified registration');

function callable(value: unknown): value is Callable {
  return typeof value === 'function';
}

/** Preserve native parameter inference while classifying every expanded test name. */
type FixturesOf<T> = T extends TestAPI<infer Fixtures> ? Fixtures : object;

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
  readonly policy: typeof testPolicy;
  readonly stable: Registration<Fixtures>;
  readonly regression: (metadata: Regression) => Registration<Fixtures>;
  readonly migration: (metadata: Migration) => Registration<Fixtures>;
  readonly characterization: (metadata: Characterization) => Registration<Fixtures>;
  readonly expect: typeof expect;
  readonly expectTypeOf: typeof expectTypeOf;
  readonly assert: typeof assert;
  readonly vi: typeof vi;
  readonly describe: typeof describe;
  readonly beforeAll: typeof beforeAll;
  readonly afterAll: typeof afterAll;
  readonly onTestFinished: typeof onTestFinished;
  readonly spawnTestProcess: typeof spawnTestProcess;
  readonly waitFor: typeof waitFor;
  readonly withinTestDeadline: typeof withinTestDeadline;
  readonly runTestEffect: typeof runTestEffect;
  readonly pollUntil: typeof pollUntil;
  readonly observeUntil: typeof observeUntil;
  readonly temporaryDirectory: typeof temporaryDirectory;
  readonly createTestResources: typeof createTestResources;
  readonly createAiMock: typeof createAiMock;
  readonly spawnTestProcessSync: typeof spawnTestProcessSync;
  readonly mock: (typeof vi)['mock'];
  readonly unmock: (typeof vi)['unmock'];
  readonly hoisted: (typeof vi)['hoisted'];
  readonly doMock: (typeof vi)['doMock'];
  readonly doUnmock: (typeof vi)['doUnmock'];
  readonly beforeEach: TestAPI<Fixtures>['beforeEach'];
  readonly afterEach: TestAPI<Fixtures>['afterEach'];
};

/** Classification and lazy fixture setup share one native runner for every test kind. */
export function createTestApi<T extends Callable>(runner: T): TestApi<FixturesOf<T>> {
  const underlying = Reflect.get(runner, nativeRegistration) as T | undefined;
  const native = underlying ?? runner;

  return {
    policy: testPolicy,
    expect,
    expectTypeOf,
    assert,
    vi,
    describe,
    beforeAll,
    afterAll,
    onTestFinished,
    beforeEach: (Reflect.get(native, 'beforeEach') as TestAPI<FixturesOf<T>>['beforeEach']).bind(
      native
    ) as TestAPI<FixturesOf<T>>['beforeEach'],
    afterEach: (Reflect.get(native, 'afterEach') as TestAPI<FixturesOf<T>>['afterEach']).bind(
      native
    ) as TestAPI<FixturesOf<T>>['afterEach'],
    mock: vi.mock,
    unmock: vi.unmock,
    hoisted: vi.hoisted,
    doMock: vi.doMock,
    doUnmock: vi.doUnmock,
    spawnTestProcess,
    waitFor,
    withinTestDeadline,
    runTestEffect,
    pollUntil,
    observeUntil,
    temporaryDirectory,
    createTestResources,
    createAiMock,
    spawnTestProcessSync,
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

export const test = createTestApi(nativeTest);
