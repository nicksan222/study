import { StudyRpc } from '@study/contracts';
import { projects } from '@study/db';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { Projects } from '#server/features/projects/index';

test.stable(
  'server scenario owns an isolated app and bound runtime',
  async ({ server, expect }) => {
    expect(server.app.store.db.orm.select().from(projects).all()).toHaveLength(0);
    await server.runPromise(
      Effect.flatMap(Projects, (projects) => projects.createProject({ name: 'Only in this test' }))
    );
  }
);

test.stable('a later server scenario starts with a fresh database', async ({ server, expect }) => {
  expect(server.app.store.db.orm.select().from(projects).all()).toHaveLength(0);
});

test.stable(
  'owned endpoint factory isolates multiple RPC applications',
  async ({ endpoints, expect }) => {
    const first = await endpoints();
    const firstPath = first.location.path;
    const created = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const firstClient = yield* makeStudyClient(StudyRpc, { baseUrl: first.url });

          return yield* firstClient['projects.createProject']({ name: 'First endpoint' });
        })
      )
    );

    await first.close();
    const second = await endpoints();
    const other = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const secondClient = yield* makeStudyClient(StudyRpc, { baseUrl: second.url });

          return yield* secondClient['projects.projects']({ limit: 10 });
        })
      )
    );

    expect(firstPath).not.toBe(second.location.path);
    expect(created.name).toBe('First endpoint');
    expect(other.items.map((project) => project.name)).toEqual([]);
  }
);

test.stable(
  'RPC scenario exposes a working client and preserves data on reopen',
  async ({ rpc, expect }) => {
    expect((await rpc.runPromise(rpc.client['system.health']({}))).workersRunning).toBe(false);
    const created = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'Persistent scenario' })
    );

    await rpc.reopen();

    const restored = await rpc.runPromise(rpc.client['projects.project']({ id: created.id }));

    expect(restored.name).toBe('Persistent scenario');
    expect(rpc.client).toBeDefined();
  }
);

test.stable(
  'RPC scenario closes the endpoint even when a scoped client finalizer fails',
  async ({ rpc, expect }) => {
    await rpc.runPromise(Effect.addFinalizer(() => Effect.die(new Error('Client cleanup failed'))));
    const url = rpc.url;

    await expect(rpc.close()).rejects.toThrow('Client cleanup failed');
    await expect(fetch(url)).rejects.toThrow();
  }
);
