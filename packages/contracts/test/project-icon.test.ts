import { test } from '@study/testing';
import { Schema } from 'effect';

import { projectInitials, projectIconSchema } from '../src/projects/schemas.ts';

test.unit.stable(
  'subject initials are deterministic Unicode-aware monograms',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    for (const [name, initials] of [
      ['  Cell   biology ', 'CB'],
      ['Mathematics', 'MA'],
      ['History of Art', 'HA'],
      ['Économie française', 'ÉF'],
      ['日本語', '日本'],
      ['123 calculus', '1C'],
      ['😀', 'S']
    ])
      assert.strictEqual(projectInitials(name!), initials);
  }
);
test.unit.stable(
  'subject icon variants validate their own values and a closed color palette',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

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
  }
);
