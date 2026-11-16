import { hoistMocksPlugin } from '@vitest/mocker/node';

/** Preserve native module mocking while tests import only the public testing facade. */
export function testPlugins() {
  return [
    hoistMocksPlugin({
      hoistedModule: '@study/testing',
      utilsObjectNames: ['test']
    })
  ];
}
