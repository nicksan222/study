import type { ProjectId } from '#server/shared/ids';
import type { Project as ProjectDto } from '#server/shared/projects/schemas';

export type Project = Omit<ProjectDto, 'id'> & { id: ProjectId };
