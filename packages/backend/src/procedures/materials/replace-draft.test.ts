import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { materialsRouter } from './router.ts';
test('draft replacement preserves card identity and published history', async (t) => {
  const f = await fixture(t),
    c = materialsRouter.createCaller(f.context),
    p = await f.caller.projects.createProject({ name: 'P' });
  const a = await c.create({
    projectId: p.id,
    title: 'Cards',
    content: { kind: 'flashcards', cards: [{ front: 'A', back: 'B' }] }
  });

  assert.equal(a.version.kind, 'flashcards');

  if (a.version.kind !== 'flashcards') throw Error();

  const cardId = a.version.content.cards[0]!.cardId;
  const draft = await c.createVersion({
    materialId: a.id,
    publish: false,
    parents: [a.version.id],
    content: { kind: 'flashcards', cards: [{ cardId, front: 'C', back: 'D' }] }
  });
  const replaced = await c.replaceDraft({
    id: draft.id,
    content: { kind: 'flashcards', cards: [{ cardId, front: 'E', back: 'F' }] }
  });

  assert.equal(replaced.kind, 'flashcards');

  if (replaced.kind === 'flashcards') assert.equal(replaced.content.cards[0]?.cardId, cardId);

  await c.publishVersion({ id: draft.id });
  await assert.rejects(
    c.replaceDraft({
      id: draft.id,
      content: { kind: 'flashcards', cards: [{ front: 'x', back: 'y' }] }
    })
  );
  await assert.rejects(c.deleteDraft({ id: draft.id }));
  const disposable = await c.createVersion({
    materialId: a.id,
    publish: false,
    content: { kind: 'flashcards', cards: [{ cardId, front: 'G', back: 'H' }] }
  });

  await c.deleteDraft({ id: disposable.id });
  assert.equal(await c.getVersion({ id: disposable.id }), null);
  const old = await c.getVersion({ id: a.version.id });

  if (old?.kind === 'flashcards') assert.equal(old.content.cards[0]?.front, 'A');
});

test('failed draft replacement restores payload and provenance atomically', async (t) => {
  const f = await fixture(t),
    c = materialsRouter.createCaller(f.context),
    p = await f.caller.projects.createProject({ name: 'P' }),
    content = { kind: 'diagram', format: 'mermaid', payload: 'Original' } as const;
  const source = await c.create({ projectId: p.id, title: 'Source', content }),
    a = await c.create({
      projectId: p.id,
      title: 'Draft',
      content,
      publish: false,
      inputs: [source.version.id]
    });
  const citation = {
    marker: 1n,
    inputVersionId: source.version.id,
    anchor: { type: 'paragraph', index: 0 } as const,
    quote: 'Original'
  };

  await c.setCitations({ id: a.version.id, citations: [citation] });
  await assert.rejects(
    c.replaceDraft({ id: a.version.id, content: { ...content, payload: 'Lost?' }, inputs: [999n] }),
    { kind: 'not_found' }
  );
  const unchanged = await c.getVersion({ id: a.version.id });

  assert.equal(unchanged?.kind, 'diagram');

  if (unchanged?.kind === 'diagram') assert.equal(unchanged.content.payload, 'Original');

  assert.deepEqual(unchanged?.inputs, [source.version.id]);
  assert.deepEqual(await c.getCitations({ id: a.version.id }), [citation]);
});
