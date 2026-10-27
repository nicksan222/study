import { z } from 'zod';

import { publicProcedure, idInput } from '#backend/runtime/trpc';

import { deleteArtifact as opDeleteArtifact } from './delete-artifact.ts';
import { listArtifacts as opListArtifacts } from './material.ts';

export const run = publicProcedure
  .input(
    z.object({
      project: idInput,
      kind: z.enum(['flashcards', 'diagram'])
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;
    const project = r.project;
    const k = r.kind;

    return {
      value: store.transaction(() =>
        opListArtifacts(store, project)
          .filter((a) => a.kind === k && !a.mistakes)
          .reduce((changed, a) => opDeleteArtifact(store, a.id) || changed, false)
      )
    };
  });
