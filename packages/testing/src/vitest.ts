import { test } from 'vite-plus/test';
import type { TestAPI, TestContext, TestFunction, TestOptions } from 'vite-plus/test';

import { assertTestDefinition, classificationLabel } from './classification.ts';
import type { Characterization, Migration, Regression } from './classification.ts';

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
        const expanded: unknown = Reflect.apply(Reflect.get(runner, method), runner, args);

        if (!callable(expanded))
          throw new TypeError('Fixture and parameterized APIs must return a registration function');

        return registration(expanded, category);
      }
    });

  Object.defineProperty(classified, 'concurrent', {
    get: () => registration(Reflect.get(runner, 'concurrent'), category)
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
