import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintRulePaths } from '../test/utils.ts';

async function lint(files: Record<string, string>) {
  return await lintRulePaths('structured-logging', files);
}

testStable('centralizes effect logging and requires safe annotations', async () => {
  expect(
    await lint({
      'apps/server/src/domains/a/service.ts': `import { Effect as E } from 'effect'; const log = E.logInfo; log(input); E.annotateLogs({prompt: input}); E.annotateLogs({requestId: input}); E.annotateLogs('prompt', 'text'); E.withSpan('x', {attributes: {input: 'static'}});`,
      'apps/server/src/domains/c/service.ts': `import { Effect } from 'effect'; import * as obs from '#server/platform/observability/index'; Effect.annotateLogs(effect, obs.safeMetadata(metadata));`,
      'apps/server/src/runtime/main.ts': `import { Effect } from 'effect'; Effect.logError(error);`,
      'apps/server/src/platform/observability/index.ts': `import { Effect } from 'effect'; Effect.logDebug('start'); Effect.annotateLogs(safeMetadata(data));`,
      'apps/server/src/runtime/request.ts': `import { Effect } from 'effect'; Effect.annotateLogs({requestId: crypto.randomUUID()});`,
      'apps/server/src/domains/b/service.ts': `import { Effect } from 'effect'; function f(Effect) { Effect.logInfo(input); }`
    })
  ).toStrictEqual([
    'apps/server/src/domains/a/service.ts',
    'apps/server/src/domains/a/service.ts',
    'apps/server/src/domains/a/service.ts',
    'apps/server/src/domains/a/service.ts',
    'apps/server/src/runtime/main.ts'
  ]);
});

testStable('the worker terminal owner can log static failures without raw causes', async () => {
  expect(
    await lint({
      'apps/server/src/runtime/workers.ts':
        "import {Effect} from 'effect'; Effect.logError('Workflow recovery failed'); Effect.logError(cause);"
    })
  ).toStrictEqual(['apps/server/src/runtime/workers.ts']);
});
