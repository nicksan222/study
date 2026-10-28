import type { BackendContext } from '#backend/runtime/context';
import type { ChatSession } from '#backend/shared/conversations/sessions';
import type { ProjectId } from '#backend/shared/ids';

import { insertSession as dbInsertSession } from './create-session.ts';

export function createUntitledSession(
  ctx: BackendContext,
  projectId: ProjectId,
  title: string
): ChatSession {
  return dbInsertSession(ctx, projectId, title, 'provisional');
}
