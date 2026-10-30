import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { getTableConfig } from 'drizzle-orm/sqlite-core';

import { learning_practice_controls, learning_practice_slots } from './learning-practice.ts';

test('practice keeps one control per project and unique slot ordinals per epoch', () => {
  assert.equal(getTableConfig(learning_practice_controls).name, 'learning_practice_controls');
  const slots = getTableConfig(learning_practice_slots);

  assert.ok(
    slots.indexes.some((index) => index.config.unique && index.config.columns.length === 3)
  );
});
