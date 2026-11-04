import { test } from 'node:test';
import type { TestContext, TestFn, TestOptions } from 'node:test';

import { assertTestDefinition, classificationLabel } from './classification.ts';
import type { Characterization, Migration, Regression } from './classification.ts';

type Options = Omit<TestOptions, 'only' | 'skip' | 'todo' | 'expectFailure'> & {
  only?: never;
  skip?: never;
  todo?: never;
  expectFailure?: never;
};

type Registration = {
  (name: string, fn: TestFn): Promise<void>;
  (name: string, options: Options, fn: TestFn): Promise<void>;
};

type Runner = (name: string, options: TestOptions, fn: TestFn) => Promise<void>;

function registration(runner: Runner, category: string): Registration {
  return (name: string, options: Options | TestFn, fn?: TestFn) => {
    assertTestDefinition(name, options);

    if (typeof options === 'function') return runner(`[${category}] ${name}`, {}, options);

    if (!fn) throw new TypeError('Classified tests require a callback');

    return runner(`[${category}] ${name}`, options, fn);
  };
}

function classified(runner: Runner) {
  return {
    testStable: registration(runner, 'stable'),
    testRegression: (metadata: Regression) =>
      registration(runner, classificationLabel('regression', metadata)),
    testMigration: (metadata: Migration) =>
      registration(runner, classificationLabel('migration', metadata)),
    testCharacterization: (metadata: Characterization) =>
      registration(runner, classificationLabel('characterization', metadata))
  };
}

export const { testStable, testRegression, testMigration, testCharacterization } = classified(test);

/** Keep nested registrations attached to their owning Node test context. */
export function subtests(context: TestContext) {
  return classified(context.test.bind(context));
}
