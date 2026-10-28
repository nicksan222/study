import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';

test('citations require declared input versions and canonical anchors', async (t) => {
  const f = await createBackendTest(t),
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
  const citation = {
    marker: 1n,
    inputVersionId: a.version.id,
    anchor: { type: 'paragraph', index: 0 } as const,
    quote: 'A'
  };

  await c.setCitations({ id: b.version.id, citations: [citation] });
  assert.deepEqual(await c.getCitations({ id: b.version.id }), [citation]);
  await assert.rejects(
    c.setCitations({ id: b.version.id, citations: [{ ...citation, inputVersionId: b.version.id }] })
  );
  assert.deepEqual(await c.getCitations({ id: b.version.id }), [citation]);
  await c.publishVersion({ id: b.version.id });
  await assert.rejects(c.setCitations({ id: b.version.id, citations: [] }));
});
