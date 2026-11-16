import { StudyRpc } from '@study/contracts';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';

test.server.stable(
  'owned RPC applications preserve data when reopened and release the database',
  async ({ createServerFixture, expect }) => {
    await using fixture = await createServerFixture();
    const path = fixture.path;

    try {
      let endpoint = await fixture.openRpc();
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: endpoint.server.url });

            return yield* client['projects.createProject']({ name: 'Persistent fixture' });
          })
        )
      );

      await endpoint.server.close();
      await endpoint.app.close();
      endpoint = await fixture.openRpc();
      const restored = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: endpoint.server.url });

            return yield* client['projects.project']({ id: saved.id });
          })
        )
      );

      expect(restored.name).toBe('Persistent fixture');
    } finally {
      await fixture.close();
    }

    expect(await Bun.file(path).exists()).toBe(false);
  }
);
