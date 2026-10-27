import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { materialsRouter } from './router.ts';
test('detach removes membership while preserving project content', async (t) => {
  const f = await fixture(t),
    c = materialsRouter.createCaller(f.context),
    p = await f.caller.projects.createProject({ name: 'P' }),
    session = await f.caller.conversations.createSession({ project: p.id, title: 'S' });
  const a = await c.create({
    projectId: p.id,
    sessionId: session.id,
    title: 'A',
    content: { kind: 'diagram', format: 'mermaid', payload: 'A' }
  });

  await c.detach({ sessionId: session.id, materialId: a.id });
  assert.equal((await c.list({ projectId: p.id, sessionId: session.id })).items.length, 0);
  assert.equal((await c.get({ id: a.id }))?.version.id, a.version.id);
});
