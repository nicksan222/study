import type { test as browserTestApi } from './harness/index.ts';

declare module '@study/testing' {
  interface TestEnvironment {
    readonly api: typeof browserTestApi;
  }
}
