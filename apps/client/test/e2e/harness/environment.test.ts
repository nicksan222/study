import { test } from '@study/testing';

import { assertCapturePlatform } from './environment.ts';

test.stable(
  'capture platform accepts Linux x64 and rejects incompatible rendering platforms',
  () => {
    test.expect(() => assertCapturePlatform('linux', 'x64')).not.toThrow();

    for (const [platform, architecture] of [
      ['darwin', 'x64'],
      ['darwin', 'arm64'],
      ['linux', 'arm64'],
      ['win32', 'x64']
    ])
      test
        .expect(() => assertCapturePlatform(platform, architecture))
        .toThrow('E2E screenshots require the Linux x64 devcontainer');
  }
);
