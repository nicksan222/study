/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises project RPC handlers against a test SQLite database, including           │
 * │ pagination inputs and typed lookup failures.                                             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises native RPC handlers return projects and typed failures.                      │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

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
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
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

          assert.equal(created.icon, null);
          const custom = yield* client('projects.setIcon', { id: created.id, icon: 'BIO' });
          assert.equal(custom.icon, 'BIO');
          assert.equal((yield* client('projects.project', { id: created.id })).icon, 'BIO');
          yield* client('projects.renameProject', { id: created.id, name: 'Cell Biology' });
          assert.equal((yield* client('projects.project', { id: created.id })).icon, 'BIO');
          const automatic = yield* client('projects.setIcon', { id: created.id, icon: null });
          assert.equal(automatic.icon, null);
          assert.equal(automatic.name, 'Cell Biology');
          assert.equal(
            (yield* Effect.flip(client('projects.setIcon', { id, icon: 'A' }))).kind,
            'not_found'
          );
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
