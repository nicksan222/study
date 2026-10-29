import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServerTest } from '#testing/server-test';

test('listVersions pages a single material and rejects foreign cursors', async (t) => {
  const f = await createServerTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' }),
    content = { kind: 'diagram', format: 'mermaid', payload: 'A' } as const;
  const a = await c.create({ projectId: p.id, title: 'A', content }),
    b = await c.create({ projectId: p.id, title: 'B', content });

  await c.createVersion({ materialId: a.id, content });
  await c.createVersion({ materialId: a.id, content });
  const first = await c.listVersions({ materialId: a.id, take: 2 });

  assert.deepEqual(
    first.items.map((v) => v.number),
    [3n, 2n]
  );
  assert.ok(first.nextCursor);
  const last = await c.listVersions({ materialId: a.id, take: 2, cursor: first.nextCursor });

  assert.deepEqual(
    last.items.map((v) => v.number),
    [1n]
  );
  assert.equal(last.nextCursor, null);
  await assert.rejects(c.listVersions({ materialId: a.id, cursor: b.version.id }), {
    kind: 'invalid_input'
  });
});
