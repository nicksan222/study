import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { createSession } from '#server/procedures/conversations/operations/create-session';
import { sourceMaterial } from '#server/procedures/ingestion/source-material';
import { claimJob } from '#server/procedures/jobs/worker';
import { materialsRouter } from '#server/procedures/materials/router';
import { sourceBytes } from '#server/procedures/sources/operations/source';
import { saveRead, saveDocument } from '#server/procedures/sources/operations/source-document';
import { document } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';

test('uploads publish typed originals, metadata and session membership', async (t) => {
  const f = await createServerTest(t),
    caller = f.caller.ingestion;
  const project = await f.caller.projects.createProject({ name: 'Physics' });
  const session = createSession(f.store, project.id, 'Class');
  const made = await caller.uploadFile({
    projectId: project.id,
    sessionId: session.id,
    name: 'notes.txt',
    bytes: Buffer.from('Real notes')
  });

  assert.equal(made.kind, 'file');
  assert.equal(made.version.status, 'published');

  if (made.version.kind !== 'file') throw new Error('Expected file');

  assert.equal(Buffer.isBuffer(made.version.content.source.sha256), true);
  assert.equal(
    made.version.content.source.sha256.toString('hex'),
    createHash('sha256').update('Real notes').digest('hex')
  );
  assert.equal(
    Buffer.from(sourceBytes(f.store, made.version.content.sourceId)!).toString(),
    'Real notes'
  );
  assert.equal(f.store.db.orm.select().from(s.session_materials).get()?.material_id, made.id);
  const audio = await caller.uploadFile({
    projectId: project.id,
    name: 'lecture.wav',
    bytes: readFileSync(new URL('../fixtures/audio.wav', import.meta.url)),
    durationMs: 42n,
    sampleRate: 16000n,
    channels: 1n
  });

  if (audio.version.kind !== 'audio') throw new Error('Expected audio');

  assert.equal(audio.version.content.durationMs, 42n);
  assert.equal(audio.version.content.sampleRate, 16000n);
  const image = await caller.uploadFile({
    projectId: project.id,
    name: 'image.png',
    bytes: readFileSync(new URL('../fixtures/image.png', import.meta.url))
  });

  if (image.version.kind !== 'image') throw new Error('Expected image');

  assert.equal(image.version.content.width, null);
  const video = await caller.uploadFile({
    projectId: project.id,
    name: 'video.mp4',
    bytes: readFileSync(new URL('../fixtures/video.mp4', import.meta.url)),
    width: 640n,
    height: 480n
  });

  if (video.version.kind !== 'video') throw new Error('Expected video');

  assert.equal(video.version.content.width, 640n);
  assert.equal(video.version.content.durationMs, null);
});

test('invalid session rolls back bytes, source, material and jobs', async (t) => {
  const f = await createServerTest(t),
    caller = f.caller.ingestion;
  const p = await f.caller.projects.createProject({ name: 'One' }),
    q = await f.caller.projects.createProject({ name: 'Two' });
  const session = createSession(f.store, q.id, 'Other');

  await assert.rejects(
    caller.uploadFile({
      projectId: p.id,
      sessionId: session.id,
      name: 'notes.txt',
      bytes: Buffer.from('notes')
    })
  );

  for (const table of [s.sources, s.source_blobs, s.materials, s.material_versions, s.jobs])
    assert.equal(f.store.db.orm.select().from(table).all().length, 0);
});

test('extraction job ownership and attempts guard all persisted graph rows', async (t) => {
  const f = await createServerTest(t),
    caller = f.caller.ingestion;
  const project = await f.caller.projects.createProject({ name: 'Notes' });
  const original = await caller.uploadFile({
    projectId: project.id,
    name: 'notes.txt',
    bytes: Buffer.from('notes')
  });

  if (original.version.kind !== 'file') throw new Error('Expected file');

  const source = original.version.content.source;
  const current = claimJob(f.store, ['extract'])!;

  assert.equal(saveRead(f.store, current.id, current.attempts + 1n, source.id, document), null);
  assert.equal(f.store.db.orm.select().from(s.documents).all().length, 0);
  assert.equal(f.store.db.orm.select().from(s.materials).all().length, 1);
  const id = saveRead(f.store, current.id, current.attempts, source.id, document)!;
  const payload = f.store.db.orm.select().from(s.material_document_versions).get()!;

  assert.equal(payload.document_id, id);
  assert.equal(
    f.store.db.orm.select().from(s.material_version_inputs).get()?.input_version_id,
    original.version.id
  );
  const legacySource = await f.caller.sources.source({ id: source.id });

  assert.equal(sourceMaterial(f.store, legacySource.value!)?.id, original.id);
  assert.equal(f.store.db.orm.select().from(s.materials).all().length, 2);
});

test('extraction lineage resolves the source snapshot rather than a later material head', async (t) => {
  const f = await createServerTest(t),
    caller = f.caller.ingestion;
  const project = await f.caller.projects.createProject({ name: 'Versions' });
  const first = await caller.uploadFile({
    projectId: project.id,
    name: 'first.txt',
    bytes: Buffer.from('First bytes')
  });
  const second = await caller.uploadFile({
    projectId: project.id,
    name: 'second.txt',
    bytes: Buffer.from('Second bytes')
  });

  if (first.version.kind !== 'file' || second.version.kind !== 'file')
    throw new Error('Expected files');

  const later = await materialsRouter.createCaller(f.context).createVersion({
    materialId: first.id,
    content: { kind: 'file', sourceId: second.version.content.sourceId },
    parents: [first.version.id]
  });

  assert.notEqual(later.id, first.version.id);
  const docId = saveDocument(f.store, first.version.content.sourceId, document);
  const payload = f.store.db.orm
    .select()
    .from(s.material_document_versions)
    .where(eq(s.material_document_versions.document_id, docId))
    .get()!;

  assert.equal(
    f.store.db.orm
      .select()
      .from(s.material_version_inputs)
      .where(eq(s.material_version_inputs.version_id, payload.version_id))
      .get()?.input_version_id,
    first.version.id
  );
  assert.equal(f.store.db.orm.select().from(s.materials).all().length, 3);
});
