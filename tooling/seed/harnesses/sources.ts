import { createHash } from 'node:crypto';

import { sniff } from '@study/contracts/sources/sniff';
import {
  sources,
  source_blobs,
  source_snapshots,
  source_extraction_revisions,
  source_processing
} from '@study/db/schema';

import type { SourceFixture } from '../types.ts';
import type { ProjectHarness } from './scope.ts';
import { snapshot } from './snapshots.ts';

export function createSource(project: ProjectHarness, fixture: SourceFixture) {
  const { db, projectId, time } = project;
  const bytes = Buffer.from(fixture.bytes);
  const detected = sniff(fixture.name, bytes);
  const source = db.orm
    .insert(sources)
    .values({
      project_id: projectId,
      origin: 'import',
      ...detected,
      name: fixture.name,
      size_bytes: BigInt(bytes.length),
      sha256: createHash('sha256').update(bytes).digest(),
      created_at: time
    })
    .returning()
    .get();

  db.orm.insert(source_blobs).values({ source_id: source.id, bytes }).run();
  db.orm
    .insert(source_snapshots)
    .values({ source_id: source.id, revision: 1n, bytes, ...detected })
    .run();

  const snapshotId = snapshot(db, fixture.document, time, source.id);

  db.orm
    .insert(source_extraction_revisions)
    .values({
      source_id: source.id,
      revision: 1n,
      snapshot_id: snapshotId
    })
    .run();
  db.orm
    .insert(source_processing)
    .values({
      source_id: source.id,
      revision: 1n,
      request_id: `seed/${source.id}`,
      published_request_id: `seed/${source.id}`,
      document_id: snapshotId
    })
    .run();
  project.summary.sources++;

  return { id: source.id, projectId };
}
