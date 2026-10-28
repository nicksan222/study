import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';

test('getDependents pages versions consuming the exact snapshot', async (t) => {
  const f = await createBackendTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' }),
    content = { kind: 'diagram', format: 'mermaid', payload: 'A' } as const;
  const a = await c.create({ projectId: p.id, title: 'A', content }),
    b = await c.create({ projectId: p.id, title: 'B', content, inputs: [a.version.id] }),
    d = await c.create({ projectId: p.id, title: 'D', content, inputs: [a.version.id] });
  const first = await c.getDependents({ id: a.version.id, take: 1 });

  assert.deepEqual(
    first.items.map((v) => v.id),
    [b.version.id]
  );
  const last = await c.getDependents({ id: a.version.id, take: 1, cursor: first.nextCursor! });

  assert.deepEqual(
    last.items.map((v) => v.id),
    [d.version.id]
  );
  assert.equal(last.nextCursor, null);
});
