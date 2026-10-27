import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { materialsRouter } from './router.ts';
test('get distinguishes missing materials from invalid ids', async (t) => {
  const f = await fixture(t),
    c = materialsRouter.createCaller(f.context);

  assert.equal(await c.get({ id: 999n }), null);
  await assert.rejects(c.get({ id: 0n }));
});

test('published head and latest draft remain explicit while a branch is edited', async (t) => {
  const f = await fixture(t),
    c = materialsRouter.createCaller(f.context),
    p = await f.caller.projects.createProject({ name: 'P' }),
    content = { kind: 'diagram', format: 'mermaid', payload: 'A' } as const;
  const a = await c.create({ projectId: p.id, title: 'A', content });
  const draft = await c.createVersion({
    materialId: a.id,
    content: { ...content, payload: 'Draft' },
    publish: false,
    parents: [a.version.id]
  });
  const head = await c.get({ id: a.id });

  assert.equal(head?.version.id, a.version.id);
  assert.equal(head?.latestPublishedVersion?.id, a.version.id);
  assert.equal(head?.latestDraftVersion?.id, draft.id);
  await c.publishVersion({ id: draft.id });
  const updated = await c.get({ id: a.id });

  assert.equal(updated?.version.id, draft.id);
  assert.equal(updated?.latestDraftVersion, null);
});
