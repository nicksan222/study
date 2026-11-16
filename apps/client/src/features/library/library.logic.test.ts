import { projectIdSchema, materialSummarySchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { libraryItems } from './library.logic';

test.stable('filters practice materials by project and orders newest first', () => {
  const project = Schema.decodeUnknownSync(projectIdSchema)(1n);
  const materials = Schema.decodeUnknownSync(Schema.Array(materialSummarySchema))(
    [
      { id: 20n, projectIds: [1n], kind: 'quiz', title: 'Map', updated_at: 3n },
      { id: 21n, projectIds: [1n], kind: 'flashcards', title: 'Cards', updated_at: 4n },
      { id: 22n, projectIds: [1n], kind: 'quiz', title: 'Quiz', updated_at: 1n },
      { id: 23n, projectIds: [2n], kind: 'quiz', title: 'Other map', updated_at: 5n }
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

  test
    .expect(libraryItems(materials, project).map((item) => item.value.id))
    .toEqual([21n, 20n, 22n]);
});
