import { test } from '@study/testing';

import { validateSearch } from './route-contract';

test.stable('preserves decimal IDs above the safe integer range without numeric coercion', () => {
  test.expect(validateSearch({ project: '9223372036854775807', id: '9007199254740993' })).toEqual({
    project: '9223372036854775807',
    id: '9007199254740993'
  });
});

test.stable('drops malformed IDs and unknown URL state', () => {
  test
    .expect(validateSearch({ project: 'no', id: '0', material: '9223372036854775808', other: 'x' }))
    .toEqual({});
  test.expect(validateSearch({ project: 123, id: '-1', material: '1.5' })).toEqual({});
});

test.stable(
  'keeps authored and learning version references separate without losing bigint precision',
  () => {
    test.expect(validateSearch({ pageVersion: '9007199254740993', version: '7' })).toEqual({
      pageVersion: '9007199254740993',
      version: '7'
    });
    test.expect(() => validateSearch({ pageVersion: '9223372036854775808' })).toThrow();
  }
);

test.stable('keeps exact attempt identities and drops material query selection', () => {
  test.expect(validateSearch({ attempt: '9007199254740993', material: '41' })).toEqual({
    attempt: '9007199254740993'
  });
  test.expect(() => validateSearch({ attempt: '9223372036854775808' })).toThrow();
});
