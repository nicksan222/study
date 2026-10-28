import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import {
  createMaterial,
  createMaterialFromDocument
} from '#backend/procedures/materials/operations/create-material';
import { materialContentSchema } from '#backend/procedures/materials/schemas';
import type { MaterialContentInput } from '#backend/shared/materials/schemas';
import { createBackendTest } from '#testing/backend-test';
import { document } from '#testing/procedures';

test('all material kinds roundtrip through their typed payloads', async (t) => {
  const f = await createBackendTest(t),
    caller = f.caller.materials;
  const project = await f.caller.projects.createProject({ name: 'Physics' });
  const source = (
    kind: typeof s.sources.$inferInsert.kind,
    mime: string,
    uri: string | null = null
  ) => {
    const id = f.store.db.orm
      .insert(s.sources)
      .values({
        project_id: project.id,
        origin: 'import',
        kind,
        mime,
        name: 'Source',
        size_bytes: 3n,
        sha256: Buffer.alloc(32),
        uri,
        created_at: 1n
      })
      .returning()
      .get().id;

    f.store.db.orm
      .insert(s.source_blobs)
      .values({ source_id: id, bytes: Buffer.from('abc') })
      .run();

    return id;
  };
  const cases: MaterialContentInput[] = [
    { kind: 'diagram', format: 'mermaid', payload: 'graph TD; A-->B' },
    { kind: 'document', ...document },
    { kind: 'file', sourceId: source('text', 'text/plain') },
    {
      kind: 'audio',
      sourceId: source('audio', 'audio/wav'),
      durationMs: null,
      sampleRate: null,
      channels: null
    },
    {
      kind: 'video',
      sourceId: source('video', 'video/mp4'),
      durationMs: null,
      width: null,
      height: null
    },
    { kind: 'image', sourceId: source('image', 'image/png'), width: null, height: null },
    { kind: 'link', sourceId: source('web', 'text/html', 'https://example.com') },
    {
      kind: 'quiz',
      questions: [
        {
          kind: 'single_choice',
          prompt: 'One?',
          explanation: 'One',
          choices: [
            { text: '1', isCorrect: true },
            { text: '2', isCorrect: false }
          ]
        },
        {
          kind: 'multiple_choice',
          prompt: 'Both?',
          explanation: 'Both',
          choices: [
            { text: '1', isCorrect: true },
            { text: '2', isCorrect: true }
          ]
        },
        { kind: 'open', prompt: 'Why?', explanation: 'Because', referenceAnswer: 'Reason' }
      ]
    },
    { kind: 'flashcards', cards: [{ front: 'Front', back: 'Back' }] }
  ];

  for (const content of cases) {
    const made = await caller.create({
      projectId: project.id,
      title: content.kind,
      content: structuredClone(content)
    });
    const read = await caller.getVersion({ id: made.version.id });

    assert.equal(read?.kind, content.kind);
    assert.equal(read?.status, 'published');

    if (content.kind === 'flashcards' && read?.kind === 'flashcards')
      assert.deepEqual(
        read.content.cards.map((card) => ({ front: card.front, back: card.back })),
        content.cards
      );
    else assert.deepEqual(materialContentSchema.parse(read?.content), content);

    assert.equal((await caller.get({ id: made.id }))?.version.id, made.version.id);

    if (read?.kind === 'quiz') {
      assert.equal(read.content.questions.length, 3);
      assert.equal(read.content.questions[2]?.kind, 'open');
    }

    if (read?.kind === 'document') assert.deepEqual(read.content.blocks, document.blocks);

    if (read?.kind === 'flashcards') assert.equal(read.content.cards[0]?.front, 'Front');
  }

  assert.equal((await caller.list({ projectId: project.id })).items.length, 9);
});

test('create validates payloads before writing and rolls back unknown references', async (t) => {
  const f = await createBackendTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' }),
    content = { kind: 'diagram', format: 'mermaid', payload: 'A' } as const;

  await assert.rejects(c.create({ projectId: p.id, title: ' ', content }));
  await assert.rejects(
    c.create({ projectId: p.id, title: 'Empty', content: { ...content, payload: ' ' } })
  );
  await assert.rejects(
    c.create({
      projectId: p.id,
      title: 'Bad quiz',
      content: {
        kind: 'quiz',
        questions: [
          {
            kind: 'single_choice',
            prompt: 'Which',
            explanation: 'Why',
            choices: [
              { text: 'A', isCorrect: true },
              { text: 'B', isCorrect: true }
            ]
          }
        ]
      }
    })
  );
  await assert.rejects(
    c.create({
      projectId: p.id,
      title: 'Missing source',
      content: { kind: 'file', sourceId: 999n }
    }),
    { kind: 'not_found' }
  );
  await assert.rejects(
    c.create({ projectId: p.id, title: 'Missing input', content, inputs: [999n] }),
    { kind: 'not_found' }
  );
  await assert.rejects(
    c.create({
      projectId: p.id,
      title: 'Bad anchor',
      content: {
        kind: 'document',
        ...document,
        blocks: [{ kind: 'paragraph', text: 'A', anchor: { type: 'time', startMs: 10, endMs: 1 } }]
      }
    })
  );
  assert.deepEqual((await c.list({ projectId: p.id })).items, []);
});

test('publication constraint failures are domain errors and roll back source-backed payloads', async (t) => {
  const f = await createBackendTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' });
  const source = f.store.db.orm
    .insert(s.sources)
    .values({
      project_id: p.id,
      origin: 'import',
      kind: 'text',
      mime: 'text/plain',
      name: 'Source',
      size_bytes: 3n,
      sha256: Buffer.alloc(32),
      created_at: 1n
    })
    .returning()
    .get();

  f.store.db.orm
    .insert(s.source_blobs)
    .values({ source_id: source.id, bytes: Buffer.from('abc') })
    .run();
  await assert.rejects(
    c.create({
      projectId: p.id,
      title: 'Not audio',
      content: {
        kind: 'audio',
        sourceId: source.id,
        durationMs: null,
        sampleRate: null,
        channels: null
      }
    }),
    { kind: 'invalid_input' }
  );
  assert.equal((await c.list({ projectId: p.id })).items.length, 0);
});

test('createMaterialFromDocument binds the canonical document without copying it', async (t) => {
  const f = await createBackendTest(t),
    p = await f.caller.projects.createProject({ name: 'P' });
  const doc = f.store.db.orm
    .insert(s.documents)
    .values({
      source_id: null,
      extractor: null,
      extractor_version: 1n,
      meta: JSON.stringify(document.meta),
      created_at: 1n
    })
    .returning()
    .get();

  f.store.db.orm
    .insert(s.blocks)
    .values({
      document_id: doc.id,
      ordinal: 0n,
      kind: 'paragraph',
      text: 'Canonical block',
      anchor: JSON.stringify({ type: 'paragraph', index: 0 })
    })
    .run();
  const made = createMaterialFromDocument(f.store, {
    projectId: p.id,
    title: 'Extracted',
    documentId: doc.id,
    operation: 'extract'
  });

  assert.equal(
    f.store.db.orm
      .select()
      .from(s.material_document_versions)
      .where(eq(s.material_document_versions.version_id, made.version.id))
      .get()?.document_id,
    doc.id
  );
  assert.equal(f.store.db.orm.select().from(s.documents).all().length, 1);
  assert.equal(made.version.kind, 'document');

  if (made.version.kind === 'document')
    assert.equal(made.version.content.blocks[0]?.text, 'Canonical block');
});

test('internal creation helpers report validation failures as StudyError', async (t) => {
  const f = await createBackendTest(t),
    p = await f.caller.projects.createProject({ name: 'P' });

  assert.throws(
    () =>
      createMaterial(f.store, {
        projectId: p.id,
        title: ' ',
        content: { kind: 'diagram', format: 'mermaid', payload: 'A' }
      }),
    { name: 'StudyError', kind: 'invalid_input' }
  );
});
