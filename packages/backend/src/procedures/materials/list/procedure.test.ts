import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';

test('project list pages never duplicate ids and honors archive filters', async (t) => {
  const f = await createBackendTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' });

  for (let i = 0; i < 4; i++)
    await c.create({
      projectId: p.id,
      title: String(i),
      content: { kind: 'diagram', format: 'mermaid', payload: 'graph TD' }
    });

  const first = await c.list({ projectId: p.id, take: 2 });

  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = await c.list({ projectId: p.id, take: 2, cursor: first.nextCursor });

  assert.equal(second.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map((m) => m.id)).size, 4);
  const id = first.items[0]!.id;

  await c.rename({ id, title: 'Renamed' });
  assert.equal((await c.get({ id }))?.title, 'Renamed');
  await c.archive({ id });
  assert.equal((await c.list({ projectId: p.id })).items.length, 3);
  assert.equal((await c.list({ projectId: p.id, archived: true })).items.length, 1);
  await assert.rejects(
    c.createVersion({
      materialId: id,
      content: { kind: 'diagram', format: 'mermaid', payload: 'new' }
    })
  );
  await c.unarchive({ id });
  assert.equal((await c.list({ projectId: p.id })).items.length, 4);
  await assert.rejects(c.list({ projectId: p.id, take: 101 }));
});

test('material lists return bounded metadata summaries without loading content payloads', async (t) => {
  const f = await createBackendTest(t),
    c = f.caller.materials;
  const p = await f.caller.projects.createProject({ name: 'P' });
  const material = await c.create({
    projectId: p.id,
    title: 'Quiz',
    content: {
      kind: 'quiz',
      questions: [
        {
          kind: 'single_choice',
          prompt: 'Q',
          explanation: 'E',
          choices: [
            { text: 'A', isCorrect: true },
            { text: 'B', isCorrect: false }
          ]
        }
      ]
    }
  });
  const page = await c.list({ projectId: p.id });

  assert.equal(page.items[0]?.id, material.id);
  assert.equal(page.items[0]?.version.id, material.version.id);
  assert.equal('content' in page.items[0]!.version, false);
  await assert.rejects(
    c.create({
      projectId: p.id,
      title: 'Too many choices',
      content: {
        kind: 'quiz',
        questions: [
          {
            kind: 'multiple_choice',
            prompt: 'Q',
            explanation: 'E',
            choices: Array.from({ length: 101 }, (_, i) => ({ text: String(i), isCorrect: true }))
          }
        ]
      }
    }),
    { kind: 'invalid_input' }
  );
});
