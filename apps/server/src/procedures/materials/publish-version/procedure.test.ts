import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServerTest } from '#testing/server-test';

test('publication seals drafts and rechecks archived inputs', async (t) => {
  const f = await createServerTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' }),
    content = { kind: 'diagram', format: 'mermaid', payload: 'A' } as const;
  const a = await c.create({ projectId: p.id, title: 'A', content }),
    b = await c.create({
      projectId: p.id,
      title: 'B',
      content,
      publish: false,
      inputs: [a.version.id]
    });

  await c.archive({ id: a.id });
  await assert.rejects(c.publishVersion({ id: b.version.id }), { kind: 'invalid_input' });
  assert.equal((await c.getVersion({ id: b.version.id }))?.status, 'draft');
  await c.unarchive({ id: a.id });
  const published = await c.publishVersion({ id: b.version.id });

  assert.equal(published.status, 'published');
  assert.ok(published.published_at);
  await assert.rejects(c.publishVersion({ id: b.version.id }), { kind: 'invalid_input' });
});
