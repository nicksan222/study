import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { materialsRouter } from './router.ts';
test('archive keeps snapshots readable and prevents new descendants', async (t) => {
  const f = await fixture(t),
    c = materialsRouter.createCaller(f.context),
    p = await f.caller.projects.createProject({ name: 'P' }),
    content = { kind: 'diagram', format: 'mermaid', payload: 'A' } as const;
  const a = await c.create({ projectId: p.id, title: 'A', content });

  await c.archive({ id: a.id });
  assert.equal((await c.getVersion({ id: a.version.id }))?.status, 'published');
  await assert.rejects(c.create({ projectId: p.id, title: 'B', content, inputs: [a.version.id] }), {
    kind: 'invalid_input'
  });
  assert.equal((await c.list({ projectId: p.id, archived: true })).items.length, 1);
});
