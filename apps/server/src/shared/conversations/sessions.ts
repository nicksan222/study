import type { SessionDto, titleSourceSchema } from '#server/shared/conversations/schemas';
import type { ProjectId, SessionId } from '#server/shared/ids';

export type TitleSource = typeof titleSourceSchema.Type;

export type ChatSession = Omit<SessionDto, 'id' | 'projectId'> & {
  id: SessionId;
  projectId: ProjectId;
};
