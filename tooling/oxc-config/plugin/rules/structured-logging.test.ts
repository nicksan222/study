import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { root } from '../test/utils.ts';

function lint(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-rule-'));

  try {
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    writeFileSync(
      join(dir, 'plugin.mjs'),
      `import { definePlugin } from 'vite-plus/lint/plugins';\nimport rules from ${JSON.stringify(join(root, 'tooling/oxc-config/plugin/observability-rules.ts'))};\nexport default definePlugin({ meta: { name: 'study' }, rules });`
    );
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        jsPlugins: [{ name: 'study', specifier: join(dir, 'plugin.mjs') }],
        categories: { correctness: 'off' },
        rules: { 'study/structured-logging': 'error' }
      })
    );

    for (const [path, source] of Object.entries(files)) {
      const file = join(dir, path);

      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    }

    const result = spawnSync(
      join(root, 'node_modules/.bin/oxlint'),
      [
        '--config',
        join(dir, 'config.json'),
        '--no-ignore',
        '--format',
        'json',
        ...Object.keys(files).map((path) => join(dir, path))
      ],
      { encoding: 'utf8', cwd: root }
    );

    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);

    return (JSON.parse(result.stdout) as { diagnostics: { filename: string }[] }).diagnostics
      .map((d) => d.filename.slice(dir.length + 1))
      .sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
