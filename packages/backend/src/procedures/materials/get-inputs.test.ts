import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { materialsRouter } from './router.ts';
test('getInputs pages declared snapshots without leaking other edges', async (t) => {
  const f = await fixture(t),
    c = materialsRouter.createCaller(f.context),
    p = await f.caller.projects.createProject({ name: 'P' }),
    content = { kind: 'diagram', format: 'mermaid', payload: 'A' } as const;
  const a = await c.create({ projectId: p.id, title: 'A', content }),
    b = await c.create({ projectId: p.id, title: 'B', content }),
    d = await c.create({
      projectId: p.id,
      title: 'D',
      content,
      inputs: [a.version.id, b.version.id]
    });
  const first = await c.getInputs({ id: d.version.id, take: 1 });

  assert.deepEqual(
    first.items.map((v) => v.id),
    [a.version.id]
  );
  assert.equal(first.nextCursor, a.version.id);
  const last = await c.getInputs({ id: d.version.id, take: 1, cursor: first.nextCursor! });

  assert.deepEqual(
    last.items.map((v) => v.id),
    [b.version.id]
  );
  assert.equal(last.nextCursor, null);
  assert.deepEqual((await c.getInputs({ id: a.version.id })).items, []);
});
