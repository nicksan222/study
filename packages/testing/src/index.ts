import type { test as defaultTestApi } from './vitest.ts';
import type { MockScope, TestAssert, TestContextOf } from './vitest.ts';
export { classificationLabel } from './classification.ts';
export { testPolicy } from './config.ts';
export { createAiMock } from './ai-mock.ts';

import { createTestFacade } from './facade.ts';

/** Each runner's type environment supplies the fixtures available in that test project. */
export interface TestEnvironment {}

type PublicTestApi = TestEnvironment extends { readonly api: infer Api extends object }
  ? Api
  : typeof defaultTestApi;

export const test: PublicTestApi = createTestFacade<PublicTestApi>();

export declare namespace test {
  export type Mock = MockScope;

  export type Assert = TestAssert;

  export type Context = TestContextOf<PublicTestApi>;
}

export { installTestApi } from './facade.ts';
