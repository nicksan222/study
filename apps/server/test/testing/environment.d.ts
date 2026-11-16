import type { test as applicationTest } from './scenarios.ts';

declare module '@study/testing' {
  interface TestEnvironment {
    readonly api: typeof applicationTest;
  }
}
