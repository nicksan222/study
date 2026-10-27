import * as schema from '@study/db/schema';
import { z } from 'zod';

import { now, titleOf } from '#backend/procedures/projects/projects';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { ChatSession, TitleSource } from '#backend/shared/conversations/sessions';
import type { ProjectId, SessionId } from '#backend/shared/ids';

export const run = publicProcedure
  .input(
    z.object({
      project: idInput,
      title: z.string()
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return createSession(store, r.project, r.title);
  });

export function createSession(
  ctx: BackendContext,
  projectId: ProjectId,
  title: string
): ChatSession {
  return insertSession(ctx, projectId, title, 'user');
}

export function insertSession(
  ctx: BackendContext,
  projectId: ProjectId,
  value: string,
  titleSource: TitleSource
): ChatSession {
  const title = titleOf(value),
    timestamp = now();
  const result = ctx.db.orm
    .insert(schema.sessions)
    .values({
      project_id: projectId,
      title: title,
      title_source: titleSource,
      created_at: timestamp,
      updated_at: timestamp
    })
    .run();

  return {
    id: result.lastInsertRowid as SessionId,
    projectId,
    title,
    titleSource,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
