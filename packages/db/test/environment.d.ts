import type { test as databaseTest } from './scenarios.ts';

declare module '@study/testing' {
  interface TestEnvironment {
    readonly api: typeof databaseTest;
  }
}
