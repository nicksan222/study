import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Schema } from 'effect';

import { projectInitials, projectIconSchema } from '../src/projects/schemas.ts';

test('subject initials are deterministic Unicode-aware monograms', () => {
  for (const [name, initials] of [
    ['  Cell   biology ', 'CB'],
    ['Mathematics', 'MA'],
    ['History of Art', 'HA'],
    ['Économie française', 'ÉF'],
    ['日本語', '日本'],
    ['123 calculus', '1C'],
    ['😀', 'S']
  ])
    assert.equal(projectInitials(name!), initials);
});
test('custom subject icons accept one to three letters or numbers without hidden whitespace', () => {
  for (const icon of ['A', 'BIO', 'é', '日本', '42', 'e\u0301'])
    assert.ok(Schema.is(projectIconSchema)(icon));
  for (const icon of ['', ' FOUR ', 'ABCD', 'A B', '😀', '<svg>', '\nA'])
    assert.ok(!Schema.is(projectIconSchema)(icon));
});
