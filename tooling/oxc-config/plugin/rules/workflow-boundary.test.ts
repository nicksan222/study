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
        rules: { 'study/workflow-boundary': 'error' }
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

test('keeps workflow constructors and memory infrastructure within their owners', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/domains/a/service.ts': `import { Workflow as W, Activity, WorkflowEngine } from 'effect/workflow'; const make = W.make; make('x'); Activity.make({}); WorkflowEngine.makeUnsafe({}); WorkflowEngine.layerMemory;`,
      'apps/server/src/platform/definitions/define-workflow.ts': `import { Workflow } from 'effect/workflow'; Workflow.make('x');`,
      'apps/server/src/platform/workflows/store.ts': `import { Activity } from 'effect/workflow'; Activity.make({});`,
      'apps/server/src/platform/workflows/engine.ts': `import { WorkflowEngine } from 'effect/workflow'; WorkflowEngine.makeUnsafe({});`,
      'apps/server/src/domains/b/service.ts': `import { Workflow } from 'effect/workflow'; function f(Workflow) { Workflow.make('x'); }`,
      'apps/web/src/a.ts': `export { Workflow } from 'effect/workflow';`,
      'packages/contracts/src/a.ts': `import type { Workflow } from 'effect/workflow';`
    }),
    [
      'apps/server/src/domains/a/service.ts',
      'apps/server/src/domains/a/service.ts',
      'apps/server/src/domains/a/service.ts',
      'apps/server/src/domains/a/service.ts',
      'apps/web/src/a.ts',
      'packages/contracts/src/a.ts'
    ]
  );
});

test('only the SQLite engine may grant a workflow activity lease', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/domains/jobs/service.ts':
        "import {Effect,Layer} from 'effect'; import {WorkflowActivityOwner as Owner} from '#server/platform/workflows/ownership'; Effect.provideService(task,Owner,forged); Layer.succeed(Owner,forged);",
      'apps/server/src/platform/workflows/engine.ts':
        "import {Effect} from 'effect'; import {WorkflowActivityOwner} from '#server/platform/workflows/ownership'; Effect.provideService(task,WorkflowActivityOwner,captured);"
    }),
    ['apps/server/src/domains/jobs/service.ts', 'apps/server/src/domains/jobs/service.ts']
  );
});

test('only the platform engine grants activity and publication capabilities through aliases', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/source/source.rpc.ts':
        "import { Effect, Layer, Context } from 'effect'; import * as caps from '#server/platform/workflows/ownership'; const owner = caps.WorkflowActivityOwner; const guard = caps.PublicationGuard; Effect.provideService(task, owner, fake); Layer.succeed(guard, fake); Context.make(guard, fake); function f(guard) { Context.make(guard, fake); }",
      'apps/server/src/platform/workflows/engine.ts':
        "import { Effect } from 'effect'; import { PublicationGuard } from '#server/platform/workflows/ownership'; Effect.provideService(task, PublicationGuard, real);"
    }),
    [
      'apps/server/src/features/source/source.rpc.ts',
      'apps/server/src/features/source/source.rpc.ts',
      'apps/server/src/features/source/source.rpc.ts'
    ]
  );
});

test('publication guards are granted only by their actual platform owner', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/sources/service.ts':
        "import {Effect, Layer} from 'effect'; import {PublicationGuard as Guard} from '#server/platform/workflows/publication'; Effect.provideService(task, Guard, fake); Layer.succeed(Guard, fake);",
      'apps/server/src/platform/workflows/publication.ts':
        "import {Effect} from 'effect'; import {PublicationGuard} from '#server/platform/workflows/publication'; Effect.provideService(task, PublicationGuard, captured);",
      'apps/server/src/features/sources/workflow.ts':
        "import { Activity } from 'effect/workflow'; Activity.make({});"
    }),
    ['apps/server/src/features/sources/service.ts', 'apps/server/src/features/sources/service.ts']
  );
});

test('destructuring does not grant permission to forge capabilities', () => {
  const files = {
    'apps/server/src/features/sources/workflow.ts':
      "import { Effect } from 'effect'; import * as caps from '#server/platform/workflows/publication'; const { PublicationGuard: Guard } = caps; const Alias = Guard; Effect.provideService(task, Alias, {} as any); function f(Guard) { Effect.provideService(task, Guard, {}); }",
    'apps/server/src/features/sources/service.ts':
      "import { Layer } from 'effect'; import * as caps from '#server/platform/workflows/ownership'; const { WorkflowActivityOwner: Owner } = caps; Layer.succeed(Owner, {} as any);"
  };

  assert.deepEqual(lint(files), [
    'apps/server/src/features/sources/service.ts',
    'apps/server/src/features/sources/workflow.ts'
  ]);
});
