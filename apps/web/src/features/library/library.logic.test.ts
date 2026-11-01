import { projectIdSchema } from '@study/contracts/ids';
import { materialSummarySchema } from '@study/contracts/materials/schemas';
import { sourceSchema } from '@study/contracts/sources/schemas';
import { Schema } from 'effect';
import { expect, it } from 'vite-plus/test';

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
  const materials = Schema.decodeUnknownSync(Schema.Array(materialSummarySchema))(
    [
      { id: 20n, projectIds: [1n], kind: 'diagram', title: 'Map', updated_at: 3n },
      { id: 21n, projectIds: [1n], kind: 'flashcards', title: 'Cards', updated_at: 4n },
      { id: 22n, projectIds: [1n], kind: 'quiz', title: 'Quiz', updated_at: 1n },
      { id: 23n, projectIds: [2n], kind: 'diagram', title: 'Other map', updated_at: 5n }
    ].map((material) => {
      const version = {
        id: material.id,
        material_id: material.id,
        kind: material.kind,
        number: 1n,
        status: 'published',
        operation: 'original',
        creator: 'user',
        instruction: null,
        language: null,
        created_at: 1n,
        published_at: 1n
      };

      return {
        ...material,
        created_at: 1n,
        archived_at: null,
        version,
        latestPublishedVersion: version,
        latestDraftVersion: null
      };
    })
  );

  expect(libraryItems('library', sources, materials, project).map((item) => item.value.id)).toEqual(
    [20n, 10n]
  );
  expect(
    libraryItems('practice', sources, materials, project).map((item) => item.value.id)
  ).toEqual([21n, 22n]);
});
