import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRulePaths } from '../test/utils.ts';

function lint(files: Record<string, string>) {
  return lintRulePaths('workflow-boundary', files);
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

test('session cleanup cannot forge publication or Activity ownership while invoking native retirement', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/conversations/workflows/deletion.ts': `
      import { Activity } from 'effect/workflow';
      import { withPublicationGuard } from '#server/platform/workflows/publication';
      export const cleanup = () => Activity.make({execute:withPublicationGuard(context,finishSessionDeletion(input))});
    `,
      'apps/server/src/features/conversations/service/deletion.ts': `
      import { Effect, Layer } from 'effect';
      import { PublicationGuard } from '#server/platform/workflows/publication';
      import { WorkflowActivityOwner } from '#server/platform/workflows/ownership';
      Effect.provideService(finishSessionDeletion(input), PublicationGuard, forged);
      Layer.succeed(WorkflowActivityOwner, forged);
    `
    }),
    Array(2).fill('apps/server/src/features/conversations/service/deletion.ts')
  );
});

test('Material cleanup uses native Activities and cannot forge publication or execution ownership', () => {
  assert.deepEqual(
    lint({
      'apps/server/src/features/materials/workflows/deletion.ts': `
      import { Activity } from 'effect/workflow';
      import { withPublicationGuard } from '#server/platform/workflows/publication';
      export const cleanup = () => Activity.make({execute:withPublicationGuard(context,finishMaterialDeletion(input))});
    `,
      'apps/server/src/features/materials/service/deletion.ts': `
      import { Effect, Layer } from 'effect';
      import { PublicationGuard } from '#server/platform/workflows/publication';
      import { WorkflowActivityOwner } from '#server/platform/workflows/ownership';
      Effect.provideService(finishMaterialDeletion(input), PublicationGuard, forged);
      Layer.succeed(WorkflowActivityOwner, forged);
    `
    }),
    Array(2).fill('apps/server/src/features/materials/service/deletion.ts')
  );
});
