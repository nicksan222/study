import { z } from 'zod';

import { listSessions as opListSessions } from '#backend/procedures/conversations/all-sessions';
import { listMessages as opListMessages } from '#backend/procedures/conversations/messages';
import { listSources as opListSources } from '#backend/procedures/sources/sources';
import { publicProcedure, idInput } from '#backend/runtime/trpc';

export const run = publicProcedure
  .input(
    z.object({
      project: idInput,
      kind: z.enum(['flashcards', 'diagram'])
    })
  )
  .query(({ ctx: context, input: r }) => {
    const { store } = context;
    const id = r.project;

    return {
      value:
        opListSources(store).some((s) => s.projectId === id) ||
        opListSessions(store, id).some((s) =>
          opListMessages(store, s.id).some((m) =>
            m.versions.some((v) => v.id === m.activeVersionId && !!v.text.trim())
          )
        )
    };
  });
