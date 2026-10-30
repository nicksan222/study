import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProjectId } from '@study/contracts/ids';
import { ProjectsRpc } from '@study/contracts/projects/rpc';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Option } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Projects } from '#server/features/projects/service/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { ProjectsRpcLive } from './index.ts';

test('native RPC handlers return projects and typed failures', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const handlers = ProjectsRpcLive.pipe(
    Layer.provide(Projects.layer),
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(ProjectsRpc, { flatten: true });
          const id = 999n as ProjectId;

          assert.equal((yield* Effect.flip(client('projects.project', { id }))).kind, 'not_found');
          assert.ok(Option.isNone(yield* client('projects.findProject', { id })));
          assert.equal(
            (yield* Effect.flip(client('projects.createProject', { name: ' ' }))).kind,
            'invalid_input'
          );
          const created = yield* client('projects.createProject', { name: 'Test' });

          assert.equal((yield* client('projects.project', { id: created.id })).name, 'Test');
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
