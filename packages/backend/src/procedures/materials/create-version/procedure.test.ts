import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';

const content = { kind: 'diagram', format: 'mermaid', payload: 'graph TD; A-->B' } as const;

test('versions branch, preserve published snapshots and validate all input ownership', async (t) => {
  const f = await createBackendTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' }),
    other = await f.caller.projects.createProject({ name: 'Other' });
  const a = await c.create({ projectId: p.id, title: 'A', content }),
    b = await c.create({ projectId: p.id, title: 'B', content }),
    foreign = await c.create({ projectId: other.id, title: 'Foreign', content });
  const v = await c.createVersion({
    materialId: a.id,
    content: { ...content, payload: 'new' },
    parents: [a.version.id],
    inputs: [a.version.id, b.version.id],
    publish: false
  });

  assert.equal(v.number, 2n);
  assert.equal(v.status, 'draft');
  await assert.rejects(
    c.createVersion({ materialId: a.id, content, inputs: [foreign.version.id] })
  );
  await assert.rejects(c.createVersion({ materialId: a.id, content, parents: [b.version.id] }));
  await assert.rejects(c.createVersion({ materialId: a.id, content, inputs: [v.id] }));
  await assert.rejects(
    c.createVersion({ materialId: a.id, content, inputs: [b.version.id, b.version.id] })
  );
  const inputs = await c.getInputs({ id: v.id });

  assert.equal(inputs.items.length, 2);
  assert.equal('content' in inputs.items[0]!, false);
  assert.equal('content' in (await c.listVersions({ materialId: a.id })).items[0]!, false);
  assert.equal((await c.getDependents({ id: b.version.id })).items[0]?.id, v.id);
  const branch = await c.createVersion({ materialId: a.id, content, parents: [a.version.id] });

  assert.equal(branch.number, 3n);
  assert.equal((await c.getVersion({ id: a.version.id }))?.content.kind, 'diagram');
});
