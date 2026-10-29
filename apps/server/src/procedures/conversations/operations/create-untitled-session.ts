import type { ServerContext } from '#server/runtime/context';
import type { ChatSession } from '#server/shared/conversations/sessions';
import type { ProjectId } from '#server/shared/ids';

import { insertSession as dbInsertSession } from './create-session.ts';

export function createUntitledSession(
  ctx: ServerContext,
  projectId: ProjectId,
  title: string
): ChatSession {
  return dbInsertSession(ctx, projectId, title, 'provisional');
}
