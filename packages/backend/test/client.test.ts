import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as schema from '@study/db/schema';
import { TRPCClientError } from '@trpc/client';
import { EventSource } from 'eventsource';

import { createStudyClient as browserClient } from '#backend/client/index';
import { createStudyClient as nodeClient } from '#backend/client/node';
import { App, serve } from '#backend/runtime/index';
import { createBackendTest } from '#testing/backend-test';

for (const environment of ['browser', 'node'] as const) {
  test(
    `${environment} client exchanges plain bigint IDs, bytes, typed errors and cancellable SSE over real HTTP`,
    { timeout: 10000 },
    async (t) => {
      const database = createBackendTest(t, { app: false });
      const app = await App.open({ path: database.path });

      database.dispose(() => app.close());
      const server = await serve(app);

      database.dispose(() => server.close());
      let discoveries = 0;
      const options = {
        baseUrl: async () => {
          discoveries++;

          return server.url;
        }
      };
      // A browser provides this native interface; Node's public entry supplies the ponyfill itself.
      const client =
        environment === 'node' ? nodeClient(options) : browserClient({ ...options, EventSource });

      assert.equal(discoveries, 0);
      const project = await client.projects.createProject.mutate({
        name: 'Biology'
      });

      assert.equal(typeof project.id, 'bigint');
      assert.equal(project.name, 'Biology');
      assert.equal((await client.practice.dueCount.query({ project: project.id })).value, 0);
      assert.equal(
        (
          await client.practice.dueBy.query({
            project: project.id,
            until: BigInt(Date.now())
          })
        ).value,
        0
      );
      assert.deepEqual(
        (
          await client.practice.dueCards.query({
            project: project.id,
            limit: 1
          })
        ).items,
        []
      );
      assert.equal((await client.jobs.jobOverviews.query({ limit: 1 })).items.length, 0);
      const source = await client.sources.uploadSource.mutate({
        name: 'notes.txt',
        bytes: new Uint8Array([0, 255, 17]),
        project: project.id
      });

      assert.equal(source.projectId, project.id);
      assert.deepEqual(
        (await client.sources.exportSource.query({ id: source.id })).value,
        new Uint8Array([0, 255, 17])
      );
      await assert.rejects(
        client.projects.createProject.mutate({ name: '' }),
        (error: unknown) => error instanceof TRPCClientError && error.data?.kind === 'invalid_input'
      );
      // Exercise both directions using a persisted identity beyond Number.MAX_SAFE_INTEGER.
      app.store.db.orm
        .insert(schema.projects)
        .values({
          id: 9007199254740993n,
          name: 'Large identity',
          created_at: 0n,
          updated_at: 0n
        })
        .run();
      assert.equal(
        (
          await client.projects.renameProject.mutate({
            id: 9007199254740993n,
            name: 'Exact identity'
          })
        ).value,
        true
      );
      assert.ok(
        (await client.projects.projects.query({})).items.some(
          (item) => item.id === 9007199254740993n && item.name === 'Exact identity'
        )
      );
      assert.equal((await client.sources.source.query({ id: 999n })).value, null);
      const session = await client.conversations.createSession.mutate({
        project: project.id,
        title: 'Lecture'
      });
      const message = await client.conversations.postMessage.mutate({
        place: { type: 'timeline', id: session.id },
        text: 'Uploaded',
        attachments: [source.id],
        files: []
      });

      assert.equal(message.sessionId, session.id);
      assert.equal(message.parts[0]?.sourceId, source.id);
      const controller = new AbortController();
      let started!: () => void;
      const connected = new Promise<void>((resolve) => {
        started = resolve;
      });
      let received!: () => void;
      const hint = new Promise<void>((resolve) => {
        received = resolve;
      });
      let events = 0;
      const subscription = client.system.subscribe.subscribe(
        {},
        {
          signal: controller.signal,
          onStarted: () => started(),
          onData: (event) => {
            assert.equal(event.type, 'refresh');
            events++;
            received();
          }
        }
      );

      database.dispose(() => subscription.unsubscribe());
      await connected;
      await client.projects.createProject.mutate({ name: 'Physics' });
      await hint;
      assert.ok(events >= 1);
      controller.abort();
      subscription.unsubscribe();
      await assert.rejects(client.projects.projects.query({}, { signal: AbortSignal.abort() }));
      assert.equal(discoveries, 1);
    }
  );
}
