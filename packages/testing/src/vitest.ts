import { test, vi } from 'vite-plus/test';
import type { TestAPI, TestContext, TestFunction, TestOptions } from 'vite-plus/test';

import { assertTestDefinition, classificationLabel } from './classification.ts';
import type { Characterization, Migration, Regression } from './classification.ts';
import { testPolicy } from './config.ts';

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

type Registration = {
  extend: TestAPI['extend'];
  (name: string, fn: TestFunction, timeout?: number): void;
  (name: string, options: Options, fn: TestFunction): void;
  each: Each;
  for: <T>(cases: readonly T[]) => Parameterized<[T, TestContext]>;
  readonly concurrent: Registration;
};

type Callable = (...args: any[]) => any;

function callable(value: unknown): value is Callable {
  return typeof value === 'function';
}

/** Preserve native parameter inference while classifying every expanded test name. */
function registration<T extends Callable>(runner: T, category: string): T & Registration {
  const classified = function (this: unknown, ...args: unknown[]) {
    assertTestDefinition(args[0], args[1]);

    return Reflect.apply(runner, this, [`[${category}] ${args[0]}`, ...args.slice(1)]);
  };

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

  return classified as T & Registration;
}

export const testStable: Registration = registration(test, 'stable');

export function testRegression(metadata: Regression): Registration {
  return registration(test, classificationLabel('regression', metadata));
}

export function testMigration(metadata: Migration): Registration {
  return registration(test, classificationLabel('migration', metadata));
}

export function testCharacterization(metadata: Characterization): Registration {
  return registration(test, classificationLabel('characterization', metadata));
}

/** Use Vitest's polling implementation with the repository's shared async budget. */
export const waitFor: typeof vi.waitFor = (callback: any, options?: any) =>
  vi.waitFor(
    callback,
    typeof options === 'number' ? options : { timeout: testPolicy.asyncTimeout, ...options }
  );

/** Bound event observations without bespoke sleep/race scaffolding in individual tests. */
export async function withinTestDeadline<T>(event: Promise<T>): Promise<T> {
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
