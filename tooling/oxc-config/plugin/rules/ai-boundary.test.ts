import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable('keeps AI SDK access inside the platform runtime', async ({ assert: assertions }) => {
  const assert: test.Assert = assertions;

  const diagnostics = await lintRule({ assert }, 'ai-boundary', {
    'src/domains/jobs/service.ts': "import { generateText } from 'ai';"
  });

  assert.strictEqual(diagnostics.length, 1);
});

test.stable(
  'platform AI runtime owns generation and respects lexical shadowing',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'ai-boundary', {
      'src/platform/ai/providers/a.ts': `import { generateText as generate } from 'ai';
 const run = generate;
 run({});
 function f(run: () => void) { run();
 }`,
      'src/platform/ai/agents.ts': "import { generateText } from 'ai'; generateText({});"
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.stable(
  'feature agents and tools use narrow capabilities and only platform AI owns SDK access',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'ai-boundary', {
      'src/features/source/source.agent.ts': `import { generateText } from 'ai';
 import '@ai-sdk/openai';
 import '@study/db';
 import './source.store';
`,
      'src/features/source/source.tool.ts': "import './source.service'; import './source.store';",
      'src/platform/ai/agents.ts': "import { generateText } from 'ai'; generateText({});"
    });

    assert.strictEqual(diagnostics.length, 5, JSON.stringify(diagnostics));
  }
);

test.stable(
  'model work stays in checkpointed workflow activities',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'ai-boundary', {
      'src/features/sources/service.ts': `import {generateAgent as generate} from '#server/platform/ai/agents';
 const run = generate;
 run(agent,input);
`,
      'src/features/sources/workflow.ts': `import {Activity} from 'effect/workflow';
import {Effect} from 'effect';
import {generateAgent} from '#server/platform/ai/agents';
generateAgent(agent,input);
Activity.make({execute:Effect.gen(function*(){return yield* generateAgent(agent,input,{maxRetries:0,preflight:Effect.void});})});`,
      'src/platform/ai/agents.ts': "import {streamText} from 'ai'; streamText({});"
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.stable(
  'destructured generation aliases cannot bypass checkpoint ownership',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'ai-boundary', {
      'src/features/sources/service.ts': `import * as api from '#server/platform/ai/agents';
const ns = api;
const {generateAgent: run} = ns;
const alias = run;
alias(agent,input);
function f(alias) {alias(agent,input);}`,
      'src/features/sources/workflow.ts':
        "import * as api from '#server/platform/ai/agents'; const ns = api; ns.streamAgent(agent,input);"
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.stable(
  'the agent factory may describe SDK messages but cannot execute SDK generation',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'ai-boundary', {
      'src/platform/definitions/define-agent.ts':
        "import type {ModelMessage} from 'ai'; import {generateText} from 'ai';",
      'src/features/sources/service.ts': "import type {ModelMessage} from 'ai';"
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.stable(
  'workflow model calls declare a last-boundary preflight and leave retries to activities',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'ai-boundary', {
      'src/features/source/workflow.ts': `import {Effect} from 'effect';
import {Activity} from 'effect/workflow';
import {generateAgent} from '#server/platform/ai/agents';
Activity.make({execute:Effect.gen(function*(){yield* generateAgent(agent,input);
yield* generateAgent(agent,input,{maxRetries:1,preflight:Effect.void});
const options={maxRetries:0,preflight:check};
yield* generateAgent(agent,input,options);})});`
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.stable(
  'extracted transform workflows retain explicit Activity ownership and provider preflight',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'ai-boundary', {
      'src/features/materials/workflows/unguarded.ts': `
      import { generateAgent } from '#server/platform/ai/agents';
      export const generate = (input) => generateAgent(agent, input, { maxRetries: 0, preflight: check });
    `,
      'src/features/pages/workflows/page-transform.ts': `
      import { Activity } from 'effect/workflow';
      import { Effect } from 'effect';
      import { generateAgent } from '#server/platform/ai/agents';
      export const generate = (input) => Activity.make({
        name: 'generate-material-1',
        execute: Effect.gen(function* () {
          return yield* generateAgent(agent, input, { maxRetries: 0, preflight: check });
        })
      });
    `
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics[0].filename.endsWith('/workflows/unguarded.ts'));
  }
);

test.stable(
  'canonical activity harness owns generation and still requires request preflight',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'ai-boundary', {
      'src/features/notes/workflows/harness.ts': `import {defineActivity as checkpoint} from '#server/platform/definitions/define-activity';
import {generateAgent} from '#server/platform/ai/agents';
checkpoint({name: 'good', execute: function* () { return yield* generateAgent(agent, input, {maxRetries: 0, preflight});
}});
checkpoint({name: 'bad', execute: function* () { return yield* generateAgent(agent, input);
}});`
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics[0]!.message.includes('preflight'));
  }
);

test.stable(
  'shared context preparation owns agent plumbing while callers retain checkpoint and preflight fences',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'ai-boundary', {
      'src/platform/ai/context-preparation/agent.ts':
        "import {generateAgent} from '#server/platform/ai/agents'; generateAgent(agent, input, {maxRetries:0, preflight:check}); generateAgent(agent, input);",
      'src/platform/ai/context-preparation/unrelated.ts':
        "import {generateAgent} from '#server/platform/ai/agents'; generateAgent(agent, input, {maxRetries:0, preflight:check});",
      'src/features/example/workflows/document.ts':
        "import {defineActivity} from '#server/platform/definitions/define-activity'; import * as api from '#server/platform/ai/agents'; const generate = api.generateAgent; generate(agent,input,{maxRetries:0,preflight}); defineActivity({execute:function*(){ yield* generate(agent,input,{maxRetries:0,preflight}); yield* generate(agent,input,{}); }});",
      'src/features/example/service/direct.ts':
        "import {generateAgent} from '#server/platform/ai/agents'; generateAgent(agent,input,{preflight});",
      'src/features/example/service/index.ts':
        "import * as api from '#server/platform/ai/agents'; const {generateAgent: run} = api; run(agent,input,{preflight}); function shadow(run) {run(agent,input);}"
    });

    assert.strictEqual(diagnostics.length, 6, JSON.stringify(diagnostics));
  }
);
