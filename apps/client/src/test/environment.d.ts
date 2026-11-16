import type { test as applicationTest } from './scenarios.tsx';

declare module '@study/testing' {
  interface TestEnvironment {
    readonly api: typeof applicationTest;
  }
}
