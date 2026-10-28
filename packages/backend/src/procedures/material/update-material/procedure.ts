import { text } from '@study/localization';

import { listSessions } from '#backend/procedures/conversations/operations/all-sessions';
import { listMessages } from '#backend/procedures/conversations/operations/messages';
import { requestMaterial } from '#backend/procedures/material/operations/update-material';
import { project } from '#backend/procedures/projects/operations/read-projects';
import { language } from '#backend/procedures/settings/operations/get-app-settings';
import { listSources } from '#backend/procedures/sources/operations/sources';
import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    const { store, wake } = ctx;
    const sources = listSources(store)
      .filter((source) => source.projectId === input.project)
      .map((source) => source.id);

    if (!project(store, input.project)) throw new StudyError('not_found', 'Project missing');

    const notes = listSessions(store, input.project)
      .flatMap((session) => listMessages(store, session.id))
      .some((message) =>
        message.versions.some(
          (version) => version.id === message.activeVersionId && version.text.trim()
        )
      );

    if (!sources.length && !notes) throw new StudyError('not_enough', 'No study content');

    const result = requestMaterial(
      store,
      input.project,
      input.kind,
      text(language(store), input.kind === 'flashcards' ? 'KindFlashcards' : 'KindDiagram'),
      sources
    );

    wake();

    return { id: result.artifactId };
  });
