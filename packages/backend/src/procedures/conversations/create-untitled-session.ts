import { text } from '@study/localization';
import { z } from 'zod';

import { language } from '#backend/procedures/settings/get-app-settings';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { ChatSession } from '#backend/shared/conversations/sessions';
import type { ProjectId } from '#backend/shared/ids';

import { insertSession as dbInsertSession } from './create-session.ts';

export const run = publicProcedure
  .input(
    z.object({
      project: idInput,
      title: z.string()
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return createUntitledSession(
      store,
      r.project,
      r.title.trim() || text(language(store), 'NewSession')
    );
  });

export function createUntitledSession(
  ctx: BackendContext,
  projectId: ProjectId,
  title: string
): ChatSession {
  return dbInsertSession(ctx, projectId, title, 'provisional');
}
