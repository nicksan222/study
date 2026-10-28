import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';

test('partial reorder leaves the existing session order intact', async (t) => {
  const f = await createBackendTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' }),
    session = await f.caller.conversations.createSession({ project: p.id, title: 'S' }),
    content = { kind: 'diagram', format: 'mermaid', payload: 'A' } as const;
  const a = await c.create({ projectId: p.id, sessionId: session.id, title: 'A', content }),
    b = await c.create({ projectId: p.id, sessionId: session.id, title: 'B', content });

  await assert.rejects(c.reorder({ sessionId: session.id, materialIds: [a.id] }), {
    kind: 'invalid_input'
  });
  assert.deepEqual(
    (await c.list({ projectId: p.id, sessionId: session.id })).items.map((m) => m.id),
    [a.id, b.id]
  );
});
