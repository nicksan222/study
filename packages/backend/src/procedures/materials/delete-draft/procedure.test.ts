import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { MaterialContentInput } from '#backend/shared/materials/schemas';
import { createBackendTest } from '#testing/backend-test';
import { document } from '#testing/procedures';
test('deleteDraft clears child payloads and graph links without deleting history', async (t) => {
  const f = await createBackendTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' });
  const contents = [
    { kind: 'document', ...document },
    {
      kind: 'quiz',
      questions: [
        { kind: 'open', prompt: 'Why', explanation: 'Because', referenceAnswer: 'Answer' },
        {
          kind: 'single_choice',
          prompt: 'Which',
          explanation: 'One',
          choices: [
            { text: 'A', isCorrect: true },
            { text: 'B', isCorrect: false }
          ]
        }
      ]
    }
  ] satisfies MaterialContentInput[];

  for (const content of contents) {
    const a = await c.create({ projectId: p.id, title: content.kind, content });
    const draft = await c.createVersion({
      materialId: a.id,
      content,
      publish: false,
      parents: [a.version.id],
      inputs: [a.version.id]
    });

    await c.setCitations({
      id: draft.id,
      citations: [
        {
          marker: 1n,
          inputVersionId: a.version.id,
          anchor: { type: 'paragraph', index: 0 },
          quote: 'A'
        }
      ]
    });
    await c.deleteDraft({ id: draft.id });
    assert.equal(await c.getVersion({ id: draft.id }), null);
    assert.equal((await c.getVersion({ id: a.version.id }))?.status, 'published');
  }
});
