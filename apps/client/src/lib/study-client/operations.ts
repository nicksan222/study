import type { ProjectId, MaterialId, SourceId, PageId } from '@study/contracts/ids';
import type { MaterialSummaryDto } from '@study/contracts/materials/schemas';
import type { createUntitledNoteInputSchema } from '@study/contracts/notes/rpc';
import type { NoteDto } from '@study/contracts/notes/schemas';
import type { Project } from '@study/contracts/projects/schemas';
import type { AppSettings } from '@study/contracts/settings/types';
import type { searchInputSchema } from '@study/contracts/system/rpc';
import type { searchResultSchema } from '@study/contracts/system/schemas';
import { Effect } from 'effect';

import type { StudyClient } from './client';
import { collectPages } from './pagination';
import { request } from './request';

export type Subjects = Project[];

export type Notes = readonly NoteDto[];

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

export const listNotes = (signal?: AbortSignal) =>
  request(
    (client) =>
      collectPages((before: Parameters<StudyClient['notes.notes']>[0]['before']) =>
        client['notes.notes']({ limit: 100, before })
      ),
    signal
  );

function listAllMaterials(client: StudyClient, projectId?: ProjectId) {
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

export const createNote = (
  project: ProjectId | undefined,
  initialMessage: (typeof createUntitledNoteInputSchema.Type)['initialMessage']
) => request((client) => client['notes.createUntitledNote']({ project, initialMessage }));

export const loadAppearance = (signal?: AbortSignal) =>
  request(
    (client) =>
      Effect.gen(function* () {
        const [settings, selected, preferences] = yield* Effect.all(
          [
            client['settings.appSettings']({}),
            client['themes.selectedTheme']({}),
            client['settings.appearancePreferences']({})
          ],
          { concurrency: 3 }
        );
        const themes = yield* collectPages((before: string | undefined) =>
          client['themes.themes']({ limit: 100, before })
        );

        return { settings, selected, themes, preferences };
      }),
    signal
  );

export const updateAppSettings = (
  patch: Partial<Pick<AppSettings, 'appearance' | 'zoomPercent' | 'onboarded'>>
) =>
  request((client) =>
    Effect.gen(function* () {
      const settings = yield* client['settings.appSettings']({});

      return yield* client['settings.saveAppSettings']({ ...settings, ...patch });
    })
  );

export const selectTheme = (id: string) =>
  request((client) => client['themes.selectTheme']({ id }));

export const importTheme = (json: string) =>
  request((client) => client['themes.importTheme']({ json }));

export const saveTheme = (json: string) =>
  request((client) => client['themes.saveTheme']({ json }));

export const deleteTheme = (id: string) =>
  request((client) => client['themes.deleteTheme']({ id }));

export const saveAppearancePreferences = (
  preferences: Parameters<StudyClient['settings.saveAppearancePreferences']>[0]
) => request((client) => client['settings.saveAppearancePreferences'](preferences));

export const listSubjectSources = (project: ProjectId, signal?: AbortSignal) =>
  request(
    (client) =>
      collectPages((before: SourceId | undefined) =>
        client['sources.sources']({ limit: 100, before })
      ).pipe(Effect.map((sources) => sources.filter((source) => source.projectId === project))),
    signal
  );

export const countPages = (projectId: ProjectId | undefined, signal?: AbortSignal) =>
  request(
    (client) =>
      collectPages((cursor: PageId | undefined) =>
        client['pages.pages']({ projectId, cursor, limit: 100, archived: false }).pipe(
          Effect.map((page) => ({ items: page.items, next: page.nextCursor }))
        )
      ).pipe(Effect.map((items) => items.filter((item) => item.headVersionId !== null).length)),
    signal
  );

export const listPracticeMaterials = (projectId?: ProjectId, signal?: AbortSignal) =>
  request((client) => listAllMaterials(client, projectId), signal);
