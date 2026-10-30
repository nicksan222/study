import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Effect } from 'effect';

import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import { createStudyTest } from '#testing/server-test';

test('native projects and source inputs persist after reopening the real application', async (t) => {
  const fixture = await createStudyTest(t);
  const app = fixture.app;
  const source = await fixture.run(
    Effect.gen(function* () {
      const project = yield* (yield* Projects).createProject({ name: 'Physics' });

      return yield* (yield* Sources).createSource({
        projectId: project.id,
        name: 'notes.txt',
        bytes: new TextEncoder().encode('Hello')
      });
    })
  );

  await app.close();
  const reopened = await fixture.openApp();

  await reopened.nativeRuntime.runPromise(
    Effect.gen(function* () {
      const projects = yield* (yield* Projects).projects({ limit: 10 });

      assert.equal(projects.items[0]?.name, 'Physics');
      const snapshot = yield* (yield* Sources).sourceSnapshot({ id: source.id, revision: 1 });

      assert.equal(new TextDecoder().decode(snapshot.bytes), 'Hello');
    })
  );
});
