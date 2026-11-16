import { StudyRpc } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises the scoped Study RPC client against a real application and HTTP server.  │
 * │ It covers lazy endpoint discovery, project and settings operations, binary source data,  │
 * │ theme operations, and typed validation failures.                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: scoped native client exchanges projects, settings, bytes and typed errors     │
 * │   over HTTP.                                                                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/runtime/index with real SQLite and application        │
 * │ resources; fixture cleanup closes owned resources.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect, Option } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { serve } from '#server/runtime/index';

test.stable(
  'scoped native client exchanges projects, settings, bytes and typed errors over HTTP',
  async ({ resources: database }) => {
    const app = await database.openApp({ path: database.path });
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

            test.assert.strictEqual(discoveries, 0);
            test.assert.ok((yield* client['system.health']({})).workersRunning === false);
            yield* client['system.startWorkers']({});
            test.assert.ok((yield* client['system.health']({})).workersRunning === true);
            yield* client['system.stopWorkers']({});
            test.assert.ok((yield* client['system.health']({})).workersRunning === false);
            const project = yield* client['projects.createProject']({ name: 'Biology' });

            test.assert.ok(typeof project.id === 'bigint');
            test.assert.ok(
              (yield* client['projects.project']({ id: project.id })).name === 'Biology'
            );
            const settings = yield* client['settings.appSettings']({});

            yield* client['settings.saveAppSettings']({ ...settings, onboarded: true });
            test.assert.ok((yield* client['settings.appSettings']({})).onboarded === true);
            const theme = yield* client['themes.importTheme']({
              json: JSON.stringify({
                version: 1,
                id: 'biology-test',
                name: 'Biology',
                colors: { primary: 'red' }
              })
            });

            yield* client['themes.selectTheme']({ id: theme.id });
            test.assert.strictEqual(yield* client['themes.selectedTheme']({}), theme.id);
            yield* client['themes.deleteTheme']({ id: theme.id });
            test.assert.strictEqual(yield* client['themes.selectedTheme']({}), null);
            const bytes = new Uint8Array([0, 255, 17]);
            const source = yield* client['sources.createSource']({
              name: 'notes.txt',
              bytes,
              projectId: project.id
            });

            test
              .expect((yield* client['sources.source']({ id: source.id })).sha256)
              .toStrictEqual(source.sha256);
            test.assert.ok(Option.isSome(yield* client['sources.findSource']({ id: source.id })));
            const error = yield* Effect.flip(client['projects.createProject']({ name: '' }));

            test.assert.ok('kind' in error);
            test.assert.ok(error.kind === 'invalid_input');
            test.assert.strictEqual(discoveries, 1);
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      await database.close();
    }
  }
);
