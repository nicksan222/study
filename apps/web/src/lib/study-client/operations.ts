import type { SessionDto } from '@study/contracts/conversations/schemas';
import type { ProjectId, SourceId, MaterialId } from '@study/contracts/ids';
import type { MaterialSummaryDto } from '@study/contracts/materials/schemas';
import type { Project } from '@study/contracts/projects/schemas';
import type { Source } from '@study/contracts/sources/schemas';
import type { searchInputSchema } from '@study/contracts/system/rpc';
import type { searchResultSchema } from '@study/contracts/system/schemas';
import { Effect } from 'effect';

import { runRequest } from '../effect/runtime';
import { studyClient } from './client';
import type { StudyClient } from './client';
import { toStudyError } from './errors';
import { collectPages } from './pagination';

function request<A, E>(invoke: (client: StudyClient) => Effect.Effect<A, E>, signal?: AbortSignal) {
  return runRequest(
    Effect.scoped(Effect.flatMap(studyClient, invoke)).pipe(Effect.mapError(toStudyError)),
    signal
  );
}

export type Subjects = Project[];

export type Sessions = readonly SessionDto[];

export type Sources = readonly Source[];

export type Materials = MaterialSummaryDto[];

export type SearchResults = typeof searchResultSchema.Type;

export type SearchInput = typeof searchInputSchema.Type;

export const listProjects = (signal?: AbortSignal) =>
  request(
    (client) =>
      collectPages((before: ProjectId | undefined) =>
        client['projects.projects']({ limit: 100, before })
      ),
    signal
  );

export const listSessions = (signal?: AbortSignal) =>
  request(
    (client) =>
      collectPages((before: Parameters<StudyClient['conversations.sessions']>[0]['before']) =>
        client['conversations.sessions']({ limit: 100, before })
      ),
    signal
  );

export const listSources = (signal?: AbortSignal) =>
  request(
    (client) =>
      collectPages((before: SourceId | undefined) =>
        client['sources.sources']({ limit: 100, before })
      ),
    signal
  );

function listAllMaterials(client: StudyClient, projectId: ProjectId) {
  return collectPages((cursor: MaterialId | undefined) =>
    client['materials.materials']({
      projectId,
      cursor,
      limit: 100,
      archived: false
    }).pipe(Effect.map((page) => ({ items: page.items, next: page.nextCursor })))
  );
}

export const listMaterialsForProjects = (projectIds: readonly ProjectId[], signal?: AbortSignal) =>
  request(
    (client) =>
      Effect.forEach(projectIds, (id) => listAllMaterials(client, id), { concurrency: 4 }).pipe(
        Effect.map((pages) => pages.flat())
      ),
    signal
  );

export const searchStudy = (input: SearchInput, signal?: AbortSignal) =>
  request((client) => client['system.search'](input), signal);

export const createProject = (name: string) =>
  request((client) => client['projects.createProject']({ name }));

export const createSession = (project: ProjectId) =>
  request((client) => client['conversations.createUntitledSession']({ project }));

export const loadAppearance = (signal?: AbortSignal) =>
  request(
    (client) =>
      Effect.gen(function* () {
        const [settings, selected] = yield* Effect.all(
          [client['settings.appSettings']({}), client['themes.selectedTheme']({})],
          { concurrency: 2 }
        );
        const themes = yield* collectPages((before: string | undefined) =>
          client['themes.themes']({ limit: 100, before })
        );

        return { settings, selected, themes };
      }),
    signal
  );
