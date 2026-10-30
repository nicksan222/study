import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('native service identity cannot be overwritten through aliases', () => {
  const diagnostics = lintRule('context-identity', {
    'src/platform/definitions/define-service.ts':
      "import { Context } from 'effect'; const tag = Context.Service('study/X'); const alias = tag; Object.assign(alias, { key: other }); tag.key = other; Object.assign(tag, { layer }); function f(tag: any) { tag.key = other; }"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});
