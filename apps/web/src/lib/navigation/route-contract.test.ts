import { expect, it } from 'vite-plus/test';

import { validateSearch } from './route-contract';

it('preserves decimal IDs above the safe integer range without numeric coercion', () => {
  expect(validateSearch({ project: '9223372036854775807', id: '9007199254740993' })).toEqual({
    project: '9223372036854775807',
    id: '9007199254740993'
  });
});

it('drops malformed IDs and unknown URL state', () => {
  expect(
    validateSearch({ project: 'no', id: '0', material: '9223372036854775808', other: 'x' })
  ).toEqual({});
  expect(validateSearch({ project: 123, id: '-1', material: '1.5' })).toEqual({});
});
