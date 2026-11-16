import { test } from '@study/testing';

import { validateSearch } from './route-contract';

test.unit.stable(
  'preserves decimal IDs above the safe integer range without numeric coercion',
  ({ expect }) => {
    expect(validateSearch({ project: '9223372036854775807', id: '9007199254740993' })).toEqual({
      project: '9223372036854775807',
      id: '9007199254740993'
    });
  }
);

test.unit.stable('drops malformed IDs and unknown URL state', ({ expect }) => {
  expect(
    validateSearch({ project: 'no', id: '0', material: '9223372036854775808', other: 'x' })
  ).toEqual({});
  expect(validateSearch({ project: 123, id: '-1', material: '1.5' })).toEqual({});
});

test.unit.stable(
  'keeps authored and learning version references separate without losing bigint precision',
  ({ expect }) => {
    expect(validateSearch({ pageVersion: '9007199254740993', version: '7' })).toEqual({
      pageVersion: '9007199254740993',
      version: '7'
    });
    expect(() => validateSearch({ pageVersion: '9223372036854775808' })).toThrow();
  }
);

test.unit.stable(
  'keeps exact attempt identities and drops material query selection',
  ({ expect }) => {
    expect(validateSearch({ attempt: '9007199254740993', material: '41' })).toEqual({
      attempt: '9007199254740993'
    });
    expect(() => validateSearch({ attempt: '9223372036854775808' })).toThrow();
  }
);
