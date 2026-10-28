import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';

test('getCitations reads markers in numeric order', async (t) => {
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
    inputVersionId: a.version.id,
    quote: 'A',
    anchor: { type: 'page', page: 1 } as const
  };

  await c.setCitations({
    id: b.version.id,
    citations: [
      { ...citation, marker: 10n },
      { ...citation, marker: 2n }
    ]
  });
  assert.deepEqual(
    (await c.getCitations({ id: b.version.id })).map((c) => c.marker),
    [2n, 10n]
  );
});
