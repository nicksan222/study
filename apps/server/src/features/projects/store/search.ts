/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Projects searchable project names from the current canonical project records.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Projects current published content into typed searchable entity records.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Owning feature visibility and membership rules remain outside the shared search          │
 * │ platform.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { SearchProjection, SearchProjectionPageInput } from '@study/contracts/search/schemas';
import { asc, inArray, sql } from '@study/db';
import { projects } from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
import { searchProjectionPageQuery } from '#server/platform/search/projection-page';

export function makeProjectSearchProjections({ db }: StoreResources) {
  return (
    input: SearchProjectionPageInput = { offset: 0, limit: 1000 }
  ): readonly SearchProjection[] => {
    if (input.kind !== undefined && input.kind !== 'project') return [];

    const targets = input.targets?.filter((target) => target.type === 'project');
    const filter =
      targets === undefined
        ? undefined
        : targets.length
          ? inArray(
              projects.id,
              targets.map((target) => target.id)
            )
          : sql`0`;

    return db.orm
      .select()
      .from(projects)
      .where(filter)
      .limit(input.limit)
      .offset(input.offset)
      .orderBy(asc(projects.id))
      .all()
      .map((project) => ({
        target: { type: 'project', id: project.id },
        title: project.name,
        text: project.name,
        projectIds: [project.id],
        revision: project.updated_at.toString()
      }));
  };
}

export const ProjectSearchStore = defineStore({
  name: 'ProjectSearch',
  entity: { singular: 'searchProjectionPage', plural: 'searchProjectionPages' },
  make: (resources) => ({
    queries: {
      searchProjectionPages: storeQuery(
        searchProjectionPageQuery(makeProjectSearchProjections(resources))
      )
    },
    mutations: {}
  })
});
