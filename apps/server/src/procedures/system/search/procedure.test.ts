import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession as opCreateSession } from '#server/procedures/conversations/operations/create-session';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { createServerTest } from '#testing/server-test';
test('search maps persisted full-text hits, scopes projects, and bounds limits', async (t) => {
  const f = await createServerTest(t);

  assert.equal(
    (
      await f.caller.system.search({
        query: 'gravity'
      })
    ).hits.length,
    0
  );
  const p = opCreateProject(f.store, 'Gravity'),
    other = opCreateProject(f.store, 'Chemistry');

  opCreateSession(f.store, p.id, 'Gravity lecture');
  const result = await f.caller.system.search({
    query: 'gravity',
    limit: 10
  });

  assert.equal(result.semantic, false);
  assert.ok(result.hits.some((h) => h.target.type === 'project' && h.title === 'Gravity'));
  assert.ok(result.hits.some((h) => h.target.type === 'session' && h.title === 'Gravity lecture'));
  const scoped = await f.caller.system.search({
    query: 'gravity',
    project: other.id
  });

  assert.equal(scoped.hits.length, 0);
  await assert.rejects(
    f.caller.system.search({
      query: 'gravity',
      limit: 101
    }),
    {
      kind: 'invalid_input'
    }
  );
  await assert.rejects(
    f.caller.system.search({
      query: 'gravity',
      project: 0n
    }),
    {
      kind: 'invalid_input'
    }
  );
});

test('search filters kinds before applying the result limit', async (t) => {
  const f = await createServerTest(t);
  const project = opCreateProject(f.store, 'Gravity');

  opCreateSession(f.store, project.id, 'Gravity lecture');
  const result = await f.caller.system.search({
    query: 'gravity',
    limit: 1,
    kinds: ['session', 'message']
  });

  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0]?.title, 'Gravity lecture');
  assert.equal(result.hits[0]?.target.type, 'session');
});
