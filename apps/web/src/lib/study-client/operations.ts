import type { SessionDto } from '@study/contracts/conversations/schemas';
import type { ProjectId, MaterialId, SourceId } from '@study/contracts/ids';
import type { MaterialSummaryDto } from '@study/contracts/materials/schemas';
import type { Project } from '@study/contracts/projects/schemas';
import type { Source } from '@study/contracts/sources/schemas';
import type { searchInputSchema } from '@study/contracts/system/rpc';
import type { searchResultSchema } from '@study/contracts/system/schemas';
import { Effect } from 'effect';

import { studyClient } from './client';
import type { StudyClient } from './client';
import { toStudyError } from './errors';

function request<A, E>(invoke: (client: StudyClient) => Effect.Effect<A, E>) {
  return Effect.scoped(Effect.flatMap(studyClient, invoke)).pipe(Effect.mapError(toStudyError));
}

export type Subjects = Project[];

export type Sessions = readonly SessionDto[];

export type Sources = readonly Source[];

export type Materials = MaterialSummaryDto[];

export type SearchResults = typeof searchResultSchema.Type;

export type SearchInput = typeof searchInputSchema.Type;

export const listProjects = () =>
  request((client) =>
    Effect.gen(function* () {
      const items: Project[] = [];
      let before: ProjectId | undefined;

      do {
        const page = yield* client['projects.projects']({ limit: 100, before });

        items.push(...page.items);
        before = page.next ?? undefined;
      } while (before !== undefined);

      return items;
    })
  );

export const listSessions = () =>
  request((client) =>
    Effect.gen(function* () {
      const items: SessionDto[] = [];
      let before: Parameters<(typeof client)['conversations.sessions']>[0]['before'];

      do {
        const page = yield* client['conversations.sessions']({ limit: 100, before });

        items.push(...page.items);
        before = page.next ?? undefined;
      } while (before !== undefined);

      return items;
    })
  );

export const listSources = () =>
  request((client) =>
    Effect.gen(function* () {
      const items: Source[] = [];
      let before: SourceId | undefined;

      do {
        const page = yield* client['sources.sources']({ limit: 100, before });

        items.push(...page.items);
        before = page.next ?? undefined;
      } while (before !== undefined);

      return items;
    })
  );

export const listMaterials = (projectId: ProjectId, cursor?: MaterialId) =>
  request((client) =>
    client['materials.materials']({
      projectId,
      cursor,
      limit: 100,
      archived: false
    })
  );

export const searchStudy = (input: SearchInput) =>
  request((client) => client['system.search'](input));

export const createProject = (name: string) =>
  request((client) => client['projects.createProject']({ name }));

export const createSession = (project: ProjectId) =>
  request((client) => client['conversations.createUntitledSession']({ project }));

export const loadAppearance = () =>
  request((client) =>
    Effect.gen(function* () {
      const [settings, selected] = yield* Effect.all(
        [client['settings.appSettings']({}), client['themes.selectedTheme']({})],
        { concurrency: 2 }
      );
      const themes = [];
      let before: string | undefined;

      do {
        const page = yield* client['themes.themes']({ limit: 100, before });

        themes.push(...page.items);
        before = page.next ?? undefined;
      } while (before !== undefined);

      return { settings, selected, themes };
    })
  );
