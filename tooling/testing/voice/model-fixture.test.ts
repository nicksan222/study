import { test } from '@study/testing';

import { normalize } from './model-fixture.ts';

test.unit.stable('voice scoring treats canonically equivalent words alike', ({ expect }) => {
  const composed = 'Des régions peuplées, inhabitées ou à découvrir.';

  expect(normalize(composed)).toEqual([
    'des',
    'régions',
    'peuplées',
    'inhabitées',
    'ou',
    'à',
    'découvrir'
  ]);
  expect(normalize(composed.normalize('NFD'))).toEqual(normalize(composed));
});
