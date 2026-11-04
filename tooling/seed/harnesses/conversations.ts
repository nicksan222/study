import type { MaterialId, SourceId, StudyDocumentId } from '@study/contracts/ids';
import {
  sessions,
  project_sessions,
  session_sources,
  session_documents,
  session_materials
} from '@study/db/schema';

import type { Exchange } from '../types.ts';
import { createMessages } from './messages.ts';
import { ownedId } from './scope.ts';
import type { Created, ProjectHarness } from './scope.ts';

type ConversationFixture = {
  readonly title: string;
  readonly exchanges: readonly Exchange[];
  readonly daysAgo: number;
  readonly sources?: readonly Created<SourceId>[];
  readonly documents?: readonly Created<StudyDocumentId>[];
  readonly materials?: readonly Created<MaterialId>[];
};

export function createConversation(project: ProjectHarness, fixture: ConversationFixture) {
  const { db, projectId } = project;
  const time = project.now - BigInt(fixture.daysAgo) * 86400n;
  const session = db.orm
    .insert(sessions)
    .values({
      title: fixture.title,
      title_source: 'user',
      created_at: time,
      updated_at: time + BigInt(Math.max(0, fixture.exchanges.length - 1) * 120 + 30)
    })
    .returning()
    .get();

  db.orm.insert(project_sessions).values({ project_id: projectId, session_id: session.id }).run();

  for (const [position, source] of (fixture.sources ?? []).entries()) {
    db.orm
      .insert(session_sources)
      .values({
        session_id: session.id,
        source_id: ownedId(project, source),
        position: BigInt(position)
      })
      .run();
  }

  for (const [position, document] of (fixture.documents ?? []).entries()) {
    db.orm
      .insert(session_documents)
      .values({
        session_id: session.id,
        document_id: ownedId(project, document),
        position: BigInt(position)
      })
      .run();
  }

  for (const [position, material] of (fixture.materials ?? []).entries()) {
    db.orm
      .insert(session_materials)
      .values({
        session_id: session.id,
        material_id: ownedId(project, material),
        position: BigInt(position)
      })
      .run();
  }

  createMessages(db, session.id, fixture.exchanges, time);
  project.summary.sessions++;

  return { id: session.id, projectId };
}
