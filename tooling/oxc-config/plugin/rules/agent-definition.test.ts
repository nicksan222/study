import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('rejects direct agent definitions outside the canonical factory', async () => {
  const diagnostics = await lintRule(
    'agent-definition',
    {
      'src/features/example/agents/example.ts': `import { defineAgent } from '#server/platform/definitions/define-agent';
 export const agent = defineAgent({ id: 'a' });
`
    },
    false
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('recognizes aliases without flagging unrelated or shadowed helpers', async () => {
  const diagnostics = await lintRule('agent-definition', {
    'src/features/example/agents/a.ts': `import * as runtime from '#server/platform/definitions/define-agent';
const make = runtime.defineAgent;
export const a = make({ id: 'x' });
function f(make: any) { return make({});
} export function prompt() { return 'text';
}`,
    'src/features/example/agents/b.ts':
      'const defineAgent = (x: any) => x; const a = defineAgent({});'
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('rejects inline schema shapes, constructed models and per-agent limits', async () => {
  const diagnostics = await lintRule('agent-definition', {
    'src/features/example/agents/a.ts': `import { defineAgent as define } from '#server/platform/definitions/define-agent';
import { Schema } from 'effect';
export const a = define({ id: 'a', input: Schema.Struct({ id: Schema.String }), output: Schema.Struct({ id: Schema.String }), model: provider('x'), instructions: 'a', prompt: 'b' });`
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('checks wrapped aliased definitions, identity and canonical schemas', async () => {
  const diagnostics = await lintRule('agent-definition', {
    'src/features/example/agents/grade.ts': `import { defineAgent } from '#server/platform/definitions/define-agent.ts';
import { Input, Output } from '@study/contracts';
const cfg = { id: 'wrong', input: Input, output: Output, model: 'tiny', instructions: '', prompt: '' } as const;
export const grade = defineAgent(cfg satisfies object);`,
    'src/features/example/agents/other.ts': "export const otherAgent = { id: 'other' };"
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable('accepts canonical schema transformations and rejects unrelated schemas', async () => {
  const diagnostics = await lintRule('agent-definition', {
    'src/features/example/agents/good.ts': `import { defineAgent } from '#server/platform/definitions/define-agent';
import { Input, Output } from '@study/contracts';
import { Schema } from 'effect';
defineAgent({ id: 'good', input: Schema.Array(Input), output: Output.pipe(Schema.NullOr), model: 'tiny', instructions: '', prompt: '' });`,
    'src/features/example/agents/bad.ts': `import { defineAgent } from '#server/platform/definitions/define-agent';
import { z } from 'zod';
defineAgent({ id: 'bad', input: z.string(), output: z.string(), model: 'tiny', instructions: '', prompt: '' });`
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable(
  'canonical schema composition permits codec options and rejects fake harness imports and raw exported agents',
  async () => {
    const diagnostics = await lintRule('agent-definition', {
      'src/features/example/agents/grade.ts': `import {defineAgent} from '#server/platform/definitions/define-agent';
import {Schema} from 'effect';
import {requestSchema,resultSchema} from '@study/contracts';
export const grade = defineAgent({id:'grade', input: Schema.Union([requestSchema, resultSchema]), output: Schema.decodeTo(resultSchema, {decode: f, encode: g})(requestSchema), model:'medium', instructions:'grade',prompt: f});`,
      'src/features/example/agents/rogue.ts':
        "export const rogue = { generate: async () => 'bad' };",
      'src/features/example/agents/fake.ts': `import {defineAgent} from '../elsewhere/runtime/define-agent';
 export const fakeAgent = defineAgent({id:'fake',input: x,output:y,model:'medium',instructions:'x',prompt:f});
`
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => !filename.endsWith('/agents/grade.ts')));
  }
);

testStable('local export lists and default exports cannot publish raw agents', async () => {
  const diagnostics = await lintRule('agent-definition', {
    'src/features/example/agents/rogue.ts': 'const agent = { id: 1 }; export { agent };',
    'src/features/example/agents/other.ts': 'export default { id: 1 };'
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable('agents in feature-owned folders also require canonical definitions', async () => {
  const diagnostics = await lintRule('agent-definition', {
    'src/features/sources/agents/vision.ts': 'export const vision = { generate() {} };'
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable(
  'document preparation declarations use the shared factory and canonical reference/result schemas',
  async () => {
    const diagnostics = await lintRule('agent-definition', {
      'src/features/example/agents/preparation.ts':
        "import {defineDocumentPreparation as define} from '#server/platform/ai/document-processing/index'; import {Input, Output} from '@study/contracts'; const policy = define({referenceSchema: Input, mappedSchema: Output}); export {policy};",
      'src/features/example/agents/namespace.ts':
        "import * as processing from '#server/platform/ai/document-processing/index'; import {Input, Output} from '@study/contracts'; export const policy = processing.defineDocumentPreparation({referenceSchema: Input, mappedSchema: Output});",
      'src/features/example/agents/inline.ts':
        "import {defineDocumentPreparation} from '#server/platform/ai/document-processing/index'; import {Schema} from 'effect'; import {Input} from '@study/contracts'; export const policy = defineDocumentPreparation({referenceSchema: Input, mappedSchema: Schema.Struct({value: Schema.String})});",
      'src/features/example/agents/fake-preparation.ts':
        "import {defineDocumentPreparation} from './fake'; export const policy = defineDocumentPreparation({});"
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
    assert.ok(
      diagnostics.every(({ filename }) => /(?:inline|fake-preparation)\.ts$/.test(filename))
    );
  }
);
