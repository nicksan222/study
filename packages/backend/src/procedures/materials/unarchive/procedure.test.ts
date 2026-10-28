import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';

test('unarchive restores visibility and version creation', async (t) => {
  const f = await createBackendTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' }),
    content = { kind: 'diagram', format: 'mermaid', payload: 'A' } as const;
  const a = await c.create({ projectId: p.id, title: 'A', content });

  await c.archive({ id: a.id });
  await c.unarchive({ id: a.id });
  assert.equal((await c.createVersion({ materialId: a.id, content })).number, 2n);
  assert.equal((await c.get({ id: a.id }))?.archived_at, null);
});
