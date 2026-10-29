import { mentionLabel } from '@study/localization';

import { listAllSessions } from '#server/procedures/conversations/operations/all-sessions';
import { listMessages, messageView } from '#server/procedures/conversations/operations/messages';
import { postMessage } from '#server/procedures/conversations/operations/post-message';
import { requestReply } from '#server/procedures/conversations/operations/reanswer';
import { session } from '#server/procedures/conversations/operations/session';
import { enqueueJob } from '#server/procedures/jobs/worker';
import { importFile } from '#server/procedures/sources/operations/import-file';
import { setSourceProject } from '#server/procedures/sources/operations/set-source-project';
import { source } from '#server/procedures/sources/operations/source';
import { invalid } from '#server/runtime/errors';
import { publicProcedure } from '#server/runtime/trpc';
import { StudyError } from '#server/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    const { store, wake } = ctx;
    const { place, text, files, attachments } = input;

    if (files.length + attachments.length > 100 || text.length > 1_000_000)
      invalid('Message too large');

    let sessionId: bigint;
    let threadRoot: bigint | null = null;

    if (place.type === 'timeline') sessionId = place.id;
    else {
      threadRoot = place.id;
      const owner = listAllSessions(store)
        .flatMap((item) => listMessages(store, item.id))
        .find((message) => message.parts.some((part) => part.id === threadRoot));

      if (!owner) throw new StudyError('not_found', 'Thread missing');

      sessionId = owner.sessionId;
    }

    const currentSession = session(store, sessionId);

    if (!currentSession) throw new StudyError('not_found', 'Session missing');

    const posted = store.transaction(() => {
      const existing = attachments.map((id) => {
        const attachedSource = source(store, id);

        if (!attachedSource) throw new StudyError('not_found', 'Attachment missing');

        if (
          attachedSource.projectId !== null &&
          attachedSource.projectId !== currentSession.projectId
        )
          invalid('Attachment belongs to another project');

        if (attachedSource.projectId === null)
          setSourceProject(store, id, currentSession.projectId);

        return id;
      });
      const attached = [
        ...new Set([
          ...existing,
          ...files.map((path) => importFile(store, path, currentSession.projectId).id)
        ])
      ];
      const result = postMessage(store, { sessionId, text, threadRoot, attachments: attached });

      if (
        [...text.matchAll(/(?:^|\s)(@[a-z]+)/giu)].some(
          (match) => match[1].toLowerCase() === mentionLabel('assistant')
        )
      )
        requestReply(store, result.id);

      if (currentSession.titleSource === 'provisional' && threadRoot === null)
        enqueueJob(store, { kind: 'title', target: { type: 'session', id: sessionId } });

      return result;
    });

    wake();

    return messageView(store, posted);
  });
