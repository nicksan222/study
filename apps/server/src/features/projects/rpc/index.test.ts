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

import type { ProjectId } from '@study/contracts/ids';
import { ProjectsRpc } from '@study/contracts/projects/rpc';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Option } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Projects } from '#server/features/projects/service/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { ProjectsRpcLive } from './index.ts';

testStable('native RPC handlers return projects and typed failures', async () => {
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

          expect((yield* Effect.flip(client('projects.project', { id }))).kind).toStrictEqual(
            'not_found'
          );
          assert.ok(Option.isNone(yield* client('projects.findProject', { id })));
          expect(
            (yield* Effect.flip(client('projects.createProject', { name: ' ' }))).kind
          ).toStrictEqual('invalid_input');
          const created = yield* client('projects.createProject', { name: 'Test' });

          expect(created.icon).toStrictEqual({ kind: 'automatic', color: 'neutral' });
          const custom = yield* client('projects.setIcon', {
            id: created.id,
            icon: { kind: 'monogram', value: 'BIO', color: 'neutral' }
          });

          expect(custom.icon).toStrictEqual({ kind: 'monogram', value: 'BIO', color: 'neutral' });
          expect((yield* client('projects.project', { id: created.id })).icon).toStrictEqual({
            kind: 'monogram',
            value: 'BIO',
            color: 'neutral'
          });
          yield* client('projects.renameProject', { id: created.id, name: 'Cell Biology' });
          expect((yield* client('projects.project', { id: created.id })).icon).toStrictEqual({
            kind: 'monogram',
            value: 'BIO',
            color: 'neutral'
          });
          const automatic = yield* client('projects.setIcon', {
            id: created.id,
            icon: { kind: 'automatic', color: 'neutral' }
          });

          expect(automatic.icon).toStrictEqual({ kind: 'automatic', color: 'neutral' });
          expect(automatic.name).toStrictEqual('Cell Biology');
          expect(
            (yield* Effect.flip(
              client('projects.setIcon', {
                id,
                icon: { kind: 'monogram', value: 'A', color: 'neutral' }
              })
            )).kind
          ).toStrictEqual('not_found');
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
