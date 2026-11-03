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
test('subject icon variants validate their own values and a closed color palette', () => {
  for (const icon of [
    { kind: 'automatic', color: 'neutral' },
    { kind: 'monogram', value: 'BIO', color: 'green' },
    { kind: 'symbol', value: 'atom', color: 'violet' },
    { kind: 'emoji', value: '📚', color: 'blue' }
  ])
    assert.ok(Schema.is(projectIconSchema)(icon));
  for (const icon of [
    'BIO',
    null,
    { kind: 'monogram', value: 'ABCD', color: 'neutral' },
    { kind: 'symbol', value: '<svg>', color: 'blue' },
    { kind: 'emoji', value: 'hello', color: 'blue' },
    { kind: 'automatic', color: 'url(evil)' }
  ])
    assert.ok(!Schema.is(projectIconSchema)(icon));
});
