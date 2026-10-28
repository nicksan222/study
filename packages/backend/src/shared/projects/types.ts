import type { ProjectId } from '#backend/shared/ids';
import type { Project as ProjectDto } from '#backend/shared/projects/schemas';

export type Project = Omit<ProjectDto, 'id'> & { id: ProjectId };
