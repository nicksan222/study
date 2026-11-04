import { eq } from '@study/db';
import { study_documents, study_document_versions, project_documents } from '@study/db/schema';

import { document, heading } from '../builders/content.ts';
import type { NoteFixture } from '../types.ts';
import type { ProjectHarness } from './scope.ts';
import { snapshot } from './snapshots.ts';

export function createDocument(project: ProjectHarness, fixture: NoteFixture) {
  const { db, projectId, time } = project;
  const snapshotId = snapshot(
    db,
    document([heading(fixture.title), ...fixture.blocks]),
    time,
    null
  );
  const note = db.orm
    .insert(study_documents)
    .values({
      title: fixture.title,
      description: fixture.description ?? null,
      created_at: time,
      updated_at: time
    })
    .returning()
    .get();
  const version = db.orm
    .insert(study_document_versions)
    .values({
      document_id: note.id,
      number: 1n,
      content_snapshot_id: snapshotId,
      created_at: time
    })
    .returning()
    .get();

  db.orm
    .update(study_document_versions)
    .set({ status: 'published', published_at: time })
    .where(eq(study_document_versions.id, version.id))
    .run();
  db.orm.insert(project_documents).values({ project_id: projectId, document_id: note.id }).run();
  project.summary.documents++;

  return { id: note.id, projectId };
}
