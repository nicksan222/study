import type { SessionDto, titleSourceSchema } from '#backend/shared/conversations/schemas';
import type { ProjectId, SessionId } from '#backend/shared/ids';

export type TitleSource = typeof titleSourceSchema.Type;

export type ChatSession = Omit<SessionDto, 'id' | 'projectId'> & {
  id: SessionId;
  projectId: ProjectId;
};
