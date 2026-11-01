import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRulePaths } from '../test/utils.ts';

function lint(files: Record<string, string>) {
  return lintRulePaths('structured-logging', files);
}

test('centralizes effect logging and requires safe annotations', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/domains/a/service.ts': `import { Effect as E } from 'effect'; const log = E.logInfo; log(input); E.annotateLogs({prompt: input}); E.annotateLogs({requestId: input}); E.annotateLogs('prompt', 'text'); E.withSpan('x', {attributes: {input: 'static'}});`,
      'apps/server/src/domains/c/service.ts': `import { Effect } from 'effect'; import * as obs from '#server/platform/observability/index'; Effect.annotateLogs(effect, obs.safeMetadata(metadata));`,
      'apps/server/src/runtime/main.ts': `import { Effect } from 'effect'; Effect.logError(error);`,
      'apps/server/src/platform/observability/index.ts': `import { Effect } from 'effect'; Effect.logDebug('start'); Effect.annotateLogs(safeMetadata(data));`,
      'apps/server/src/runtime/request.ts': `import { randomUUID } from 'node:crypto'; import { Effect } from 'effect'; Effect.annotateLogs({requestId: randomUUID()});`,
      'apps/server/src/domains/b/service.ts': `import { Effect } from 'effect'; function f(Effect) { Effect.logInfo(input); }`
    }),
    [
      'apps/server/src/domains/a/service.ts',
      'apps/server/src/domains/a/service.ts',
      'apps/server/src/domains/a/service.ts',
      'apps/server/src/domains/a/service.ts',
      'apps/server/src/runtime/main.ts'
    ]
  );
});

test('the worker terminal owner can log static failures without raw causes', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/runtime/workers.ts':
        "import {Effect} from 'effect'; Effect.logError('Workflow recovery failed'); Effect.logError(cause);"
    }),
    ['apps/server/src/runtime/workers.ts']
  );
});
