import type { ServerTestApi } from '@study/server/testing';

declare module '@study/testing' {
  interface TestEnvironment {
    readonly api: ServerTestApi;
  }
}
