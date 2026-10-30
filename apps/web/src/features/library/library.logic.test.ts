import { projectIdSchema } from '@study/contracts/ids';
import { sourceSchema } from '@study/contracts/sources/schemas';
import { Schema } from 'effect';
import { expect, it } from 'vite-plus/test';

import type { Materials } from '../../lib/study-client/operations';
import { libraryItems } from './library.logic';

it('filters by section and project and orders mixed items newest first', () => {
  const project = Schema.decodeUnknownSync(projectIdSchema)(1n);
  const sources = Schema.decodeUnknownSync(Schema.Array(sourceSchema))(
    [
      { id: 10n, projectId: 1n, name: 'Slides', createdAt: 2n },
      { id: 11n, projectId: 2n, name: 'Other slides', createdAt: 5n }
    ].map((source) => ({
      ...source,
      kind: 'pdf',
      mime: 'application/pdf',
      origin: 'import',
      projectName: null,
      sizeBytes: 0n,
      sha256: new Uint8Array(),
      uri: null
    }))
  );
  const materials = [
    { id: 20n, project_id: 1n, kind: 'diagram', title: 'Map', updated_at: 3n },
    { id: 21n, project_id: 1n, kind: 'flashcards', title: 'Cards', updated_at: 4n },
    { id: 22n, project_id: 1n, kind: 'quiz', title: 'Quiz', updated_at: 1n },
    { id: 23n, project_id: 2n, kind: 'diagram', title: 'Other map', updated_at: 5n }
  ] as Materials;

  expect(libraryItems('library', sources, materials, project).map((item) => item.value.id)).toEqual(
    [20n, 10n]
  );
  expect(
    libraryItems('practice', sources, materials, project).map((item) => item.value.id)
  ).toEqual([21n, 22n]);
});
