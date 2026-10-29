import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServerTest } from '#testing/server-test';

test('rename normalizes titles and rejects blank names without changing the version', async (t) => {
  const f = await createServerTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' });
  const a = await c.create({
    projectId: p.id,
    title: 'A',
    content: { kind: 'diagram', format: 'mermaid', payload: 'A' }
  });
  const renamed = await c.rename({ id: a.id, title: ' B ' });

  assert.equal(renamed.title, 'B');
  assert.equal(renamed.version.id, a.version.id);
  await assert.rejects(c.rename({ id: a.id, title: '   ' }));
  assert.equal((await c.get({ id: a.id }))?.title, 'B');
});
