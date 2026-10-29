import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServerTest } from '#testing/server-test';

test('session membership reorders atomically and rejects foreign projects', async (t) => {
  const f = await createServerTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' }),
    o = await f.caller.projects.createProject({ name: 'O' });
  const session = await f.caller.conversations.createSession({ project: p.id, title: 'S' }),
    foreign = await f.caller.conversations.createSession({ project: o.id, title: 'F' });
  const a = await c.create({
      projectId: p.id,
      sessionId: session.id,
      title: 'A',
      content: { kind: 'diagram', format: 'mermaid', payload: 'A' }
    }),
    b = await c.create({
      projectId: p.id,
      title: 'B',
      content: { kind: 'diagram', format: 'mermaid', payload: 'B' }
    });

  await c.attach({ sessionId: session.id, materialId: b.id });
  await assert.rejects(c.attach({ sessionId: foreign.id, materialId: a.id }));
  await c.reorder({ sessionId: session.id, materialIds: [b.id, a.id] });
  assert.deepEqual(
    (await c.list({ projectId: p.id, sessionId: session.id })).items.map((i) => i.id),
    [b.id, a.id]
  );
  await assert.rejects(c.reorder({ sessionId: session.id, materialIds: [a.id, a.id] }));
  await c.detach({ sessionId: session.id, materialId: b.id });
  assert.equal((await c.list({ projectId: p.id, sessionId: session.id })).items.length, 1);
});
