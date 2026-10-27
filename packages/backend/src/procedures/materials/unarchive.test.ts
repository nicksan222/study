import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { materialsRouter } from './router.ts';
test('unarchive restores visibility and version creation', async (t) => {
  const f = await fixture(t),
    c = materialsRouter.createCaller(f.context),
    p = await f.caller.projects.createProject({ name: 'P' }),
    content = { kind: 'diagram', format: 'mermaid', payload: 'A' } as const;
  const a = await c.create({ projectId: p.id, title: 'A', content });

  await c.archive({ id: a.id });
  await c.unarchive({ id: a.id });
  assert.equal((await c.createVersion({ materialId: a.id, content })).number, 2n);
  assert.equal((await c.get({ id: a.id }))?.archived_at, null);
});
