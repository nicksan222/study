import { listSessions } from '#backend/procedures/conversations/operations/all-sessions';
import { listMessages } from '#backend/procedures/conversations/operations/messages';
import { listSources } from '#backend/procedures/sources/operations/sources';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => ({
    value:
      listSources(ctx.store).some((source) => source.projectId === input.project) ||
      listSessions(ctx.store, input.project).some((session) =>
        listMessages(ctx.store, session.id).some((message) =>
          message.versions.some(
            (version) => version.id === message.activeVersionId && !!version.text.trim()
          )
        )
      )
  }));
