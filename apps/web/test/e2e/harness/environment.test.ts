import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { assertCapturePlatform } from './environment.ts';

testStable(
  'capture platform accepts Linux x64 and rejects incompatible rendering platforms',
  () => {
    expect(() => assertCapturePlatform('linux', 'x64')).not.toThrow();

    for (const [platform, architecture] of [
      ['darwin', 'x64'],
      ['darwin', 'arm64'],
      ['linux', 'arm64'],
      ['win32', 'x64']
    ])
      expect(() => assertCapturePlatform(platform, architecture)).toThrow(
        'E2E screenshots require the Linux x64 devcontainer'
      );
  }
);
