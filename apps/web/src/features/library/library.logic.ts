import type { ProjectId, MaterialId } from '@study/contracts/ids';
import { Effect } from 'effect';

import { listMaterials, listSources } from '../../lib/study-client/operations';
import type { Materials, Sources } from '../../lib/study-client/operations';

export type LibraryItem =
  | { type: 'source'; value: Sources[number] }
  | { type: 'material'; value: Materials[number] };

export type ItemFilter = 'all' | 'session' | 'source' | 'diagram' | 'flashcards' | 'quiz';

export function loadLibraryItems(
  section: 'library' | 'practice',
  projectIds: readonly ProjectId[],
  project?: ProjectId,
  api = { listSources, listMaterials }
) {
  return Effect.gen(function* () {
    const [sources, materials] = yield* Effect.all(
      [
        section === 'library' ? api.listSources() : Effect.succeed([]),
        Effect.forEach(
          projectIds,
          (id) =>
            Effect.gen(function* () {
              const items: Materials = [];
              let cursor: MaterialId | undefined;

              do {
                const page = yield* api.listMaterials(id, cursor);

                items.push(...page.items);
                cursor = page.nextCursor ?? undefined;
              } while (cursor !== undefined);

              return items;
            }),
          { concurrency: 4 }
        )
      ],
      { concurrency: 2 }
    );
    const items: LibraryItem[] = [
      ...sources
        .filter((source) => !project || source.projectId === project)
        .map((value): LibraryItem => ({ type: 'source', value })),
      ...materials
        .flat()
        .filter((material) =>
          section === 'library'
            ? material.kind === 'diagram'
            : material.kind === 'flashcards' || material.kind === 'quiz'
        )
        .map((value): LibraryItem => ({ type: 'material', value }))
    ];

    return items.sort((a, b) => {
      const at = a.type === 'source' ? a.value.createdAt : a.value.updated_at;
      const bt = b.type === 'source' ? b.value.createdAt : b.value.updated_at;

      return at === bt ? 0 : at > bt ? -1 : 1;
    });
  });
}
