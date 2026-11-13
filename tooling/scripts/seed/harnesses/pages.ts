import { eq } from '@study/db';
import { pages, page_versions, project_pages } from '@study/db/schema';

import { document, heading } from '../builders/content.ts';
import type { PageFixture } from '../types.ts';
import type { ProjectHarness } from './scope.ts';
import { snapshot } from './snapshots.ts';

export function createPage(project: ProjectHarness, fixture: PageFixture) {
  const { db, projectId, time } = project;
  const snapshotId = snapshot(
    db,
    document([heading(fixture.title), ...fixture.blocks]),
    time,
    null
  );
  const note = db.orm
    .insert(pages)
    .values({
      title: fixture.title,
      description: fixture.description ?? null,
      created_at: time,
      updated_at: time
    })
    .returning()
    .get();
  const version = db.orm
    .insert(page_versions)
    .values({
      page_id: note.id,
      number: 1n,
      content_snapshot_id: snapshotId,
      created_at: time
    })
    .returning()
    .get();

  db.orm
    .update(page_versions)
    .set({ status: 'published', published_at: time })
    .where(eq(page_versions.id, version.id))
    .run();
  db.orm.insert(project_pages).values({ project_id: projectId, page_id: note.id }).run();
  project.summary.pages++;

  return { id: note.id, projectId };
}
