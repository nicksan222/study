import type { MaterialId, SourceId, PageId } from '@study/contracts/ids';
import { notes, project_notes, note_sources, note_pages, note_materials } from '@study/db/schema';

import type { Exchange } from '../types.ts';
import { createMessages } from './messages.ts';
import { ownedId } from './scope.ts';
import type { Created, ProjectHarness } from './scope.ts';

type NoteFixture = {
  readonly title: string;
  readonly exchanges: readonly Exchange[];
  readonly daysAgo: number;
  readonly sources?: readonly Created<SourceId>[];
  readonly pages?: readonly Created<PageId>[];
  readonly materials?: readonly Created<MaterialId>[];
};

export function createNote(project: ProjectHarness, fixture: NoteFixture) {
  const { db, projectId } = project;
  const time = project.now - BigInt(fixture.daysAgo) * 86400n;
  const note = db.orm
    .insert(notes)
    .values({
      title: fixture.title,
      title_source: 'user',
      created_at: time,
      updated_at: time + BigInt(Math.max(0, fixture.exchanges.length - 1) * 120 + 30)
    })
    .returning()
    .get();

  db.orm.insert(project_notes).values({ project_id: projectId, note_id: note.id }).run();

  for (const [position, source] of (fixture.sources ?? []).entries()) {
    db.orm
      .insert(note_sources)
      .values({
        note_id: note.id,
        source_id: ownedId(project, source),
        position: BigInt(position)
      })
      .run();
  }

  for (const [position, document] of (fixture.pages ?? []).entries()) {
    db.orm
      .insert(note_pages)
      .values({
        note_id: note.id,
        page_id: ownedId(project, document),
        position: BigInt(position)
      })
      .run();
  }

  for (const [position, material] of (fixture.materials ?? []).entries()) {
    db.orm
      .insert(note_materials)
      .values({
        note_id: note.id,
        material_id: ownedId(project, material),
        position: BigInt(position)
      })
      .run();
  }

  createMessages(db, note.id, fixture.exchanges, time);
  project.summary.notes++;

  return { id: note.id, projectId };
}
