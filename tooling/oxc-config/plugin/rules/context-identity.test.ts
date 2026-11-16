import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.unit.stable(
  'native service identity cannot be overwritten through aliases',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'context-identity', {
      'src/platform/definitions/define-service.ts': String.raw`import { Context } from "effect";
const tag = Context.Service("study/X");
const alias = tag;
Object.assign(alias, { key: other });
tag.key = other;
Object.assign(tag, { layer });
function f(tag: any) {
  tag.key = other;
}`
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);
