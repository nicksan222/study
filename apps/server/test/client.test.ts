import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StudyRpc } from '@study/contracts/rpc';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Option } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

test('scoped native client exchanges projects, settings, bytes and typed errors over HTTP', async () => {
  const database = createTestDatabase();
  const app = await App.open({ path: database.path });
  const server = await serve(app);
  let discoveries = 0;

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, {
            baseUrl: () => {
              discoveries++;

              return server.url;
            }
          });

          assert.equal(discoveries, 0);
          assert.equal((yield* client['system.health']({})).workersRunning, false);
          yield* client['system.startWorkers']({});
          assert.equal((yield* client['system.health']({})).workersRunning, true);
          yield* client['system.stopWorkers']({});
          assert.equal((yield* client['system.health']({})).workersRunning, false);
          const project = yield* client['projects.createProject']({ name: 'Biology' });

          assert.equal(typeof project.id, 'bigint');
          assert.equal((yield* client['projects.project']({ id: project.id })).name, 'Biology');
          const settings = yield* client['settings.appSettings']({});

          yield* client['settings.saveAppSettings']({ ...settings, onboarded: true });
          assert.equal((yield* client['settings.appSettings']({})).onboarded, true);
          const theme = yield* client['themes.importTheme']({
            json: JSON.stringify({
              version: 1,
              id: 'biology-test',
              name: 'Biology',
              colors: { primary: 'red' }
            })
          });

          yield* client['themes.selectTheme']({ id: theme.id });
          assert.equal(yield* client['themes.selectedTheme']({}), theme.id);
          yield* client['themes.deleteTheme']({ id: theme.id });
          assert.equal(yield* client['themes.selectedTheme']({}), null);
          const bytes = new Uint8Array([0, 255, 17]);
          const source = yield* client['sources.createSource']({
            name: 'notes.txt',
            bytes,
            projectId: project.id
          });

          assert.deepEqual(
            (yield* client['sources.source']({ id: source.id })).sha256,
            source.sha256
          );
          assert.ok(Option.isSome(yield* client['sources.findSource']({ id: source.id })));
          const error = yield* Effect.flip(client['projects.createProject']({ name: '' }));

          assert.ok('kind' in error);
          assert.equal(error.kind, 'invalid_input');
          assert.equal(discoveries, 1);
        })
      )
    );
  } finally {
    await server.close();
    await app.close();
    database.cleanup();
  }
});
