import { projects } from '@study/db/schema';

import type { ProjectFixture } from '../types.ts';
import type { ProjectHarness, SeedHarness } from './scope.ts';

export function createProject(seed: SeedHarness, fixture: ProjectFixture): ProjectHarness {
  const time = seed.now - 30n * 86400n;
  const project = seed.db.orm
    .insert(projects)
    .values({
      name: fixture.name,
      icon_color: fixture.color,
      exam_on: new Date(Number(seed.now + BigInt(fixture.examInDays) * 86400n) * 1000)
        .toISOString()
        .slice(0, 10),
      created_at: time,
      updated_at: seed.now - 86400n
    })
    .returning()
    .get();

  seed.summary.projects++;

  return { ...seed, projectId: project.id, time };
}
