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
  return new Proxy(runner, {
    apply(target, receiver, args) {
      assertTestDefinition(args[0], args[1]);

      return Reflect.apply(target, receiver, [`[${category}] ${args[0]}`, ...args.slice(1)]);
    },
    get(target, property, receiver) {
      if (['only', 'skip', 'todo', 'fails', 'skipIf', 'runIf'].includes(String(property)))
        throw new TypeError('Classified tests cannot be focused, skipped or inverted');

      const value: any = Reflect.get(target, property, receiver);

      if (property === 'each' || property === 'for' || property === 'extend') {
        return (...args: unknown[]) => {
          const expanded: unknown = Reflect.apply(value, target, args);

          if (!callable(expanded))
            throw new TypeError('Parameterized tests must return a registration function');

          return registration(expanded, category);
        };
      }

      return callable(value) ? registration(value, category) : value;
    }
  }) as T & Registration;
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
