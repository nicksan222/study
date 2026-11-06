import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { validateSearch } from './route-contract';

testStable('preserves decimal IDs above the safe integer range without numeric coercion', () => {
  expect(validateSearch({ project: '9223372036854775807', id: '9007199254740993' })).toEqual({
    project: '9223372036854775807',
    id: '9007199254740993'
  });
});

testStable('drops malformed IDs and unknown URL state', () => {
  expect(
    validateSearch({ project: 'no', id: '0', material: '9223372036854775808', other: 'x' })
  ).toEqual({});
  expect(validateSearch({ project: 123, id: '-1', material: '1.5' })).toEqual({});
});

testStable(
  'keeps authored and learning version references separate without losing bigint precision',
  () => {
    expect(validateSearch({ documentVersion: '9007199254740993', version: '7' })).toEqual({
      documentVersion: '9007199254740993',
      version: '7'
    });
    expect(() => validateSearch({ documentVersion: '9223372036854775808' })).toThrow();
  }
);

testStable('keeps exact attempt identities and drops material query selection', () => {
  expect(validateSearch({ attempt: '9007199254740993', material: '41' })).toEqual({
    attempt: '9007199254740993'
  });
  expect(() => validateSearch({ attempt: '9223372036854775808' })).toThrow();
});
